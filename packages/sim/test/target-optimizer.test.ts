import { describe, expect, it } from "vitest";
import {
  analyzeInterventions, DEFAULT_CONFIG, DEFAULT_INTERVENTION, exactMcNemarPValue, LOCATIONS,
  rankCandidates, seedClusterRiskUpperBound, summarizeSeedClusters, validateClusterUncertainty,
  validateIntervention, wilsonInterval, analyzeSensitivity, usesMeasuredReliability,
} from "../src/index.js";
import type { StrategyCandidate } from "../src/index.js";
import type { SiteDataProfile } from "@verdant/protocol";

const hazards = ["normal", "heatwave", "storm", "evsurge", "extreme"] as const;
const clusters = (count: number, failed: number, hazardCount = 5, offset = 100) => Array.from({ length: count }, (_, index) => ({
  seedIndex: offset + index, evaluationCount: hazardCount, criticalCount: index < failed ? 1 : 0,
}));
const candidate = (failures: number, disruption: number): StrategyCandidate => ({
  intervention: { ...DEFAULT_INTERVENTION, reservePct: disruption * 5 }, criticalCount: failures, highCount: 0,
  disruptionScore: disruption, riskPct: failures, resilienceScore: 100 - failures,
  meanUnservedKWh: failures * 10, meanOperationalCost: 100 + disruption, meanCarbonKg: 100,
  clusterUncertainty: summarizeSeedClusters(clusters(100, failures, 1), 1),
});

describe("shared-seed conservative uncertainty", () => {
  it("matches the exact zero-failure expression and a nonzero reference solution", () => {
    expect(seedClusterRiskUpperBound(0, 60)).toBeCloseTo((1 - 0.05 ** (1 / 60)) * 100, 10);
    // Solves P(Binomial(10, p) <= 1) = .05, not an asymptotic Wilson bound.
    expect(seedClusterRiskUpperBound(1, 10)).toBeCloseTo(39.416330243695, 9);
    expect(seedClusterRiskUpperBound(10, 10)).toBe(100);
    expect(seedClusterRiskUpperBound(1, 60)).toBeGreaterThan(seedClusterRiskUpperBound(0, 60));
    expect(seedClusterRiskUpperBound(0, 0)).toBe(100);
    expect(seedClusterRiskUpperBound(-1, 60)).toBe(100);
  });

  it("does not mistake 300 hazard evaluations for 300 independent futures", () => {
    const bound = summarizeSeedClusters(clusters(60, 0), 5);
    expect(bound.evaluationCount).toBe(300);
    expect(bound.clusterCount).toBe(60);
    expect(bound.upperCriticalRiskPct).toBeGreaterThan(wilsonInterval(0, 300).highPct * 3);
    expect(bound.upperCriticalRiskPct).toBeCloseTo(4.8702913083, 7);
    expect(summarizeSeedClusters(clusters(40, 0), 5).upperCriticalRiskPct).toBeGreaterThan(5);
  });

  it("groups failures within one seed instead of inflating its sample size", () => {
    const oneHazardFails = summarizeSeedClusters(clusters(60, 1), 5);
    const allHazardsFail = summarizeSeedClusters(clusters(60, 1).map((cluster) => ({ ...cluster, criticalCount: cluster.criticalCount ? 5 : 0 })), 5);
    expect(allHazardsFail.criticalEvaluationCount).toBe(5);
    expect(allHazardsFail.criticalClusterCount).toBe(1);
    expect(allHazardsFail.upperCriticalRiskPct).toBe(oneHazardFails.upperCriticalRiskPct);
  });

  it("checks integer cluster ledger, seed indices and recomputed unrounded bounds", () => {
    const evidence = summarizeSeedClusters(clusters(60, 1), 5);
    const expected = { evaluationCount: 300, hazardCount: 5, seedOffset: 100, criticalEvaluationCount: 1 };
    expect(validateClusterUncertainty(evidence, expected)).toBe(true);
    expect(validateClusterUncertainty({ ...evidence, upperCriticalRiskPct: 0 }, expected)).toBe(false);
    expect(validateClusterUncertainty({ ...evidence, clusterCount: 300 }, expected)).toBe(false);
    expect(validateClusterUncertainty({ ...evidence, clusters: evidence.clusters.map((cluster, index) => ({ ...cluster, seedIndex: index })) }, expected)).toBe(false);
    expect(validateClusterUncertainty(undefined, expected)).toBe(false);
  });

  it("treats unobserved hazards in a partial last cluster pessimistically", () => {
    const evidence = summarizeSeedClusters([...clusters(59, 0), { seedIndex: 159, evaluationCount: 3, criticalCount: 0 }], 5);
    expect(evidence.criticalEvaluationCount).toBe(0);
    expect(evidence.incompleteClusterCount).toBe(1);
    expect(evidence.criticalClusterCount).toBe(1);
    expect(validateClusterUncertainty(evidence, { evaluationCount: 298, hazardCount: 5, seedOffset: 100, criticalEvaluationCount: 0 })).toBe(true);
  });

  it("keeps paired exact testing stable beyond floating-point binomial underflow", () => {
    expect(exactMcNemarPValue(6, 0)).toBeCloseTo(0.03125, 12);
    expect(exactMcNemarPValue(5, 0)).toBeCloseTo(0.0625, 12);
    expect(exactMcNemarPValue(1000, 1000)).toBe(1);
    expect(exactMcNemarPValue(-1, 1)).toBe(1);
  });
});

describe("target-aware exhaustive optimization", () => {
  it("changes the winner when a less disruptive strategy becomes target-feasible", () => {
    const safer = candidate(1, 3); // exact upper ~4.66%
    const smaller = candidate(2, 0); // exact upper ~6.16%
    expect(rankCandidates([smaller, safer], 5)[0]).toBe(safer);
    expect(rankCandidates([smaller, safer], 10)[0]).toBe(smaller);
  });

  it("uses cost then carbon after disruption, not residual risk minimization", () => {
    const safer = candidate(1, 0);
    const cheaper = { ...candidate(2, 0), meanOperationalCost: 50 };
    expect(rankCandidates([safer, cheaper], 10)[0]).toBe(cheaper);
    expect(rankCandidates([safer, cheaper], 1)[0]).toBe(safer);
  });

  it("retains all 245 strategies and labels an unreachable target as risk-first fallback", () => {
    const result = analyzeInterventions(LOCATIONS.jaipur, "extreme", DEFAULT_CONFIG, 25, 800, [...hazards], 1);
    expect(result.evaluatedStrategies).toBe(245);
    expect(result.riskTargetPct).toBe(1);
    expect(result.feasibleStrategyCount).toBe(0);
    expect(result.selectionMode).toBe("TARGET_UNRESOLVED_RISK_FIRST");
    expect(result.selectionReason).toContain("unresolved");
    expect(result.discoveryOnly).toBe(true);
    expect(result.best.clusterUncertainty.clusterCount).toBe(5);
    expect(validateClusterUncertainty(result.best.clusterUncertainty, {
      evaluationCount: 25, hazardCount: 5, seedOffset: 800, criticalEvaluationCount: result.best.criticalCount,
    })).toBe(true);
  }, 15000);

  it("passes the target into the actual complete search rather than only a display assessment", () => {
    const strict = analyzeInterventions(LOCATIONS.jaipur, "extreme", DEFAULT_CONFIG, 100, 800, ["extreme"], 1);
    const relaxed = analyzeInterventions(LOCATIONS.jaipur, "extreme", DEFAULT_CONFIG, 100, 800, ["extreme"], 100);
    expect(relaxed.best.intervention).toEqual(DEFAULT_INTERVENTION);
    expect(strict.best.disruptionScore).toBeGreaterThan(relaxed.best.disruptionScore);
    expect(strict.best.intervention).not.toEqual(relaxed.best.intervention);
    expect(strict.best.criticalCount).toBeLessThanOrEqual(relaxed.best.criticalCount);
    expect(strict.evaluatedStrategies).toBe(relaxed.evaluatedStrategies);
  }, 60000);

  it("fully target-feasible search selects the no-disruption policy", () => {
    const config = { ...DEFAULT_CONFIG, solarCapacityKW: 10000, batteryCapacityKWh: 100000, gridMaxImportKW: 10000,
      batteryMaxChargeKW: 10000, batteryMaxDischargeKW: 10000 };
    const result = analyzeInterventions(LOCATIONS.jaipur, "extreme", config, 20, 800, [...hazards], 100);
    expect(result.feasibleStrategyCount).toBe(245);
    expect(result.best.intervention).toEqual(DEFAULT_INTERVENTION);
    expect(result.selectionMode).toBe("TARGET_FEASIBLE_MINIMAL_DISRUPTION");
  }, 15000);

  it("preserves disjoint holdout seed clusters and cluster-paired statistical tests", () => {
    const validation = validateIntervention(LOCATIONS.jaipur, DEFAULT_CONFIG, { ...DEFAULT_INTERVENTION, reservePct: 30 }, 2000, 20, [...hazards], [], 5);
    const seen = new Set<number>();
    for (const cohort of validation.cohorts) {
      expect(cohort.pairedClusterSampleSize).toBe(4);
      expect(cohort.pairedClusterPValue).toBe(exactMcNemarPValue(cohort.preventedFailureClusters, cohort.introducedFailureClusters));
      expect(cohort.targetMet).toBe(false); // four seeds cannot resolve 5%, even with zero failures
      for (const cluster of cohort.clusterUncertainty.clusters) {
        expect(seen.has(cluster.seedIndex)).toBe(false);
        seen.add(cluster.seedIndex);
        expect(cluster.seedIndex).toBeGreaterThan(803); // disjoint from discovery above
      }
      expect(validateClusterUncertainty(cohort.clusterUncertainty, { evaluationCount: cohort.sampleSize, hazardCount: 5,
        seedOffset: cohort.seedOffset, criticalEvaluationCount: cohort.introducedFailures + cohort.persistentFailures })).toBe(true);
    }
    expect(validation.riskTargetPct).toBe(5);
    expect(validation.statisticallyResolvedCohorts).toBe(validation.cohorts.filter((cohort) => cohort.pairedClusterPValue < .05).length);
  }, 30000);
});

describe("unresolved calibration and zero sensitivity", () => {
  it("does not apply sparse commissioned frequency or restoration estimates", () => {
    expect(usesMeasuredReliability({ scope: "COMMISSIONED_SITE", evidence: { reliability: "INSUFFICIENT_HISTORY" } } as SiteDataProfile)).toBe(false);
    expect(usesMeasuredReliability({ scope: "COMMISSIONED_SITE" } as SiteDataProfile)).toBe(false);
    expect(usesMeasuredReliability({ scope: "PUBLIC_REFERENCE" } as SiteDataProfile)).toBe(true);
    expect(usesMeasuredReliability({ scope: "COMMISSIONED_SITE", evidence: { reliability: "VERIFIED" } } as SiteDataProfile)).toBe(false);
    expect(usesMeasuredReliability({ scope: "COMMISSIONED_SITE", evidence: { reliability: "VERIFIED" },
      reliability: { observationWindow: { durationDays: 365.25 }, eventCount: 30, frequencyInterval95: {} },
      validation: { status: "PASS", outage: { trainEvents: 24, holdoutEvents: 6, ksStatistic: 0.1 } },
    } as SiteDataProfile)).toBe(true);
  });

  it("does not manufacture equal driver contributions when no tested perturbation increases risk", () => {
    const generous = { ...DEFAULT_CONFIG, solarCapacityKW: 10000, batteryCapacityKWh: 100000, gridMaxImportKW: 10000,
      batteryMaxChargeKW: 10000, batteryMaxDischargeKW: 10000 };
    const result = analyzeSensitivity(LOCATIONS.jaipur, "normal", generous, 20);
    expect(result.factors.every((factor) => factor.deltaCriticalPct === 0 && factor.contributionPct === 0)).toBe(true);
    expect(result.interaction).toBeUndefined();
    expect(result.method).toContain("no dominant risk driver");
  });
});
