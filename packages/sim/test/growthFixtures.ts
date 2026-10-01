import type { RunSummary } from "@verdant/protocol";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, MODEL_VERSION, exactMcNemarPValue, summarizeSeedClusters } from "../src/index.js";
import { criticalRiskInterval, type OptimizationEvidence } from "../src/decisionReadiness.js";

export function growthBaseline(critical = 100, runId = "baseline"): RunSummary {
  return { runId, n: 500, location: "jaipur", preset: "normal", config: { ...DEFAULT_CONFIG }, intervention: { ...DEFAULT_INTERVENTION },
    counts: { safe: 500 - critical, moderate: 0, high: 0, critical }, causeCounts: {}, failures: [], createdAt: 1,
    audit: { status: "PASS", checks: [{ id: "conservation", label: "Conservation", passed: true, value: "pass" }], maxEnergyBalanceErrorKWh: 0, energyBalanceErrorPct: 0 },
    manifest: { runFingerprint: runId, modelVersion: MODEL_VERSION, engine: "test", horizonHours: 72, timestepMinutes: 15,
      seedOffset: 0, seedScheme: "test", scenarioCount: 500, calibrationFingerprint: "climate", deterministicReplay: true } };
}

export function growthEvidence(before = growthBaseline(), targetPct = 5): OptimizationEvidence {
  const cluster = (sampleSize: number, seedOffset: number) => summarizeSeedClusters(Array.from({ length: sampleSize / 5 }, (_, index) =>
    ({ seedIndex: seedOffset + index, evaluationCount: 5, criticalCount: 0 })), 5);
  const cohorts = [10500, 10577, 10654].map((seedOffset, index) => ({
    label: `Holdout ${index + 1}`, seedOffset, sampleSize: 300, beforeCriticalPct: 13.3, afterCriticalPct: 0, improvementPct: 100,
    preventedFailures: 40, introducedFailures: 0, persistentFailures: 0, pairedNetBenefitPct: 40 / 3, pairedPValue: exactMcNemarPValue(40, 0),
    afterWilsonHighPct: criticalRiskInterval(0, 300)!.highPct, clusterUncertainty: cluster(300, seedOffset),
    pairedClusterSampleSize: 60, preventedFailureClusters: 8, introducedFailureClusters: 0, persistentFailureClusters: 0,
    pairedClusterPValue: exactMcNemarPValue(8, 0), targetMet: cluster(300, seedOffset).upperCriticalRiskPct <= targetPct, passed: true,
  }));
  const shocks = ["+20% restoration time", "+10% community demand", "−10% solar capacity", "−10 battery SOC points"].map((label) =>
    ({ label, beforeCritical: 20, afterCritical: 0, preventedFailures: 20, introducedFailures: 0, improvementPct: 100, passed: true }));
  return { result: { ...before, runId: "optimized", counts: { safe: 500, moderate: 0, high: 0, critical: 0 },
      manifest: { ...before.manifest!, runFingerprint: "optimized" } }, intervention: { ...DEFAULT_INTERVENTION },
    analysis: { best: { intervention: { ...DEFAULT_INTERVENTION }, criticalCount: 0, highCount: 0, disruptionScore: 0, riskPct: 0, resilienceScore: 100,
        meanUnservedKWh: 0, meanOperationalCost: 0, meanCarbonKg: 0, clusterUncertainty: cluster(300, 500) },
      evaluatedStrategies: 245, sampleSize: 300, seedOffset: 500, hazardCount: 5, frontier: [], selectionReason: "Test discovery",
      riskTargetPct: targetPct, feasibleStrategyCount: targetPct >= cluster(300, 500).upperCriticalRiskPct ? 1 : 0,
      selectionMode: targetPct >= cluster(300, 500).upperCriticalRiskPct ? "TARGET_FEASIBLE_MINIMAL_DISRUPTION" : "TARGET_UNRESOLVED_RISK_FIRST", discoveryOnly: true },
    validation: { riskTargetPct: targetPct, cohortCount: 3, passedCohorts: 3, recommendationStable: true, cohorts, benchmarks: [], worstCaseImprovementPct: 100,
      assumptionShocks: shocks.map((shock) => shock.label), shockResults: shocks, zeroRegressionCohorts: 3, statisticallyResolvedCohorts: 3,
      jointStressEnvelope: { dimensions: ["Restoration time", "Community demand", "Solar capacity", "Starting battery SOC"], evaluatedCells: 81, sampleSizePerCell: 60, passingCells: 81,
        zeroRegressionCells: 81, minimumImprovementPct: 100, worstCell: { label: "Stress", beforeCritical: 10, afterCritical: 0,
          preventedFailures: 10, introducedFailures: 0, residualCriticalPct: 0, improvementPct: 100, passed: true } },
      decisionStability: { candidateCount: 4, cohortCount: 3, firstPlaceCohorts: 3, topThreeCohorts: 3, meanRank: 1, maxRiskRegretPct: 0,
        stable: cohorts.every((cohort) => cohort.targetMet), cohorts: cohorts.map((cohort) => ({ label: cohort.label, seedOffset: cohort.seedOffset,
          candidateCount: 4, recommendedRank: 1, winnerLabel: "Selected", recommendedRiskPct: 0, bestRiskPct: 0, riskRegretPct: 0,
          targetMet: cohort.targetMet, selectionMode: cohort.targetMet ? "TARGET_FEASIBLE_MINIMAL_DISRUPTION" : "TARGET_UNRESOLVED_RISK_FIRST" })) } } };
}
