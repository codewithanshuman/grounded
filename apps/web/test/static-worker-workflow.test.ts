import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ClimateCalibration, ClimateSweepResult, RunSummary, SiteDataProfile, WorldState, type GrowthEvent } from "@verdant/protocol";
import { DEFAULT_CONFIG, simulateScenario } from "@verdant/sim";
import type { OptimizeResponse } from "../src/ws/client";
import { replayLocation } from "../src/lib/runReplay";

/** Real dispatch boundary and real simulation/search engines; only worker transport is in-process. */
describe("Static worker complete analysis workflow", () => {
  const worker = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage: vi.fn() };
  let requestId = 0;
  function dispatch<T>(op: string, args: Record<string, unknown> = {}): T {
    const id = `integration-${++requestId}`;
    worker.postMessage.mockClear();
    worker.onmessage!({ data: { id, op, args } });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const response = worker.postMessage.mock.lastCall![0] as { id: string; ok: boolean; error?: string; result: T };
    expect(response.id).toBe(id);
    expect(response.ok, `${op} failed: ${response.error ?? "unknown error"}`).toBe(true);
    return response.result;
  }

  beforeAll(async () => {
    vi.stubGlobal("self", worker);
    await import("../src/ws/static-engine.worker");
  });
  afterAll(() => vi.unstubAllGlobals());

  it("initializes, loads evidence, runs, replays, optimizes twice without duplicate growth, and sweeps", () => {
    const initialized = dispatch<{ world: WorldState }>("init", { world: { trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0 } });
    expect(WorldState.parse(initialized.world).totalRuns).toBe(0);
    const profiles = dispatch<{ profiles: SiteDataProfile[] }>("profiles").profiles.map((profile) => SiteDataProfile.parse(profile));
    const measured = profiles.find((profile) => profile.id === "ausgrid-measured-reference-v1")!;
    expect(measured.scope).toBe("PUBLIC_REFERENCE");
    expect(measured.fingerprint.length).toBeGreaterThan(0);
    const climate = ClimateCalibration.parse(dispatch("calibration", { location: "jaipur" }));
    expect(climate.status).toBe("cached");
    expect(climate.source).toBe("NASA_POWER");

    const request = { location: "jaipur", preset: "extreme", config: { ...DEFAULT_CONFIG }, scenarioCount: 500, siteDataProfileId: measured.id };
    const simulated = dispatch<{ summary: RunSummary; growthEvents: GrowthEvent[]; world: WorldState }>("simulate", request);
    const baseline = RunSummary.parse(simulated.summary);
    expect(baseline.n).toBe(500);
    expect(baseline.audit?.status).toBe("PASS");
    expect(baseline.audit?.checks.every((check) => check.passed)).toBe(true);
    expect(baseline.manifest?.deterministicReplay).toBe(true);
    expect(baseline.manifest?.scenarioCount).toBe(500);
    expect(baseline.manifest?.calibrationFingerprint).toBe(climate.fingerprint);
    expect(baseline.siteData?.fingerprint).toBe(measured.fingerprint);
    expect(Object.values(baseline.counts).reduce((total, value) => total + value, 0)).toBe(500);
    expect(baseline.counts.critical).toBeGreaterThan(0);
    expect(baseline.metrics?.meanCriticalUnservedKWh).toBeGreaterThan(0);
    expect(simulated.world.totalRuns).toBe(1);
    expect(simulated.world.totalFuturesSimulated).toBe(500);
    expect(simulated.world.trees).toHaveLength(1);
    expect(simulated.growthEvents[0].runId).toBe(baseline.runId);
    const retained = baseline.failures[0];
    const replay = simulateScenario(retained.seed, replayLocation(baseline), baseline.preset, baseline.config, baseline.intervention, true);
    expect(replay.failStep).toBe(retained.failStep);
    expect(replay.criticalEnergyUnservedKWh).toBeCloseTo(retained.criticalEnergyUnservedKWh, 8);

    const first = dispatch<OptimizeResponse & { world: WorldState }>("optimize", { runId: baseline.runId });
    expect(RunSummary.parse(first.result).audit?.status).toBe("PASS");
    expect(first.result.runId).not.toBe(baseline.runId);
    expect(first.result.manifest?.deterministicReplay).toBe(true);
    expect(first.result.siteData?.fingerprint).toBe(measured.fingerprint);
    expect(first.result.n).toBe(baseline.n);
    expect(first.analysis.evaluatedStrategies).toBe(245);
    expect(first.analysis.sampleSize).toBe(300);
    expect(first.analysis.seedOffset).toBe(baseline.n);
    expect(first.analysis.hazardCount).toBe(5);
    expect(first.analysis.frontier.length).toBeGreaterThan(0);
    expect(first.validation.cohorts).toHaveLength(3);
    expect(first.validation.cohorts.every((cohort) => cohort.sampleSize === 200 && cohort.seedOffset >= 10_500)).toBe(true);
    expect(first.validation.jointStressEnvelope.evaluatedCells).toBe(81);
    expect(first.validation.decisionStability.cohorts).toHaveLength(3);
    expect(first.historicalBacktest.periods).toBeGreaterThan(0);
    expect(first.historicalBacktest.futures).toBe(first.historicalBacktest.periods * 24);
    expect(first.world.totalRuns).toBe(1);
    expect(first.world.totalFuturesSimulated).toBe(500);
    const qualifying = (baseline.counts.critical - first.result.counts.critical) / baseline.counts.critical >= 0.9;
    expect(first.world.buildings).toHaveLength(qualifying ? 1 : 0);

    const repeated = dispatch<OptimizeResponse & { world: WorldState }>("optimize", { runId: baseline.runId });
    expect(repeated.result.runId).not.toBe(first.result.runId);
    expect(repeated.result.counts).toEqual(first.result.counts);
    expect(repeated.result.manifest?.runFingerprint).toBe(first.result.manifest?.runFingerprint);
    expect(repeated.intervention).toEqual(first.intervention);
    expect(repeated.growthEvents).toEqual([]);
    expect(repeated.world.buildings).toEqual(first.world.buildings);
    expect(repeated.world.trees).toEqual(simulated.world.trees);

    const sweep = ClimateSweepResult.parse(dispatch("sweep", { ...request, scenarioCount: 100 }));
    expect(sweep.scenarios).toHaveLength(5);
    expect(sweep.scenarios.every((scenario) => Object.values(scenario.counts).reduce((total, value) => total + value, 0) === 100)).toBe(true);
    expect(sweep.robustScore).toBe(Math.min(...sweep.scenarios.map((scenario) => scenario.resilienceScore)));
    const finalWorld = dispatch<{ world: WorldState }>("init").world;
    expect(finalWorld).toEqual(repeated.world);
    console.info("Static workflow evidence", JSON.stringify({ baselineCritical: baseline.counts.critical, optimizedCritical: first.result.counts.critical, holdoutsPassed: first.validation.passedCohorts, holdouts: first.validation.cohortCount, trees: finalWorld.trees.length, buildings: finalWorld.buildings.length, sweepHazards: sweep.scenarios.length }));
  }, 300_000);
});
