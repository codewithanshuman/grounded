import { describe, expect, it } from "vitest";
import { StoredEvidence, type StoredEvidence as Evidence } from "@verdant/protocol/evidence";
import { ClimateCalibration } from "@verdant/protocol";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, LOCATIONS, MODEL_VERSION, PRESET_ORDER, analyzeInterventions,
  locationFromCalibration, runMonteCarlo, toRunSummary, validateIntervention } from "../src/index";
import { replayEvidence } from "../src/proofReplay";
import { optimizeInfrastructure } from "../src/investmentOptimizer";
import climateCache from "../../../apps/server/climate-cache.json" with { type: "json" };

function proof(): Evidence {
  const baseline = toRunSummary("baseline-replay", runMonteCarlo(500, LOCATIONS.jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION));
  return StoredEvidence.parse({ schemaVersion: 1, recordId: "550e8400-e29b-41d4-a716-446655440000", ownerScope: "test-workspace",
    savedAt: Date.now(), modelVersion: MODEL_VERSION, riskTargetPct: 5, baseline, optimization: null });
}

describe("Read-only complete model proof replay", () => {
  it("replays a real baseline exactly without altering the saved proof", () => {
    const payload = proof(), before = JSON.stringify(payload);
    const result = replayEvidence(payload);
    expect(result.status).toBe("PASS");
    expect(result.scope).toBe("BASELINE_ONLY");
    expect(result.replayedStages).toEqual(["Baseline run"]);
    expect(result.checks.every((check) => check.passed)).toBe(true);
    expect(result.statement).toContain("Not a source-authenticity check");
    expect(JSON.stringify(payload)).toBe(before);
  });
  it("detects a changed metric even when counts and source labels are unchanged", () => {
    const payload = proof();
    payload.baseline.metrics!.meanCriticalUnservedKWh += 0.1;
    const result = replayEvidence(payload);
    expect(result.status).toBe("FAIL");
    expect(result.checks.find((check) => check.label === "Baseline run")?.detail).toContain("meanCriticalUnservedKWh");
  });
  it("refuses a different model before running simulation", () => {
    const payload = proof(); payload.modelVersion = "legacy-model";
    const result = replayEvidence(payload);
    expect(result.status).toBe("FAIL");
    expect(result.scope).toBe("REJECTED");
    expect(result.replayedStages).toEqual([]);
    expect(result.checks[0].detail).toContain("Model mismatch");
  });
  it.each([-1, 0.5, 1_000_001])("refuses unsupported seed offset %s before running simulation", (offset) => {
    const payload = proof(); payload.baseline.manifest!.seedOffset = offset;
    expect(replayEvidence(payload)).toMatchObject({ status: "FAIL", scope: "REJECTED", replayedStages: [] });
  });
  it("refuses oversized populations instead of doing unbounded work", () => {
    const payload = proof(); payload.baseline.n = 10_001;
    expect(replayEvidence(payload)).toMatchObject({ status: "FAIL", scope: "REJECTED", replayedStages: [] });
  });
  it("detects an altered retained failure trajectory", () => {
    const payload = proof();
    expect(payload.baseline.failures.length).toBeGreaterThan(0);
    payload.baseline.failures[0].criticalEnergyUnservedKWh += 0.01;
    const result = replayEvidence(payload);
    expect(result.status).toBe("FAIL");
    expect(result.checks.find((check) => check.label === "Baseline run")?.detail).toContain("failures");
  });
  it("replays every declared optimization stage, including unresolved evidence, without a growth shortcut", () => {
    const calibration = ClimateCalibration.parse({ ...climateCache.jaipur, status: "cached" });
    const location = locationFromCalibration(LOCATIONS.jaipur, calibration);
    const baseline = toRunSummary("full-baseline", runMonteCarlo(100, location, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION), calibration);
    const analysis = analyzeInterventions(location, baseline.preset, baseline.config, 100, 100, PRESET_ORDER, 5);
    const intervention = analysis.best.intervention;
    const validation = validateIntervention(location, baseline.config, intervention, 10_100, 100, PRESET_ORDER,
      analysis.frontier.map((candidate) => candidate.intervention), 5);
    const optimized = toRunSummary("full-optimized", runMonteCarlo(100, location, baseline.preset, baseline.config, intervention), calibration);
    let beforeCritical = 0, afterCritical = 0, passedPeriods = 0;
    const periods = calibration.historicalDays.length ? calibration.historicalDays : calibration.monthly.map((month) => ({ ...month, date: month.month }));
    periods.forEach((period, index) => {
      const historical = locationFromCalibration(LOCATIONS.jaipur, calibration, { ...period, month: period.date });
      const before = runMonteCarlo(24, historical, baseline.preset, baseline.config, DEFAULT_INTERVENTION, 50_000 + index * 24);
      const after = runMonteCarlo(24, historical, baseline.preset, baseline.config, intervention, 50_000 + index * 24);
      beforeCritical += before.counts.critical; afterCritical += after.counts.critical;
      if (after.counts.critical === 0) passedPeriods++;
    });
    const investmentAnalysis = optimizeInfrastructure(location, baseline.preset, baseline.config, {
      sampleSizePerHazard: 20, seedOffset: 100_000, hazards: PRESET_ORDER, targetCriticalRiskPct: 5,
      intervention, solarOptionsKW: [0], batteryOptionsKWh: [0], generatorOptionsKW: [0, 400], demandControlOptionsPct: [0],
    });
    const payload = StoredEvidence.parse({ ...proof(), baseline,
      optimization: { intervention, result: optimized, growthEvents: [], analysis, validation,
        investmentAnalysis,
        historicalBacktest: { periods: periods.length, futures: periods.length * 24, beforeCritical, afterCritical, passedPeriods,
          source: calibration.source, label: calibration.historicalDays.length
            ? "12 highest-stress observed NASA POWER climate days from 2023; outage and demand remain simulated"
            : "12 representative monthly climate profiles; all operational conditions are simulated" } } });
    const original = JSON.stringify(payload);
    const replayed = replayEvidence(payload);
    expect(replayed.status, JSON.stringify(replayed.checks)).toBe("PASS");
    expect(replayed.scope).toBe("FULL_OPTIMIZATION");
    expect(replayed.replayedStages).toEqual(["Baseline run", "Optimized run", "Discovery search", "Independent validation", "Historical climate replay", "Physical investment search"]);
    expect(replayed.checks.every((check) => check.passed)).toBe(true);
    expect(JSON.stringify(payload)).toBe(original);
    // Replay PASS means reproducible, never that a small unresolved cohort
    // suddenly constitutes a certified policy or earns a building.
    expect(payload.optimization!.validation.cohorts.every((cohort) => !cohort.targetMet)).toBe(true);
    const altered = structuredClone(payload);
    if (altered.optimization?.investmentAnalysis?.model !== "GROUNDED_INFRASTRUCTURE_PARETO_V2") throw new Error("Missing investment fixture");
    altered.optimization.investmentAnalysis.recommendation.capex += 1;
    const tampered = replayEvidence(altered);
    expect(tampered.status).toBe("FAIL");
    expect(tampered.checks.find((check) => check.label === "Physical investment search")).toMatchObject({ passed: false });
    altered.optimization.investmentAnalysis.replayPlan.intervention.reservePct += 1;
    expect(replayEvidence(altered)).toMatchObject({ status: "FAIL", scope: "REJECTED", replayedStages: [] });
    altered.optimization.investmentAnalysis = { model: "GROUNDED_INFRASTRUCTURE_PARETO_V1" };
    expect(replayEvidence(altered)).toMatchObject({ status: "FAIL", scope: "REJECTED", replayedStages: [] });
  }, 180_000);
});
