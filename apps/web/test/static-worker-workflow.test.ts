import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ClimateCalibration, ClimateSweepResult, RunSummary, SiteDataProfile, WorldState, type GrowthEvent } from "@verdant/protocol";
import { DEFAULT_CONFIG, simulateScenario } from "@verdant/sim";
import type { OptimizeResponse } from "../src/ws/client";
import { replayLocation } from "../src/lib/runReplay";
import { assessDecisionReadiness } from "../src/lib/decisionReadiness";
import { assessOptimizationGrowth } from "@verdant/sim/growth";
import { sealEvidence, verifyEvidence } from "../src/lib/evidenceStore";

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
  function rejected(op: string, args: Record<string, unknown>, message: string): void {
    worker.postMessage.mockClear();
    worker.onmessage!({ data: { id: `reject-${++requestId}`, op, args } });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    const response = worker.postMessage.mock.lastCall![0] as { ok: boolean; error?: string };
    expect(response.ok).toBe(false);
    expect(response.error).toContain(message);
  }

  beforeAll(async () => {
    vi.stubGlobal("self", worker);
    await import("../src/ws/static-engine.worker");
  });
  afterAll(() => vi.unstubAllGlobals());

  it("runs and preserves V2 investment evidence, respects cached budget policies without duplicate growth, and sweeps", async () => {
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

    // An invalid budget must fail at the request boundary, before looking up a
    // run or executing a search; rejection also leaves existing evidence intact.
    for (const budgetCapex of [-1, Infinity, -Infinity, NaN]) {
      rejected("optimize", { runId: "missing-baseline", budgetCapex }, "budgetCapex");
      rejected("optimize", { runId: baseline.runId, budgetCapex }, "budgetCapex");
    }
    expect(dispatch<{ world: WorldState }>("init").world).toEqual(simulated.world);

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
    expect(first.validation.cohorts.every((cohort) => cohort.sampleSize === 300 && cohort.seedOffset >= 10_500)).toBe(true);
    expect(first.analysis.riskTargetPct).toBe(5);
    expect(first.validation.riskTargetPct).toBe(5);
    expect(first.validation.cohorts.every((cohort) => cohort.clusterUncertainty.clusterCount === 60)).toBe(true);
    expect(first.validation.jointStressEnvelope.evaluatedCells).toBe(81);
    expect(first.validation.decisionStability.cohorts).toHaveLength(3);
    const investment = first.investmentAnalysis!;
    expect(investment.model).toBe("GROUNDED_INFRASTRUCTURE_PARETO_V2");
    expect(investment.budgetCapex).toBeNull();
    expect(investment.evaluatedCandidates).toBe(16);
    expect(investment.candidates).toHaveLength(investment.evaluatedCandidates);
    expect(new Set(investment.candidates.map((candidate) => candidate.id)).size).toBe(investment.evaluatedCandidates);
    expect(investment.frontier.length).toBeGreaterThan(0);
    expect(investment.candidates).toContainEqual(investment.recommendation);
    expect(investment.validation.method).toBe("FROZEN_CANDIDATE_TWO_HOLDOUTS_V1");
    expect(investment.validation.cohorts).toHaveLength(2);
    expect(investment.validation.cohorts.map((cohort) => cohort.seedOffset)).toEqual(investment.replayPlan.validationSeedOffsets);
    expect(investment.validation.cohorts.every((cohort) => cohort.recommendation.id === investment.recommendation.id)).toBe(true);
    expect(investment.uncertainty.epistemic.length).toBeGreaterThan(0);
    expect(investment.uncertainty.epistemic).toContainEqual(investment.uncertainty.topPriority);
    const investmentSnapshot = structuredClone(investment);
    const sealed = await sealEvidence("guest", baseline, first, 5);
    const restoredEvidence = await verifyEvidence(JSON.parse(JSON.stringify(sealed)), "guest");
    // Equality of the whole report protects every portfolio, holdout cluster,
    // cost assumption, replay parameter, and measurement priority from stripping.
    expect(restoredEvidence.optimization?.investmentAnalysis).toEqual(investmentSnapshot);
    const planning=assessDecisionReadiness(baseline,first,5);
    expect(planning.evidenceValid).toBe(true);
    expect(assessDecisionReadiness(baseline, first, 1).withinTarget).toBe(false); // Changing the target requires rerunning the search.
    expect(planning.holdouts).toHaveLength(3);
    expect(first.historicalBacktest.periods).toBeGreaterThan(0);
    expect(first.historicalBacktest.futures).toBe(first.historicalBacktest.periods * 24);
    expect(first.world.totalRuns).toBe(1);
    expect(first.world.totalFuturesSimulated).toBe(500);
    const qualifying = assessOptimizationGrowth(baseline, first.result, first, 5).eligible;
    expect(first.world.buildings).toHaveLength(0); // Successful evidence earns a choice, not an automatic building.
    expect((first.world.pendingMilestones?.length ?? 0) > 0).toBe(qualifying);

    const repeated = dispatch<OptimizeResponse & { world: WorldState }>("optimize", { runId: baseline.runId });
    expect(repeated.result.runId).not.toBe(first.result.runId);
    expect(repeated.result.counts).toEqual(first.result.counts);
    expect(repeated.result.manifest?.runFingerprint).toBe(first.result.manifest?.runFingerprint);
    expect(repeated.intervention).toEqual(first.intervention);
    expect(repeated.investmentAnalysis).toEqual(investmentSnapshot);
    expect(repeated.growthEvents).toEqual([]);
    expect(repeated.world).toEqual(first.world);
    expect(repeated.world.buildings).toEqual(first.world.buildings);
    expect(repeated.world.trees).toEqual(simulated.world.trees);

    // This is the only additional uncached search: a zero budget must not
    // reuse the unlimited report, even for exactly the same run and target.
    const zeroBudget = dispatch<OptimizeResponse & { world: WorldState }>("optimize", { runId: baseline.runId, budgetCapex: 0 });
    expect(zeroBudget.investmentAnalysis?.budgetCapex).toBe(0);
    expect(zeroBudget.investmentAnalysis?.replayPlan.budgetCapex).toBe(0);
    expect(zeroBudget.investmentAnalysis?.recommendation.capex).toBe(0);
    expect(zeroBudget.investmentAnalysis?.recommendation.withinBudget).toBe(true);
    expect(zeroBudget.investmentAnalysis?.candidates.some((candidate) => candidate.capex > 0 && !candidate.withinBudget)).toBe(true);
    expect(zeroBudget.investmentAnalysis).not.toEqual(investmentSnapshot);
    expect(zeroBudget.result.counts).toEqual(first.result.counts);
    expect(zeroBudget.growthEvents).toEqual([]);
    expect(zeroBudget.world).toEqual(repeated.world);
    const zeroBudgetSnapshot = structuredClone(zeroBudget.investmentAnalysis);
    const repeatedZeroBudget = dispatch<OptimizeResponse & { world: WorldState }>("optimize", { runId: baseline.runId, budgetCapex: 0 });
    expect(repeatedZeroBudget.investmentAnalysis).toEqual(zeroBudgetSnapshot);
    expect(repeatedZeroBudget.growthEvents).toEqual([]);
    expect(repeatedZeroBudget.world).toEqual(repeated.world);
    expect(first.investmentAnalysis).toEqual(investmentSnapshot);
    expect(zeroBudget.investmentAnalysis).toEqual(zeroBudgetSnapshot);

    // Full evidence reload supplies the original baseline to the new worker;
    // restoring a rendered world alone cannot invent those source inputs.
    const restored = dispatch<{ world: WorldState }>("init", { world: repeated.world, runs: [baseline, first.result, repeated.result] });
    expect(restored.world).toEqual(repeated.world);
    expect(dispatch("restoreEvidence", { runs: [baseline, first.result] })).toEqual({ restored: true });
    expect(dispatch<{ world: WorldState }>("init").world).toEqual(repeated.world);
    rejected("restoreEvidence", { runs: [baseline, baseline] }, "duplicate run identifiers");
    const afterReload = dispatch<OptimizeResponse & { world: WorldState }>("optimize", { runId: baseline.runId, riskTargetPct: 5 });
    expect(afterReload.result.counts).toEqual(first.result.counts);
    expect(afterReload.result.manifest?.runFingerprint).toBe(first.result.manifest?.runFingerprint);
    expect(afterReload.investmentAnalysis).toEqual(investmentSnapshot);
    expect(afterReload.world).toEqual(repeated.world);
    expect(afterReload.growthEvents).toEqual([]);
    rejected("optimize", { runId: afterReload.result.runId, riskTargetPct: 5 }, "no-intervention baseline");
    rejected("init", { world: afterReload.world, runs: [{ ...baseline, manifest: { ...baseline.manifest!, modelVersion: "legacy" } }] }, "another model");
    rejected("init", { world: afterReload.world, runs: [{ ...baseline, manifest: { ...baseline.manifest!, calibrationFingerprint: "tampered" } }] }, "inconsistent source");
    expect(dispatch<{ world: WorldState }>("init").world).toEqual(repeated.world);
    const reviewRun = { ...baseline, runId: "review-only", audit: { ...baseline.audit!, status: "REVIEW" } };
    expect(dispatch<{ world: WorldState }>("init", { world: afterReload.world, runs: [reviewRun] }).world).toEqual(repeated.world);

    const sweep = ClimateSweepResult.parse(dispatch("sweep", { ...request, scenarioCount: 100 }));
    expect(sweep.scenarios).toHaveLength(5);
    expect(sweep.scenarios.every((scenario) => Object.values(scenario.counts).reduce((total, value) => total + value, 0) === 100)).toBe(true);
    expect(sweep.robustScore).toBe(Math.min(...sweep.scenarios.map((scenario) => scenario.resilienceScore)));
    const finalWorld = dispatch<{ world: WorldState }>("init").world;
    expect(finalWorld).toEqual(repeated.world);
    dispatch("init", { world: finalWorld });
    rejected("optimize", { runId: baseline.runId, riskTargetPct: 5 }, "Run a simulation before optimizing");
    console.info("Static workflow evidence", JSON.stringify({ baselineCritical: baseline.counts.critical, optimizedCritical: first.result.counts.critical, holdoutsPassed: first.validation.passedCohorts, holdouts: first.validation.cohortCount, trees: finalWorld.trees.length, buildings: finalWorld.buildings.length, sweepHazards: sweep.scenarios.length }));
  }, 300_000);
});
