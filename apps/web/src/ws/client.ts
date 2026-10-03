import { useCallback, useEffect, useRef, useState } from "react";
import { ClimateCalibration, SiteDataProfile, ServerMessage, WorldState as WorldStateSchema, GrowthEvent as GrowthEventSchema, type ClimateSweepResult, type GrowthEvent, type Intervention, type LocationId, type MicrogridConfig, type PresetId, type RunSummary, type WorldState } from "@verdant/protocol";
import type { OptimizationSearch, OptimizerValidation } from "@verdant/sim";
import type { InvestmentOptimization } from "@verdant/sim/investmentOptimizer";
import { persistCloudWorld } from "../auth/cloudIdentity";
import { worldStorageKey, type IdentityProfile } from "../auth/localIdentity";
import { isAnalysisOperation } from "./engineRequest";
import { emptyWorld, recoverStoredWorld } from "./worldRecovery";
import { loadEvidence, loadMilestoneEvidence, pinMilestoneEvidence, saveEvidence, sealEvidence } from "../lib/evidenceStore";
import type { EvidenceEnvelope, StoredEvidence } from "@verdant/protocol/evidence";
import { PlacementRequest as PlacementRequestSchema, type EvidenceMilestone, type PlacementRequest } from "@verdant/protocol/city";
import { verifyMilestoneEvidence } from "@verdant/sim/evidenceCity";

declare const __VERDANT_API__: string;
const API_BASE: string = typeof __VERDANT_API__ !== "undefined" ? __VERDANT_API__ : "";
const WS_URL = (API_BASE || window.location.origin).replace(/^http/, "ws") + "/ws";
const STATIC_MODE = typeof __VERDANT_STATIC__ !== "undefined" && __VERDANT_STATIC__;

type WorkerResponse = { id: string; ok: boolean; result?: unknown; error?: string };

/** HTTP and WebSocket can deliver the same saved construction event. */
function mergeGrowthEvents(current: GrowthEvent[], incoming: GrowthEvent[]): GrowthEvent[] {
  const key = (event: GrowthEvent) => JSON.stringify([event.kind, event.runId, event.building?.id, event.building?.milestoneId, event.tree?.id, event.pendingMilestone?.id]);
  const seen = new Set(current.map(key));
  return [...current, ...incoming.filter((event) => { const id = key(event); if (seen.has(id)) return false; seen.add(id); return true; })];
}

export interface OptimizeResponse {
  intervention: Intervention;
  result: RunSummary;
  growthEvents: GrowthEvent[];
  analysis: OptimizationSearch;
  validation: OptimizerValidation;
  investmentAnalysis?: InvestmentOptimization;
  historicalBacktest: {
    periods: number;
    futures: number;
    beforeCritical: number;
    afterCritical: number;
    passedPeriods: number;
    source: string;
    label: string;
  };
  growthAssessment?: { eligible: boolean; reasons: string[]; targetPct: number; pairedSupport: boolean };
  world?: WorldState;
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
  outageObservationWindow: { startedAt: string; endedAt: string; continuousCoverage: true };
}

export function useVerdant(identity?: IdentityProfile | null) {
  const [connected, setConnected] = useState(false);
  const [engineError, setEngineError] = useState<string | null>(null);
  const [engineNotice, setEngineNotice] = useState<string | null>(null);
  const [world, setWorld] = useState<WorldState | null>(null);
  const [growthLog, setGrowthLog] = useState<GrowthEvent[]>([]);
  const [restoredEvidence, setRestoredEvidence] = useState<StoredEvidence | null>(null);
  const ownerRef = useRef(worldStorageKey(identity?.id));
  ownerRef.current = worldStorageKey(identity?.id);
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
    setRestoredEvidence(null);
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
      void loadEvidence(staticWorldKey).catch((reason) => {
        if (!cancelled) setEngineNotice(`Evidence recovery unavailable: ${reason instanceof Error ? reason.message : "browser storage error"} Your world remains available. Existing evidence was not overwritten.`);
        return null;
      }).then(async (evidence) => {
        if (cancelled) return;
        await callStatic("init", { world: recovery.world, runs: evidence ? [evidence.baseline, ...(evidence.optimization ? [evidence.optimization.result] : [])] : [] });
        if (!cancelled) setRestoredEvidence(evidence);
      }).then(() => {
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
    void loadEvidence(worldStorageKey(identity?.id)).then((evidence) => {
      if (!cancelled) setRestoredEvidence(evidence);
    }).catch((reason) => {
      if (!cancelled) setEngineNotice(`Local evidence recovery unavailable: ${reason instanceof Error ? reason.message : "storage error"}. Server evidence remains in SQLite.`);
    });

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
        if (msg.type === "growth") setGrowthLog((log) => mergeGrowthEvents(log, [msg.event]));
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

  const optimize = useCallback(async (runId: string, riskTargetPct: number): Promise<OptimizeResponse> => {
    if (STATIC_MODE) return callStatic<OptimizeResponse>("optimize", { runId, riskTargetPct });
    const res = await fetch(`${API_BASE}/api/optimize`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ runId, riskTargetPct }),
    });
    if (!res.ok) throw new Error(`optimize failed: ${res.status}`);
    return (await res.json()) as OptimizeResponse;
  }, [callStatic]);

  const persistEvidence = useCallback(async (baseline: RunSummary, optimization: OptimizeResponse | null, riskTargetPct: number) => {
    const ownerScope = worldStorageKey(identity?.id);
    try {
      const envelope = await sealEvidence(ownerScope, baseline, optimization, riskTargetPct);
      await saveEvidence(envelope);
      if (optimization) for (const milestone of optimization.world?.pendingMilestones ?? []) {
        if (milestone.proof.resultRunId !== optimization.result.runId) continue;
        if (!verifyMilestoneEvidence(milestone, baseline, optimization)) throw new Error("The milestone does not match its complete validation report.");
        await pinMilestoneEvidence(envelope, milestone.id);
      }
      return envelope;
    } catch (reason) {
      if (ownerRef.current === ownerScope) setEngineNotice(`Complete evidence is available in this tab but could not be saved: ${reason instanceof Error ? reason.message : "storage error"}. Export the proof before closing. Your earlier records were retained. Construction requires a retained proof.`);
      return null;
    }
  }, [identity?.id]);

  const getMilestoneEvidence = useCallback(async (milestone: EvidenceMilestone): Promise<EvidenceEnvelope> => {
    const ownerScope = worldStorageKey(identity?.id);
    let envelope = await loadMilestoneEvidence(ownerScope, milestone.id, milestone.proof.resultRunId);
    if (!envelope && !STATIC_MODE) {
      const response = await fetch(`${API_BASE}/api/evidence/result/${encodeURIComponent(milestone.proof.resultRunId)}`);
      if (response.ok) {
        const retained = await response.json() as { baseline: RunSummary; optimization: OptimizeResponse };
        envelope = await sealEvidence(ownerScope, retained.baseline, retained.optimization, milestone.proof.targetPct);
        if (verifyMilestoneEvidence(milestone, envelope.payload.baseline, envelope.payload.optimization!)) await pinMilestoneEvidence(envelope, milestone.id);
      }
    }
    if (ownerRef.current !== ownerScope) throw new Error("The active workspace changed. Reopen its evidence certificate.");
    if (!envelope) throw new Error("The complete proof is not stored on this device. Open the browser that earned this milestone. Cloud city sync currently carries the certificate summary, not the full evidence package.");
    if (!envelope.payload.optimization || !verifyMilestoneEvidence(milestone, envelope.payload.baseline, envelope.payload.optimization)) {
      throw new Error("Certificate integrity review: its retained model evidence does not match this milestone. Construction is unavailable.");
    }
    return envelope;
  }, [identity?.id]);

  const placeMilestone = useCallback(async (input: PlacementRequest) => {
    const request = PlacementRequestSchema.parse(input);
    const milestone = world?.pendingMilestones?.find((item) => item.id === request.milestoneId);
    if (!milestone) throw new Error("This milestone is no longer awaiting placement.");
    const envelope = await getMilestoneEvidence(milestone);
    const args = { ...request, evidence: { baseline: envelope.payload.baseline, optimization: envelope.payload.optimization } };
    if (STATIC_MODE) return callStatic<{ world: WorldState; growthEvents: GrowthEvent[] }>("placeMilestone", args);
    const response = await fetch(`${API_BASE}/api/world/place`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const payload = await response.json() as { world?: unknown; growthEvents?: unknown; error?: string };
    if (!response.ok) throw new Error(payload.error ?? "Construction could not be recorded.");
    const next = WorldStateSchema.parse(payload.world);
    const events = GrowthEventSchema.array().parse(payload.growthEvents ?? []);
    if (ownerRef.current !== envelope.payload.ownerScope) throw new Error("The active workspace changed before construction completed.");
    setWorld(next);
    setGrowthLog((log) => mergeGrowthEvents(log, events));
    return { world: next, growthEvents: events };
  }, [world, getMilestoneEvidence, callStatic]);

  const openEvidence = useCallback(async (evidence: StoredEvidence) => {
    if (evidence.ownerScope !== worldStorageKey(identity?.id)) throw new Error("The evidence belongs to another workspace.");
    if (STATIC_MODE) await callStatic("restoreEvidence", { runs: [evidence.baseline, ...(evidence.optimization ? [evidence.optimization.result] : [])] });
    if (evidence.ownerScope === ownerRef.current) setRestoredEvidence(evidence);
  }, [identity?.id, callStatic]);

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

  return { connected, engineError, engineNotice, restoredEvidence, persistEvidence, getMilestoneEvidence, placeMilestone, openEvidence, world, growthLog, simulate, optimize, runClimateSweep, getCalibration, getSiteDataProfiles, commissionSite, executionMode: STATIC_MODE ? "Browser engine" : "Server engine" };
}
