import { useCallback, useEffect, useRef, useState } from "react";
import { ClimateCalibration, SiteDataProfile, ServerMessage, WorldState as WorldStateSchema, GrowthEvent as GrowthEventSchema, type ClimateSweepResult, type GrowthEvent, type Intervention, type LocationId, type MicrogridConfig, type PresetId, type RunSummary, type WorldState } from "@verdant/protocol";
import type { OptimizationSearch, OptimizerValidation } from "@verdant/sim";
import { persistCloudWorld } from "../auth/cloudIdentity";
import { worldStorageKey, type IdentityProfile } from "../auth/localIdentity";
import { isAnalysisOperation } from "./engineRequest";
import { emptyWorld, recoverStoredWorld } from "./worldRecovery";

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

export function useVerdant(identity?: IdentityProfile | null) {
  const [connected, setConnected] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [engineNotice, setEngineNotice] = useState<string | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [growthLog, setGrowthLog] = useState<GrowthEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef(new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void; timer: ReturnType<typeof setTimeout>; heavy: boolean }>());

  const callStatic = useCallback(<T,>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
    const worker = workerRef.current;
    if (!worker) return Promise.reject(new Error("The browser simulation engine is still starting"));
    const heavy = isAnalysisOperation(op);
    if (heavy && [...pendingRef.current.values()].some((request) => request.heavy)) return Promise.reject(new Error("An analysis is already running. Wait for it to complete before starting another."));
    const id = crypto.randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pendingRef.current.has(id)) return;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        setConnected(false);
        const error = "The analysis engine exceeded its time limit. Reload the workspace to restart it.";
        setEngineError(error);
        for (const request of pendingRef.current.values()) { clearTimeout(request.timer); request.reject(new Error(error)); }
        pendingRef.current.clear();
      }, 600_000); // Metadata can be queued behind a full optimization.
      pendingRef.current.set(id, { resolve: resolve as (value: unknown) => void, reject, timer, heavy });
      try { worker.postMessage({ id, op, args }); } catch (reason) { clearTimeout(timer); pendingRef.current.delete(id); reject(reason); }
    });
  }, []);

  useEffect(() => {
    setEngineError(null);
    setEngineNotice(null);
    if (STATIC_MODE) {
      setConnected(false);
      setGrowthLog([]);
      const staticWorldKey = worldStorageKey(identity?.id);
      let recovery: ReturnType<typeof recoverStoredWorld>;
      try { recovery = recoverStoredWorld(localStorage, staticWorldKey); } catch {
        recovery = { ready: false, error: "Saved-world storage is unavailable. Allow browser storage, then reload. No saved world was overwritten." };
      }
      if (!recovery.ready) {
        setWorld(null);
        setEngineError(recovery.error);
        return;
      }
      const recoveredSnapshot = Boolean(recovery.recoveryKey);
      if (recovery.recoveryKey) {
        setEngineNotice(`The saved world could not be read. Its original contents are backed up at ${recovery.recoveryKey}. A new local world is ready.${identity?.authMode === "github" ? " Cloud synchronization is paused for this session to protect the remote copy." : ""}`);
      }
      setWorld(recovery.world ?? emptyWorld());
      let worker: Worker;
      try {
        worker = new Worker(new URL("./static-engine.worker.ts", import.meta.url), { type: "module" });
      } catch {
        setEngineError("The browser simulation engine could not start. Reload the workspace or check whether browser security settings block workers.");
        return;
      }
      let cancelled = false;
      workerRef.current = worker;
      const stopEngine = (error = "The browser engine stopped unexpectedly. Reload the workspace to restart it.") => {
        if (cancelled) return;
        setConnected(false);
        setEngineError(error);
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        for (const pending of pendingRef.current.values()) { clearTimeout(pending.timer); pending.reject(new Error(error)); }
        pendingRef.current.clear();
      };
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        if (cancelled || workerRef.current !== worker) return;
        const message = event.data;
        if (!message || typeof message.id !== "string" || typeof message.ok !== "boolean") {
          stopEngine("The browser engine returned an unreadable response. No saved world was replaced. Reload to restart it.");
          return;
        }
        const pending = pendingRef.current.get(message.id);
        if (!pending) return;
        if (!message.ok) {
          pendingRef.current.delete(message.id);
          clearTimeout(pending.timer);
          pending.reject(new Error(typeof message.error === "string" ? message.error : "Browser simulation failed"));
          return;
        }
        const payload = message.result && typeof message.result === "object"
          ? message.result as { world?: unknown; growthEvents?: unknown }
          : undefined;
        const parsedWorld = payload && "world" in payload ? WorldStateSchema.safeParse(payload.world) : undefined;
        const parsedGrowth = payload && "growthEvents" in payload ? GrowthEventSchema.array().safeParse(payload.growthEvents) : undefined;
        if (parsedWorld?.success === false || parsedGrowth?.success === false) {
          stopEngine("The browser engine returned invalid world data. The last saved world was not replaced. Reload to restart the engine.");
          return;
        }
        if (parsedWorld?.success) {
          const nextWorld = parsedWorld.data;
          setWorld(nextWorld);
          try { localStorage.setItem(staticWorldKey, JSON.stringify(nextWorld)); } catch {
            setEngineNotice("This world is running in memory, but browser storage could not save the latest change. Keep this tab open and free browser storage before continuing.");
          }
          if (identity?.authMode === "github" && !recoveredSnapshot) {
            void persistCloudWorld(identity, nextWorld).catch((reason) => {
              if (!cancelled) setEngineNotice("Cloud synchronization failed. Your local world remains available; check your connection before switching devices.");
              console.error("Cloud world sync failed", reason);
            });
          }
        }
        if (parsedGrowth?.success && parsedGrowth.data.length) setGrowthLog((log) => [...log, ...parsedGrowth.data]);
        pendingRef.current.delete(message.id);
        clearTimeout(pending.timer);
        pending.resolve(message.result);
      };
      worker.onerror = () => stopEngine();
      worker.onmessageerror = () => stopEngine("The browser engine response could not be decoded. Reload the workspace to restart it.");
      void callStatic("init", { world: recovery.world }).then(() => {
        if (!cancelled && workerRef.current === worker) setConnected(true);
      }).catch((reason) => {
        if (!cancelled) stopEngine(reason instanceof Error ? reason.message : "The browser simulation engine could not initialize. Reload to retry.");
      });
      return () => {
        cancelled = true;
        worker.terminate();
        if (workerRef.current === worker) workerRef.current = null;
        for (const pending of pendingRef.current.values()) { clearTimeout(pending.timer); pending.reject(new Error("Browser simulation engine stopped")); }
        pendingRef.current.clear();
      };
    }

    let cancelled = false;
    let socket: WebSocket;
    let retryTimer: ReturnType<typeof setTimeout>;

    const connect = () => {
      socket = new WebSocket(WS_URL);
      wsRef.current = socket;
      socket.onopen = () => { if (!cancelled) { setConnected(true); setEngineError(null); } };
      socket.onclose = () => {
        if (cancelled) return;
        setConnected(false);
        setEngineError("The server connection was interrupted. Reconnecting automatically.");
        retryTimer = setTimeout(connect, 2000);
      };
      socket.onmessage = (ev) => {
        let data: unknown;
        try { data = JSON.parse(ev.data); } catch { return; }
        const parsed = ServerMessage.safeParse(data);
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
  }, [identity?.authMode, identity?.id, callStatic]);

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

  return { connected, engineError, engineNotice, world, growthLog, simulate, optimize, runClimateSweep, getCalibration, getSiteDataProfiles, commissionSite, executionMode: STATIC_MODE ? "Browser engine" : "Server engine" };
}
