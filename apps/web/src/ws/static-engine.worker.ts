/// <reference lib="webworker" />

import type { ClimateCalibration, GrowthEvent, LocationId, MicrogridConfig, PresetId, RunSummary, SiteDataProfile, WorldState } from "@verdant/protocol";
import { ClimateCalibration as ClimateCalibrationSchema, SiteDataProfile as SiteDataProfileSchema, WorldState as WorldStateSchema } from "@verdant/protocol";
import { parseAnalysisRequest } from "./engineRequest";
import { assessRun } from "../lib/analysisContext";
import {
  DEFAULT_INTERVENTION, LOCATIONS, PRESET_ORDER, analyzeInterventions, analyzeSensitivity,
  locationFromCalibration, locationWithSiteData, runMonteCarlo, toRunSummary, validateIntervention,
} from "@verdant/sim";
import climateCache from "../../../server/climate-cache.json" with { type: "json" };
import measuredReferenceJson from "../../../../data/ausgrid-measured-reference.json" with { type: "json" };

type RequestMessage = { id: string; op: string; args?: Record<string, unknown> };
type ResponseMessage = { id: string; ok: boolean; result?: unknown; error?: string };

const measuredReference = SiteDataProfileSchema.parse(measuredReferenceJson);
const profiles = new Map<string, SiteDataProfile>([[measuredReference.id, measuredReference]]);
const runs = new Map<string, RunSummary>();
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

function spiralCell(index: number): { gx: number; gy: number } {
  const center = 12;
  let x = 0, y = 0, dx = 0, dy = -1;
  for (let i = 0; i < 625; i++) {
    if (i === index) break;
    if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) { const next = dx; dx = -dy; dy = next; }
    x += dx; y += dy;
  }
  return { gx: Math.min(24, Math.max(0, center + x)), gy: Math.min(24, Math.max(0, center + y)) };
}

function recordRun(summary: RunSummary): GrowthEvent[] {
  if (!assessRun(summary, 100).audited || world.trees.some((tree) => tree.runId === summary.runId)) return [];
  const events: GrowthEvent[] = [];
  const safeRatio = (summary.counts.safe + summary.counts.moderate) / Math.max(1, summary.n);
  const species = safeRatio >= 0.97 ? "ancient" : safeRatio >= 0.85 ? "flowering" : safeRatio >= 0.6 ? "oak" : "sapling";
  const cell = spiralCell(world.trees.length + world.buildings.length);
  const tree = { id: crypto.randomUUID(), ...cell, species, plantedAt: Date.now(), runId: summary.runId } as const;
  world = { ...world, trees: [...world.trees, tree], totalRuns: world.totalRuns + 1, totalFuturesSimulated: world.totalFuturesSimulated + summary.n };
  events.push({ kind: "tree.planted", runId: summary.runId, tree, message: `A ${species} tree took root from a ${summary.n.toLocaleString()}-future run.` });
  return events;
}

/** One verified milestone per baseline; rerunning the same search is not new evidence. */
export function recordOptimization(before: RunSummary, after: RunSummary): GrowthEvent[] {
  if (!assessRun(before, 100).audited || !assessRun(after, 100).audited || before.n !== after.n) return [];
  const improvement = before.counts.critical > 0 ? (1 - after.counts.critical / before.counts.critical) * 100 : 0;
  const improvementPct = Math.round(improvement);
  world = { ...world, bestImprovementPct: Math.max(world.bestImprovementPct, improvementPct) };
  if (before.counts.critical <= 0 || improvement < 90 || world.buildings.some((building) => building.runId === before.runId)) return [];
  const cell = spiralCell(world.trees.length + world.buildings.length);
  const kind = after.counts.critical === 0 ? "reservoir" as const : "resilienceHall" as const;
  const milestone = after.counts.critical === 0
    ? `No critical failures observed in this ${after.n.toLocaleString()}-future sample; ${before.counts.critical.toLocaleString()} baseline failures avoided. Not a field reliability guarantee.`
    : `${improvementPct}% of critical failures eliminated by the recommended intervention.`;
  const building = { id: crypto.randomUUID(), ...cell, kind, grownAt: Date.now(), runId: before.runId, milestone };
  world = { ...world, buildings: [...world.buildings, building] };
  return [{ kind: "building.grown", runId: before.runId, building, message: milestone }];
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
  const before = runs.get(args.runId as string);
  if (!before) throw new Error("Run a simulation before optimizing in this browser session");
  const calibration = before.calibration ?? calibrationFor(before.location);
  const location = locationFromCalibration(locationWithSiteData(LOCATIONS[before.location], before.siteData), calibration);
  const analysis = analyzeInterventions(location, before.preset, before.config, 300, before.n, PRESET_ORDER);
  const intervention = analysis.best.intervention;
  const validation = validateIntervention(location, before.config, intervention, before.n + 10_000, 200, PRESET_ORDER, analysis.frontier.map((candidate) => candidate.intervention));
  const mc = runMonteCarlo(before.n, location, before.preset, before.config, intervention);
  const after = toRunSummary(crypto.randomUUID(), mc, calibration, undefined, 0, before.siteData);
  runs.set(after.runId, after);
  const growthEvents = recordOptimization(before, after);
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
  return { intervention, result: after, growthEvents, analysis, validation, historicalBacktest, world };
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, op, args = {} } = event.data;
  try {
    let result: unknown;
    if (op === "init") { world = args.world ? WorldStateSchema.parse(args.world) : world; result = { world }; }
    else if (op === "simulate") result = runSimulation(args);
    else if (op === "sweep") result = runSweep(args);
    else if (op === "optimize") result = runOptimization(args);
    else if (op === "calibration") result = calibrationFor(args.location as LocationId);
    else if (op === "profiles") result = { profiles: [...profiles.values()], representativeModel: { id: "representative-model", label: "Representative engineering profiles" } };
    else throw new Error(`Unsupported browser-engine operation: ${op}`);
    self.postMessage({ id, ok: true, result } satisfies ResponseMessage);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error instanceof Error ? error.message : "Browser engine failed" } satisfies ResponseMessage);
  }
};

export {};
