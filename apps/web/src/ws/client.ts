import { useCallback, useEffect, useRef, useState } from "react";
import { ClimateCalibration, SiteDataProfile, ServerMessage, type ClimateSweepResult, type GrowthEvent, type Intervention, type LocationId, type MicrogridConfig, type PresetId, type RunSummary, type WorldState } from "@verdant/protocol";
import type { OptimizationSearch, OptimizerValidation } from "@verdant/sim";
import { activeWorldStorageKey } from "../auth/localIdentity";

declare const __VERDANT_API__: string;
const API_BASE: string = typeof __VERDANT_API__ !== "undefined" ? __VERDANT_API__ : "";
const WS_URL = (API_BASE || window.location.origin).replace(/^http/, "ws") + "/ws";
const STATIC_MODE = typeof __VERDANT_STATIC__ !== "undefined" && __VERDANT_STATIC__;

type WorkerResponse = { id: string; ok: boolean; result?: unknown; error?: string };

export interface OptimizeResponse {
  intervention: Intervention;
  result: RunSummary;
  growthEvents: GrowthEvent[];
  analysis: OptimizationSearch;
  validation: OptimizerValidation;
  historicalBacktest: {
    periods: number;
    futures: number;
    beforeCritical: number;
    afterCritical: number;
    passedPeriods: number;
    source: string;
    label: string;
  };
}

export interface CommissionSiteInput {
  siteName: string;
  timezone: string;
  pvCapacityKW: number;
  demandFileName: string;
  pvFileName: string;
  outageFileName: string;
  demandCsv: string;
  pvCsv: string;
  outageCsv: string;
}

export function useVerdant() {
  const [connected, setConnected] = useState(false);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [growthLog, setGrowthLog] = useState<GrowthEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>());

  const callStatic = useCallback(<T,>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error("The browser simulation engine is still starting"));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      pendingRef.current.set(id, { resolve: resolve as (value: unknown) => void, reject });
      worker.postMessage({ id, op, args });
    });
  }, []);

  useEffect(() => {
    if (STATIC_MODE) {
      const staticWorldKey = activeWorldStorageKey();
      const worker = new Worker(new URL("./static-engine.worker.ts", import.meta.url), { type: "module" });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        const pending = pendingRef.current.get(message.id);
        if (!pending) return;
        pendingRef.current.delete(message.id);
        if (!message.ok) { pending.reject(new Error(message.error ?? "Browser simulation failed")); return; }
        const payload = message.result as { world?: WorldState; growthEvents?: GrowthEvent[] } | undefined;
        if (payload?.world) {
          setWorld(payload.world);
          try { localStorage.setItem(staticWorldKey, JSON.stringify(payload.world)); } catch { /* persistence is best effort */ }
        }
        if (payload?.growthEvents?.length) setGrowthLog((log) => [...log, ...payload.growthEvents!]);
        pending.resolve(message.result);
      };
      worker.onerror = () => setConnected(false);
      let stored: WorldState | undefined;
      try { stored = JSON.parse(localStorage.getItem(staticWorldKey) ?? "null") ?? undefined; } catch { stored = undefined; }
      setWorld(stored ?? { trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0 });
      setConnected(true);
      const id = crypto.randomUUID();
      worker.postMessage({ id, op: "init", args: { world: stored } });
      return () => {
        worker.terminate();
        workerRef.current = null;
        for (const pending of pendingRef.current.values()) pending.reject(new Error("Browser simulation engine stopped"));
        pendingRef.current.clear();
      };
    }

    let cancelled = false;
    let socket: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;
      socket.onopen = () => !cancelled && setConnected(true);
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        retryTimer = setTimeout(connect, 2000);
      };
      socket.onmessage = (ev) => {
        const parsed = ServerMessage.safeParse(JSON.parse(ev.data));
        if (!parsed.success) return;
        const msg = parsed.data;
        if (msg.type === "world") setWorld(msg.world);
        if (msg.type === "growth") setGrowthLog((log) => [...log, msg.event]);
      };
    };
    connect();

    return () => {
      cancelled = true;
      clearTimeout(retryTimer);
      wsRef.current?.close();
    };
  }, []);

  const simulate = useCallback(
    async (location: LocationId, preset: PresetId, config: MicrogridConfig, scenarioCount: number, siteDataProfileId: string) => {
      if (STATIC_MODE) return callStatic<{ summary: RunSummary; growthEvents: GrowthEvent[] }>("simulate", { location, preset, config, scenarioCount, siteDataProfileId });
      const res = await fetch(`${API_BASE}/api/simulate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ location, preset, config, scenarioCount, siteDataProfileId }),
      });
      if (!res.ok) throw new Error(`simulate failed: ${res.status}`);
      return (await res.json()) as { summary: RunSummary; growthEvents: GrowthEvent[] };
    },
    [callStatic],
  );

  const optimize = useCallback(async (runId: string): Promise<OptimizeResponse> => {
    if (STATIC_MODE) return callStatic<OptimizeResponse>("optimize", { runId });
    const res = await fetch(`${API_BASE}/api/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId }),
    });
    if (!res.ok) throw new Error(`optimize failed: ${res.status}`);
    return (await res.json()) as OptimizeResponse;
  }, [callStatic]);

  const runClimateSweep = useCallback(async (
    location: LocationId,
    config: MicrogridConfig,
    scenarioCount = 500,
    siteDataProfileId = "representative-model",
  ): Promise<ClimateSweepResult> => {
    if (STATIC_MODE) return callStatic<ClimateSweepResult>("sweep", { location, config, scenarioCount, siteDataProfileId });
    const res = await fetch(`${API_BASE}/api/climate-sweep`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ location, config, scenarioCount, siteDataProfileId }),
    });
    if (!res.ok) throw new Error(`climate sweep failed: ${res.status}`);
    return (await res.json()) as ClimateSweepResult;
  }, [callStatic]);

  const getCalibration = useCallback(async (location: LocationId): Promise<ClimateCalibration> => {
    if (STATIC_MODE) return ClimateCalibration.parse(await callStatic<unknown>("calibration", { location }));
    const res = await fetch(`${API_BASE}/api/calibration/${location}`);
    if (!res.ok) throw new Error(`calibration failed: ${res.status}`);
    return ClimateCalibration.parse(await res.json());
  }, [callStatic]);

  const getSiteDataProfiles = useCallback(async (): Promise<{ profiles: SiteDataProfile[]; representativeModel: { id: string; label: string } }> => {
    if (STATIC_MODE) {
      const payload = await callStatic<{ profiles: unknown[]; representativeModel: { id: string; label: string } }>("profiles");
      return { ...payload, profiles: payload.profiles.map((profile) => SiteDataProfile.parse(profile)) };
    }
    const res = await fetch(`${API_BASE}/api/site-data/profiles`);
    if (!res.ok) throw new Error(`site data failed: ${res.status}`);
    const payload = await res.json() as { profiles: unknown[]; representativeModel: { id: string; label: string } };
    return { ...payload, profiles: payload.profiles.map((profile) => SiteDataProfile.parse(profile)) };
  }, [callStatic]);

  const commissionSite = useCallback(async (input: CommissionSiteInput): Promise<SiteDataProfile> => {
    if (STATIC_MODE) throw new Error("Public demo commissioning is read-only. Run Grounded locally to ingest private facility exports.");
    const res = await fetch(`${API_BASE}/api/site-data/commission`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    const payload = await res.json() as { profile?: unknown; error?: unknown };
    if (!res.ok) {
      const message = typeof payload.error === "string" ? payload.error : `commissioning failed: ${res.status}`;
      throw new Error(message);
    }
    return SiteDataProfile.parse(payload.profile);
  }, []);

  return { connected, world, growthLog, simulate, optimize, runClimateSweep, getCalibration, getSiteDataProfiles, commissionSite, executionMode: STATIC_MODE ? "Browser engine" : "Server engine" };
}
