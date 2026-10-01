/// <reference lib="webworker" />

import type { ClimateCalibration, GrowthEvent, LocationId, MicrogridConfig, PresetId, RunSummary, SiteDataProfile, WorldState } from "@verdant/protocol";
import { ClimateCalibration as ClimateCalibrationSchema, SiteDataProfile as SiteDataProfileSchema, WorldState as WorldStateSchema, RunSummary as RunSummarySchema } from "@verdant/protocol";
import { parseAnalysisRequest } from "./engineRequest";
import { applyRunGrowth, applyOptimizationGrowth } from "@verdant/sim/growth";
import type { OptimizationEvidence } from "@verdant/sim/decisionReadiness";
import { OptimizationRequest, validationCohortSize } from "@verdant/protocol/requests";
import { PlacementRequest } from "@verdant/protocol/city";
import { OptimizationEvidence as OptimizationEvidenceSchema } from "@verdant/protocol/evidence";
import { applyMilestonePlacement } from "@verdant/sim/evidenceCity";
import {
  DEFAULT_INTERVENTION, LOCATIONS, PRESET_ORDER, MODEL_VERSION, analyzeInterventions, analyzeSensitivity,
  locationFromCalibration, locationWithSiteData, runMonteCarlo, toRunSummary, validateIntervention,
} from "@verdant/sim";
import climateCache from "../../../server/climate-cache.json" with { type: "json" };
import measuredReferenceJson from "../../../../data/ausgrid-measured-reference.json" with { type: "json" };

type RequestMessage = { id: string; op: string; args?: Record<string, unknown> };
type ResponseMessage = { id: string; ok: boolean; result?: unknown; error?: string };

const measuredReference = SiteDataProfileSchema.parse(measuredReferenceJson);
const profiles = new Map<string, SiteDataProfile>([[measuredReference.id, measuredReference]]);
const runs = new Map<string, RunSummary>();
const optimizationProofs = new Map<string, { baseline: RunSummary; optimization: ReturnType<typeof OptimizationEvidenceSchema.parse> }>();
let world: WorldState = { trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0 };

function calibrationFor(location: LocationId): ClimateCalibration {
  const cached = ClimateCalibrationSchema.parse(climateCache[location]);
  if (!cached) throw new Error(`Bundled climate calibration unavailable for ${location}`);
  return { ...cached, status: cached.source === "NASA_POWER" ? "cached" as const : "fallback" as const };
}

function profileFor(id: string | undefined): SiteDataProfile | undefined {
  if (id === "representative-model") return undefined;
  const profile = profiles.get(id ?? measuredReference.id);
  if (!profile) throw new Error("That data profile is not available in this engine. Choose an available source and rerun.");
  return profile;
}

export function recordRun(summary: RunSummary): GrowthEvent[] {
  const transition = applyRunGrowth(world, summary, { id: () => crypto.randomUUID(), now: Date.now });
  world = transition.world;
  return transition.events;
}

/** All durable/browser milestones use the same validated evidence contract. */
export function recordOptimization(before: RunSummary, after: RunSummary, evidence?: OptimizationEvidence | null, targetPct = 5): GrowthEvent[] {
  const transition = applyOptimizationGrowth(world, before, after, evidence, { id: () => crypto.randomUUID(), now: Date.now }, targetPct);
  world = transition.world;
  return transition.events;
}

function restoreRuns(value: unknown): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) throw new Error("Saved analysis evidence is not a run list.");
  const restored = value.map((item) => RunSummarySchema.parse(item));
  if (new Set(restored.map((run) => run.runId)).size !== restored.length) throw new Error("Saved analysis evidence has duplicate run identifiers.");
  if (restored.some((run) => !Object.values(run.counts).every((value) => Number.isInteger(value) && value >= 0)
    || Object.values(run.counts).reduce((sum, value) => sum + value, 0) !== run.n
    || run.manifest?.scenarioCount !== run.n || run.manifest?.deterministicReplay !== true || run.manifest?.modelVersion !== MODEL_VERSION
    || run.manifest?.calibrationFingerprint !== (run.calibration?.fingerprint ?? "REFERENCE")
    || run.manifest?.siteDataFingerprint !== run.siteData?.fingerprint)) throw new Error("Saved analysis evidence belongs to another model or has inconsistent source/audit fingerprints. No run was restored.");
  runs.clear();
  restored.forEach((run) => runs.set(run.runId, run));
}

function runSimulation(args: Record<string, unknown>) {
  const { location, preset, config, scenarioCount } = parseAnalysisRequest(args);
  const siteData = profileFor(args.siteDataProfileId as string | undefined);
  const calibration = calibrationFor(location);
  const calibrated = locationFromCalibration(locationWithSiteData(LOCATIONS[location], siteData), calibration);
  const mc = runMonteCarlo(scenarioCount, calibrated, preset, config, DEFAULT_INTERVENTION);
  const sensitivity = analyzeSensitivity(calibrated, preset, config, Math.min(300, scenarioCount));
  const summary = toRunSummary(crypto.randomUUID(), mc, calibration, sensitivity, 0, siteData);
  runs.set(summary.runId, summary);
  const growthEvents = recordRun(summary);
  return { summary, growthEvents, world };
}

function runSweep(args: Record<string, unknown>) {
  const { location, config, scenarioCount } = parseAnalysisRequest(args, true);
  const siteData = profileFor(args.siteDataProfileId as string | undefined);
  const calibration = calibrationFor(location);
  const calibrated = locationFromCalibration(locationWithSiteData(LOCATIONS[location], siteData), calibration);
  const scenarios = PRESET_ORDER.map((preset) => {
    const mc = runMonteCarlo(scenarioCount, calibrated, preset, config, DEFAULT_INTERVENTION);
    const weightedRisk = mc.counts.critical + mc.counts.high * 0.45 + mc.counts.moderate * 0.12;
    return {
      preset,
      label: ({ normal: "Normal Conditions", heatwave: "Extreme Heatwave", storm: "Severe Storm", evsurge: "EV Surge", extreme: "Extreme Combined Event" } as const)[preset],
      n: scenarioCount,
      counts: mc.counts,
      resilienceScore: Math.round((100 - weightedRisk / scenarioCount * 100) * 10) / 10,
      criticalPct: Math.round(mc.counts.critical / scenarioCount * 1000) / 10,
      dominantCause: Object.entries(mc.causeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "No material risk",
    };
  });
  const weakest = [...scenarios].sort((a, b) => a.resilienceScore - b.resilienceScore)[0];
  return { location, scenarioCount, robustScore: weakest.resilienceScore, weakestPreset: weakest.preset, scenarios, calibration, createdAt: Date.now() };
}

function runOptimization(args: Record<string, unknown>) {
  const request = OptimizationRequest.parse(args);
  const before = runs.get(request.runId);
  if (!before) throw new Error("Run a simulation before optimizing in this browser session");
  if (["reservePct", "evDelayMin", "precoolHour"].some((key) =>
    before.intervention[key as keyof typeof DEFAULT_INTERVENTION] !== DEFAULT_INTERVENTION[key as keyof typeof DEFAULT_INTERVENTION])) {
    throw new Error("Run a no-intervention baseline before strategy search; validation compares against that baseline policy.");
  }
  const calibration = before.calibration ?? calibrationFor(before.location);
  const location = locationFromCalibration(locationWithSiteData(LOCATIONS[before.location], before.siteData), calibration);
  const targetPct = request.riskTargetPct;
  const baselineSeedOffset = before.manifest?.seedOffset ?? 0;
  const discoverySeedOffset = baselineSeedOffset + before.n;
  const analysis = analyzeInterventions(location, before.preset, before.config, 300, discoverySeedOffset, PRESET_ORDER, targetPct);
  const intervention = analysis.best.intervention;
  const validation = validateIntervention(location, before.config, intervention, discoverySeedOffset + 10_000, validationCohortSize(targetPct, PRESET_ORDER.length), PRESET_ORDER, analysis.frontier.map((candidate) => candidate.intervention), targetPct);
  const mc = runMonteCarlo(before.n, location, before.preset, before.config, intervention, baselineSeedOffset);
  const after = toRunSummary(crypto.randomUUID(), mc, calibration, undefined, baselineSeedOffset, before.siteData);
  runs.set(after.runId, after);
  let beforeCritical = 0, afterCritical = 0, passedPeriods = 0;
  const periods = calibration.historicalDays.length ? calibration.historicalDays : calibration.monthly.map((month) => ({ ...month, date: month.month }));
  periods.forEach((period, index) => {
    const historical = locationFromCalibration(locationWithSiteData(LOCATIONS[before.location], before.siteData), calibration, { ...period, month: period.date });
    const seedOffset = 50_000 + index * 24;
    const baseline = runMonteCarlo(24, historical, before.preset, before.config, DEFAULT_INTERVENTION, seedOffset);
    const improved = runMonteCarlo(24, historical, before.preset, before.config, intervention, seedOffset);
    beforeCritical += baseline.counts.critical;
    afterCritical += improved.counts.critical;
    if (improved.counts.critical === 0) passedPeriods++;
  });
  const historicalBacktest = {
    periods: periods.length, futures: periods.length * 24, beforeCritical, afterCritical, passedPeriods,
    source: calibration.source,
    label: calibration.historicalDays.length
      ? "12 highest-stress observed NASA POWER climate days from 2023; outage and demand remain simulated"
      : "12 representative monthly climate profiles; all operational conditions are simulated",
  };
  const evidence = { intervention, result: after, analysis, validation, historicalBacktest, growthEvents: [] };
  optimizationProofs.set(after.runId, { baseline: before, optimization: OptimizationEvidenceSchema.parse(evidence) });
  const transition = applyOptimizationGrowth(world, before, after, evidence, { id: () => crypto.randomUUID(), now: Date.now }, targetPct);
  world = transition.world;
  const growthEvents = transition.events;
  const growthAssessment = { eligible: transition.verdict.eligible, targetPct, pairedSupport: transition.verdict.pairedSupport,
    status: transition.verdict.readiness?.status ?? "evidence", reasons: transition.verdict.reasons };
  return { intervention, result: after, growthEvents, growthAssessment, analysis, validation, historicalBacktest, world };
}

function placeMilestone(args: Record<string, unknown>) {
  const request = PlacementRequest.parse(args);
  const milestone = world.pendingMilestones?.find((item) => item.id === request.milestoneId);
  const placed = world.buildings.find((item) => item.milestoneId === request.milestoneId);
  const resultRunId = milestone?.proof.resultRunId ?? placed?.proof?.resultRunId;
  if (!resultRunId) throw new Error("That model milestone is locked or unavailable.");
  let retained = optimizationProofs.get(resultRunId);
  if (args.evidence !== undefined) {
    if (!args.evidence || typeof args.evidence !== "object") throw new Error("The pinned full evidence package is missing.");
    const supplied = args.evidence as { baseline?: unknown; optimization?: unknown };
    retained = { baseline: RunSummarySchema.parse(supplied.baseline), optimization: OptimizationEvidenceSchema.parse(supplied.optimization) };
  }
  if (!retained) throw new Error("Open the pinned complete evidence before placement. World metadata alone cannot grant construction.");
  if (retained.optimization.result.runId !== resultRunId) throw new Error("The pinned proof does not identify this milestone's exact result.");
  const transition = applyMilestonePlacement(world, request, retained.baseline, retained.optimization, { id: () => crypto.randomUUID(), now: Date.now });
  world = transition.world;
  return { world, growthEvents: transition.events };
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, op, args = {} } = event.data;
  try {
    let result: unknown;
    if (op === "init") {
      const restoredWorld = args.world ? WorldStateSchema.parse(args.world) : world;
      restoreRuns(args.runs);
      // Explicit snapshot initialization clears volatile evidence unless the
      // caller supplied the durable run ledger. It never plants extra trees.
      if (args.world && args.runs === undefined) runs.clear();
      if (args.world) optimizationProofs.clear();
      world = restoredWorld;
      result = { world };
    }
    else if (op === "simulate") result = runSimulation(args);
    else if (op === "sweep") result = runSweep(args);
    else if (op === "optimize") result = runOptimization(args);
    else if (op === "placeMilestone") result = placeMilestone(args);
    else if (op === "restoreEvidence") { restoreRuns(args.runs); result = { restored: true }; }
    else if (op === "calibration") result = calibrationFor(args.location as LocationId);
    else if (op === "profiles") result = { profiles: [...profiles.values()], representativeModel: { id: "representative-model", label: "Representative engineering profiles" } };
    else throw new Error(`Unsupported browser-engine operation: ${op}`);
    self.postMessage({ id, ok: true, result } satisfies ResponseMessage);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Browser engine failed" } satisfies ResponseMessage);
  }
};

export {};
