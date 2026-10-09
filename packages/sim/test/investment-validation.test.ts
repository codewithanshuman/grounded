import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, LOCATIONS, seedClusterRiskUpperBound } from "../src/index.js";
import { DEFAULT_INVESTMENT_COSTS, investmentCapex, optimizeInfrastructure, resolveInvestmentPlan } from "../src/investmentOptimizer.js";

const smallSearch = { sampleSizePerHazard: 20, hazards: ["normal", "extreme"] as const,
  solarOptionsKW: [0], batteryOptionsKWh: [0], generatorOptionsKW: [0], demandControlOptionsPct: [0] };
const noLoad = { ...DEFAULT_CONFIG, homesCount: 0, hospitalKW: 0, evCount: 0 };

describe("Independent physical investment evidence", () => {
  it("counts independent shared-seed clusters and never treats zero failures as zero risk", () => {
    const report = optimizeInfrastructure(LOCATIONS.jaipur, "normal", noLoad,
      { ...smallSearch, hazards: [...smallSearch.hazards], targetCriticalRiskPct: 5 });
    expect(report.recommendation.worstCriticalRiskPct).toBe(0);
    expect(report.recommendation.clusterUncertainty.clusterCount).toBe(20);
    expect(report.recommendation.clusterUncertainty.evaluationCount).toBe(40);
    expect(report.recommendation.clusterUncertainty.upperCriticalRiskPct).toBeCloseTo(13.91, 2);
    expect(report.recommendation.feasible).toBe(false); // 20 discovery seeds cannot establish 5%.
    expect(report.status).toBe("SUPPORTED"); // Independent predeclared 100-seed holdouts can.
    for (const cohort of report.validation.cohorts) {
      expect(cohort.recommendation.id).toBe(report.recommendation.id);
      expect(cohort.recommendation.clusterUncertainty.upperCriticalRiskPct).toBeCloseTo(seedClusterRiskUpperBound(0, 100), 9);
      expect(cohort.introducedFailureClusters).toBe(0);
      expect(cohort.preventedFailureClusters).toBe(0);
      expect(cohort.pairedClusterPValue).toBe(1); // Support is not a claim of improvement.
    }
    const indices = [...report.recommendation.clusterUncertainty.clusters,
      ...report.validation.cohorts.flatMap((cohort) => cohort.recommendation.clusterUncertainty.clusters)].map((cluster) => cluster.seedIndex);
    expect(new Set(indices).size).toBe(indices.length);
  });

  it("leaves a stringent target unresolved when the predetermined sample cap is insufficient", () => {
    const report = optimizeInfrastructure(LOCATIONS.jaipur, "normal", noLoad,
      { ...smallSearch, hazards: ["normal"], targetCriticalRiskPct: .1 });
    expect(report.validation.capped).toBe(true);
    expect(report.validation.sampleSizePerHazard).toBe(2_000);
    expect(report.status).toBe("UNRESOLVED");
    expect(report.validation.cohorts.every((cohort) => cohort.recommendation.worstCriticalRiskPct === 0 && !cohort.targetMet)).toBe(true);
  }, 30_000);

  it("charges only incremental controls and marks an entirely unaffordable search", () => {
    const base = { ...noLoad, homesCount: 100, avgHomeKW: 1, demandControlPct: 10 };
    expect(investmentCapex(base, { solarAddKW: 0, batteryAddKWh: 0, generatorAddKW: 0, demandControlPct: 10 })).toBe(0);
    expect(investmentCapex(base, { solarAddKW: 0, batteryAddKWh: 0, generatorAddKW: 0, demandControlPct: 20 })).toBe(450);
    const report = optimizeInfrastructure(LOCATIONS.jaipur, "normal", noLoad,
      { ...smallSearch, hazards: ["normal"], solarOptionsKW: [100], budgetCapex: 0 });
    expect(report.status).toBe("BUDGET_INFEASIBLE");
    expect(report.recommendation.withinBudget).toBe(false);
  });

  it("rejects invalid or unbounded plans before simulation", () => {
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { hazards: ["normal", "normal"] })).toThrow(/unique hazard/);
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { seedOffset: 1_000_000 })).toThrow(/disjoint/);
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { validationSeedOffsets: [80_000, 80_000] })).toThrow(/disjoint/);
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { costs: { ...DEFAULT_INVESTMENT_COSTS, solarPerKW: -1 } })).toThrow(/costs/);
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { solarOptionsKW: Array.from({ length: 30 }, (_, i) => i) })).toThrow(/candidate limit/);
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { sampleSizePerHazard: 2_000 })).toThrow(/work limit/);
    expect(() => resolveInvestmentPlan(DEFAULT_CONFIG, { validationSampleSizePerHazard: 20 })).toThrow(/target-derived/);
  });
});
