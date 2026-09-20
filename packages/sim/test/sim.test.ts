import { describe, it, expect } from "vitest";
import {
  simulateScenario, runMonteCarlo, optimizeIntervention, analyzeInterventions, seedFor,
  LOCATIONS, DEFAULT_CONFIG, DEFAULT_INTERVENTION, wilsonInterval, evidenceFingerprint,
  explainFailure, toRunSummary, validateIntervention, analyzeSensitivity,
  locationWithSiteData,
} from "../src/index.js";
import type { SiteDataProfile } from "@verdant/protocol";

const jaipur = LOCATIONS.jaipur;
const measuredProfile: SiteDataProfile = {
  id: "test-meter", label: "Test meter", scope: "COMMISSIONED_SITE", status: "VERIFIED_SITE",
  demand: { station: "test", firstDate: "2025-01-01", lastDate: "2025-12-31", readings: 35040, completeSlots: 96, meanMW: 1, peakMW: 2, multiplier15m: Array(96).fill(1) },
  pv: { firstDate: "2025-01-01", lastDate: "2025-12-31", readings: 35040, customers: 1, nativeResolutionMinutes: 15, normalizedResolutionMinutes: 15, capacityFactor15m: Array.from({ length: 96 }, (_, slot) => slot >= 24 && slot <= 72 ? 0.5 : 0) },
  reliability: { period: "2025", saidiMinutesPerCustomerYear: 120, saifiInterruptionsPerCustomerYear: 1, meanRestorationHours: 2, sourceResolution: "event log" },
  sources: ["DEMAND", "PV", "OUTAGE"].map((kind) => ({ kind: kind as "DEMAND" | "PV" | "OUTAGE", authority: "Test", title: `${kind} meter`, url: "https://example.com", period: "2025", nativeResolutionMinutes: 15, measured: true })),
  quality: { demandCompletenessPct: 100, pvCompletenessPct: 100, targetResolutionMinutes: 15, demandMethod: "meter", pvMethod: "meter", outageMethod: "event log" },
  disclosure: "Test fixture", fingerprint: "SITE-TEST",
};

describe("simulateScenario", () => {
  it("never reports a failure while total supply exceeds total demand all day", () => {
    // An oversized plant relative to load should never fail under normal weather:
    // this is a system-level invariant, not a tuned number.
    const generous = { ...DEFAULT_CONFIG, solarCapacityKW: 5000, batteryCapacityKWh: 100000, gridMaxImportKW: 5000, batteryStartPct: 100, batteryMaxChargeKW: 5000, batteryMaxDischargeKW: 5000, batteryMinSocPct: 0 };
    for (let i = 0; i < 50; i++) {
      const r = simulateScenario(seedFor(i), jaipur, "extreme", generous, DEFAULT_INTERVENTION, false);
      expect(r.failed).toBe(false);
    }
  });

  it("battery state of charge never leaves [0, 100]", () => {
    for (let i = 0; i < 30; i++) {
      const r = simulateScenario(seedFor(i), jaipur, "storm", DEFAULT_CONFIG, DEFAULT_INTERVENTION, true);
      for (const step of r.steps) {
        expect(step.socPct).toBeGreaterThanOrEqual(0);
        expect(step.socPct).toBeLessThanOrEqual(100);
      }
    }
  });

  it("carries the energy state through a full 72-hour horizon", () => {
    const generous = { ...DEFAULT_CONFIG, solarCapacityKW: 5000, batteryCapacityKWh: 20000, gridMaxImportKW: 5000, batteryStartPct: 100 };
    const result = simulateScenario(seedFor(7), jaipur, "normal", generous, DEFAULT_INTERVENTION, true);
    expect(result.steps).toHaveLength(288);
    expect(result.steps.at(-1)?.hour).toBe(71.75);
  });

  it("uses a verified operational profile while preserving deterministic replay", () => {
    const location = locationWithSiteData(jaipur, measuredProfile);
    const a = simulateScenario(seedFor(4), location, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION, true);
    const b = simulateScenario(seedFor(4), location, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION, true);
    const representative = simulateScenario(seedFor(4), jaipur, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION, true);
    expect(evidenceFingerprint(a)).toEqual(evidenceFingerprint(b));
    expect(a.steps.map((step) => step.solarKW)).not.toEqual(representative.steps.map((step) => step.solarKW));
  });

  it("produces non-negative engineering, cost, and carbon accounting", () => {
    const result = simulateScenario(seedFor(9), jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION, false);
    expect(result.criticalEnergyUnservedKWh).toBeGreaterThanOrEqual(0);
    expect(result.batteryThroughputKWh).toBeGreaterThanOrEqual(0);
    expect(result.gridEnergyKWh).toBeGreaterThanOrEqual(0);
    expect(result.operationalCost).toBeGreaterThanOrEqual(0);
    expect(result.carbonKg).toBeGreaterThanOrEqual(0);
    expect(result.criticalLossDurationHours).toBeGreaterThanOrEqual(0);
    expect(result.maxCriticalLossStreakHours).toBeLessThanOrEqual(result.criticalLossDurationHours);
    expect(result.lossOfLoadEvents).toBeGreaterThanOrEqual(0);
    expect(result.peakCriticalShortfallKW).toBeGreaterThanOrEqual(0);
    expect(result.solarCurtailedKWh).toBeGreaterThanOrEqual(0);
    expect(result.renewableServedKWh).toBeCloseTo(result.directSolarToLoadKWh + result.solarChargedBatteryToLoadKWh, 8);
    expect(result.avoidedGridCarbonKg).toBeCloseTo(result.renewableServedKWh * DEFAULT_CONFIG.gridCarbonKgPerKWh, 8);
    expect(result.solarChargedBatteryToLoadKWh).toBeLessThanOrEqual(result.batteryThroughputKWh + 1e-8);
    expect(result.energyBalanceMaxErrorKWh).toBeLessThan(1e-8);
    expect(result.energyBalanceErrorPct).toBeLessThan(1e-8);
  });

  it("conserves energy at every 15-minute dispatch step", () => {
    for (let i = 0; i < 20; i++) {
      const result = simulateScenario(seedFor(i), jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION, true);
      expect(Math.max(...result.steps.map((step) => step.energyBalanceErrorKWh))).toBeLessThan(1e-8);
    }
  });

  it("diagnoses a binding constraint and searches the disclosed rescue grid", () => {
    const underpowered = { ...DEFAULT_CONFIG, solarCapacityKW: 0, batteryCapacityKWh: 0, gridMaxImportKW: 0, batteryMaxDischargeKW: 0 };
    const result = simulateScenario(seedFor(1), jaipur, "extreme", underpowered, DEFAULT_INTERVENTION, true);
    const diagnosis = explainFailure(result, jaipur, "extreme", underpowered);
    expect(diagnosis?.constraint).toBeTruthy();
    expect(diagnosis?.criticalShortfallKW).toBeGreaterThan(0);
    expect(diagnosis?.minimumPolicy).toBeNull();
  });

  it("a raised emergency reserve never increases failures for the same weather", () => {
    // Reserving more battery exclusively for the hospital can only help or be
    // neutral for hospital survival — it must never make failure MORE likely.
    for (let i = 0; i < 40; i++) {
      const seed = seedFor(i);
      const noReserve = simulateScenario(seed, jaipur, "heatwave", DEFAULT_CONFIG, { ...DEFAULT_INTERVENTION, reservePct: 0 }, false);
      const withReserve = simulateScenario(seed, jaipur, "heatwave", DEFAULT_CONFIG, { ...DEFAULT_INTERVENTION, reservePct: 30 }, false);
      if (noReserve.failed) {
        // if the unreserved run already failed at some step, the reserved run
        // must not fail strictly earlier than it did
        expect(withReserve.failed ? withReserve.failStep : Infinity).toBeGreaterThanOrEqual(noReserve.failStep);
      }
    }
  });

  it("classifies the risk bucket consistently with failed/minSocPct", () => {
    for (let i = 0; i < 60; i++) {
      const r = simulateScenario(seedFor(i), jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION, false);
      if (r.failed) expect(r.bucket).toBe("critical");
      else if (r.minSocPct <= 15) expect(r.bucket).toBe("high");
      else if (r.minSocPct <= 40) expect(r.bucket).toBe("moderate");
      else expect(r.bucket).toBe("safe");
    }
  });
});

describe("runMonteCarlo", () => {
  it("bucket counts always sum to the requested population size", () => {
    const mc = runMonteCarlo(500, jaipur, "storm", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const sum = mc.counts.safe + mc.counts.moderate + mc.counts.high + mc.counts.critical;
    expect(sum).toBe(500);
  });

  it("is deterministic for a fixed config (same seeds every call)", () => {
    const a = runMonteCarlo(200, jaipur, "heatwave", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const b = runMonteCarlo(200, jaipur, "heatwave", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(a.counts).toEqual(b.counts);
    expect(evidenceFingerprint(a)).toEqual(evidenceFingerprint(b));
  });

  it("emits a passing audit and reproducibility manifest", () => {
    const mc = runMonteCarlo(100, jaipur, "storm", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const summary = toRunSummary("audit-run", mc);
    expect(summary.audit?.status).toBe("PASS");
    expect(summary.audit?.checks.every((check) => check.passed)).toBe(true);
    expect(summary.manifest?.deterministicReplay).toBe(true);
    expect(summary.manifest?.runFingerprint).toMatch(/^GRD-[0-9A-F]{8}$/);
  });

  it("binds the measured-data fingerprint into the run audit", () => {
    const location = locationWithSiteData(jaipur, measuredProfile);
    const mc = runMonteCarlo(100, location, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const summary = toRunSummary("meter-run", mc, undefined, undefined, 0, measuredProfile);
    expect(summary.audit?.checks).toHaveLength(7);
    expect(summary.audit?.checks.find((check) => check.id === "site_data")?.passed).toBe(true);
    expect(summary.manifest?.siteDataFingerprint).toBe("SITE-TEST");
  });

  it("reports bounded reliability and environmental tail-risk metrics", () => {
    const mc = runMonteCarlo(200, jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(mc.metrics.meanCriticalLossHours).toBeGreaterThanOrEqual(0);
    expect(mc.metrics.p95CriticalLossHours).toBeGreaterThanOrEqual(mc.metrics.meanCriticalLossHours);
    expect(mc.metrics.cvar95TotalUnservedKWh).toBeGreaterThanOrEqual(mc.metrics.meanTotalUnservedKWh);
    expect(mc.metrics.solarCapturePct).toBeGreaterThanOrEqual(0);
    expect(mc.metrics.solarCapturePct).toBeLessThanOrEqual(100);
    expect(mc.metrics.meanRenewableServedKWh).toBeGreaterThanOrEqual(0);
    expect(mc.metrics.meanAvoidedGridCarbonKg).toBeGreaterThanOrEqual(0);
    expect(mc.metrics.criticalRiskWilsonLowPct).toBeLessThanOrEqual(mc.metrics.criticalRiskPct);
    expect(mc.metrics.criticalRiskWilsonHighPct).toBeGreaterThanOrEqual(mc.metrics.criticalRiskPct);
    expect(mc.metrics.cvar99TotalUnservedKWh).toBeGreaterThanOrEqual(mc.metrics.p99TotalUnservedKWh);
    expect(mc.metrics.probabilityAnyUnservedPct).toBeGreaterThanOrEqual(mc.metrics.criticalRiskPct);
  });

  it("fits an interpretable risk surrogate on an untouched seed holdout", () => {
    const mc = runMonteCarlo(500, jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(mc.surrogate.trainingSize).toBe(400);
    expect(mc.surrogate.holdoutSize).toBe(100);
    expect(mc.surrogate.status).not.toBe("UNAVAILABLE");
    expect(mc.surrogate.auc).toBeGreaterThanOrEqual(0.5);
    expect(mc.surrogate.brierScore).toBeGreaterThanOrEqual(0);
    expect(mc.surrogate.calibrationErrorPct).toBeGreaterThanOrEqual(0);
    expect(mc.surrogate.balancedAccuracyPct).toBeGreaterThanOrEqual(0);
    expect(mc.surrogate.coefficients).toHaveLength(5);
    expect(mc.surrogate.authority).toContain("exact 15-minute dispatch");
  });

  it("replays the two dominant risk drivers together to quantify interaction", () => {
    const sensitivity = analyzeSensitivity(jaipur, "extreme", DEFAULT_CONFIG, 60);
    expect(sensitivity.interaction).toBeDefined();
    expect(sensitivity.interaction?.factorAId).not.toBe(sensitivity.interaction?.factorBId);
    expect(Number.isFinite(sensitivity.interaction?.interactionDeltaPct)).toBe(true);
    expect(sensitivity.method).toContain("second-order interaction");
  });

  it("a harsher preset never has a materially better safety record than 'normal'", () => {
    const normal = runMonteCarlo(800, jaipur, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const extreme = runMonteCarlo(800, jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(extreme.counts.critical).toBeGreaterThanOrEqual(normal.counts.critical);
  });
});

describe("statistical evidence", () => {
  it("reports a bounded Wilson interval containing the observed rate", () => {
    const interval = wilsonInterval(31, 2000);
    expect(interval.lowPct).toBeGreaterThanOrEqual(0);
    expect(interval.highPct).toBeLessThanOrEqual(100);
    expect(interval.lowPct).toBeLessThan(1.55);
    expect(interval.highPct).toBeGreaterThan(1.55);
  });

  it("can reserve a non-overlapping seed cohort for optimizer discovery", () => {
    const baseline = runMonteCarlo(40, jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    const holdout = runMonteCarlo(40, jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION, 40);
    expect(baseline.failures.map((x) => x.seed)).not.toEqual(holdout.failures.map((x) => x.seed));
  });
});

describe("optimizeIntervention", () => {
  it("never recommends a plan that performs worse than doing nothing, on its own sample", () => {
    const best = optimizeIntervention(jaipur, "extreme", DEFAULT_CONFIG, 150);
    let baseFail = 0, bestFail = 0;
    for (let i = 0; i < 150; i++) {
      const seed = seedFor(i);
      if (simulateScenario(seed, jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION, false).failed) baseFail++;
      if (simulateScenario(seed, jaipur, "extreme", DEFAULT_CONFIG, best, false).failed) bestFail++;
    }
    expect(bestFail).toBeLessThanOrEqual(baseFail);
  }, 15000);

  it("evaluates the full strategy grid and returns only multi-objective non-dominated plans", () => {
    const search = analyzeInterventions(jaipur, "extreme", DEFAULT_CONFIG, 40);
    expect(search.evaluatedStrategies).toBe(7 * 7 * 5);
    expect(search.frontier.length).toBeGreaterThan(0);
    for (const candidate of search.frontier) {
      const dominated = search.frontier.some((other) =>
        other !== candidate &&
        other.riskPct <= candidate.riskPct &&
        other.disruptionScore <= candidate.disruptionScore &&
        other.meanOperationalCost <= candidate.meanOperationalCost &&
        other.meanUnservedKWh <= candidate.meanUnservedKWh &&
        other.meanCarbonKg <= candidate.meanCarbonKg &&
        (other.riskPct < candidate.riskPct || other.disruptionScore < candidate.disruptionScore || other.meanOperationalCost < candidate.meanOperationalCost || other.meanUnservedKWh < candidate.meanUnservedKWh || other.meanCarbonKg < candidate.meanCarbonKg),
      );
      expect(dominated).toBe(false);
    }
  }, 15000);

  it("can optimize one cohort across all five hazard regimes", () => {
    const search = analyzeInterventions(jaipur, "extreme", DEFAULT_CONFIG, 25, 500, ["normal", "heatwave", "storm", "evsurge", "extreme"]);
    expect(search.hazardCount).toBe(5);
    expect(search.seedOffset).toBe(500);
  }, 15000);

  it("reports disjoint optimizer holdouts and simple-policy benchmarks", () => {
    const search = analyzeInterventions(jaipur, "extreme", DEFAULT_CONFIG, 20, 900, ["normal", "heatwave", "storm", "evsurge", "extreme"]);
    const validation = validateIntervention(jaipur, DEFAULT_CONFIG, search.best.intervention, 2000, 20, undefined, search.frontier.map((candidate) => candidate.intervention));
    expect(validation.cohorts).toHaveLength(3);
    expect(new Set(validation.cohorts.map((cohort) => cohort.seedOffset)).size).toBe(3);
    expect(validation.benchmarks.map((item) => item.label)).toContain("Grounded policy");
    expect(validation.benchmarks.every((item) => Number.isFinite(item.meanCarbonKg))).toBe(true);
    expect(validation.assumptionShocks).toHaveLength(4);
    expect(validation.shockResults).toHaveLength(4);
    expect(validation.cohorts.every((cohort) => cohort.preventedFailures >= 0 && cohort.introducedFailures >= 0)).toBe(true);
    expect(validation.cohorts.every((cohort) => cohort.afterWilsonHighPct >= cohort.afterCriticalPct)).toBe(true);
    expect(validation.cohorts.every((cohort) => cohort.pairedPValue >= 0 && cohort.pairedPValue <= 1)).toBe(true);
    expect(validation.statisticallyResolvedCohorts).toBe(validation.cohorts.filter((cohort) => cohort.pairedPValue < 0.05).length);
    expect(validation.jointStressEnvelope.evaluatedCells).toBe(81);
    expect(validation.jointStressEnvelope.dimensions).toHaveLength(4);
    expect(validation.jointStressEnvelope.sampleSizePerCell).toBe(20);
    expect(validation.jointStressEnvelope.passingCells).toBeLessThanOrEqual(81);
    expect(validation.jointStressEnvelope.zeroRegressionCells).toBeLessThanOrEqual(81);
    expect(validation.jointStressEnvelope.worstCell.label.length).toBeGreaterThan(0);
    expect(validation.decisionStability.candidateCount).toBeGreaterThan(1);
    expect(validation.decisionStability.cohorts).toHaveLength(3);
    expect(validation.decisionStability.cohorts.every((cohort) => cohort.recommendedRank >= 1 && cohort.recommendedRank <= cohort.candidateCount)).toBe(true);
    expect(validation.decisionStability.maxRiskRegretPct).toBeGreaterThanOrEqual(0);
  }, 30000);
});
