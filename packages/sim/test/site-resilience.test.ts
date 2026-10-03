import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, LOCATIONS, seedFor, simulateScenario } from "../src/index.js";
import { optimizeInfrastructure } from "../src/investmentOptimizer.js";
import { analyzeValueOfInformation } from "../src/uncertainty.js";

describe("Grounded 3.0 site resilience engine", () => {
  it("sheds clinical service from Tier 3 upward and reports critical tiers separately", () => {
    const config = { ...DEFAULT_CONFIG, solarCapacityKW: 0, batteryCapacityKWh: 0, batteryStartPct: 0,
      batteryMaxChargeKW: 0, batteryMaxDischargeKW: 0, gridMaxImportKW: 0,
      hospitalKW: 100, homesCount: 0, evCount: 0, evChargerKW: 0 };
    const result = simulateScenario(seedFor(2), LOCATIONS.jaipur, "extreme", config, DEFAULT_INTERVENTION, false);
    expect(result.clinicalService).toBeDefined();
    const service = result.clinicalService!;
    expect(service.tier0UnservedKWh).toBeGreaterThan(0);
    expect(service.tier3UnservedKWh).toBeGreaterThan(0);
    expect(result.criticalEnergyUnservedKWh).toBeCloseTo(service.tier0UnservedKWh + service.tier1UnservedKWh, 8);
    expect(result.shedEnergyKWh).toBeCloseTo(service.tier2UnservedKWh + service.tier3UnservedKWh, 8);
  });

  it("models generator start, fuel use and avoided life-safety loss on the same outage seed", () => {
    const base = { ...DEFAULT_CONFIG, solarCapacityKW: 0, batteryCapacityKWh: 0, batteryStartPct: 0,
      batteryMaxChargeKW: 0, batteryMaxDischargeKW: 0, gridMaxImportKW: 0,
      hospitalKW: 100, homesCount: 0, evCount: 0, evChargerKW: 0 };
    let seed = seedFor(0);
    for (let index = 0; index < 200; index++) {
      const candidate = seedFor(index);
      if (simulateScenario(candidate, LOCATIONS.jaipur, "extreme", base, DEFAULT_INTERVENTION, false).outageDurationHours > 0) { seed = candidate; break; }
    }
    const without = simulateScenario(seed, LOCATIONS.jaipur, "extreme", base, DEFAULT_INTERVENTION, false);
    const withGenerator = simulateScenario(seed, LOCATIONS.jaipur, "extreme", { ...base,
      generatorCapacityKW: 150, generatorFuelCapacityKWh: 10_800,
      generatorStartDelayMinutes: 0, generatorStartFailurePct: 0, generatorForcedOutagePctPerHour: 0,
    }, DEFAULT_INTERVENTION, false);
    expect(withGenerator.generatorStarts).toBe(1);
    expect(withGenerator.generatorEnergyKWh).toBeGreaterThan(0);
    expect(withGenerator.generatorFuelRemainingKWh).toBeLessThan(10_800);
    expect(withGenerator.criticalEnergyUnservedKWh).toBeLessThan(without.criticalEnergyUnservedKWh);
    expect(withGenerator.energyBalanceMaxErrorKWh).toBeLessThan(1e-8);
  });

  it("searches physical investments and returns a multi-objective frontier", () => {
    const result = optimizeInfrastructure(LOCATIONS.jaipur, "extreme", DEFAULT_CONFIG, {
      sampleSizePerHazard: 20, hazards: ["extreme"], targetCriticalRiskPct: 10,
      solarOptionsKW: [0], batteryOptionsKWh: [0], generatorOptionsKW: [0, 400], demandControlOptionsPct: [0],
    });
    expect(result.model).toBe("GROUNDED_INFRASTRUCTURE_PARETO_V1");
    expect(result.evaluatedCandidates).toBe(2);
    expect(result.frontier.length).toBeGreaterThan(0);
    expect(result.frontier.every((candidate) => candidate.capex >= 0)).toBe(true);
    expect(result.recommendation).toBeDefined();
    expect(result.uncertainty.topPriority.recommendedMeasurement.length).toBeGreaterThan(10);
  });

  it("separates aleatoric futures from epistemic measurement priorities", () => {
    const result = analyzeValueOfInformation(LOCATIONS.jaipur, "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION, {
      sampleSizePerHazard: 20, hazards: ["extreme"],
    });
    expect(result.aleatoric.method).toBe("SEEDED_MONTE_CARLO");
    expect(result.aleatoric.sources).toContain("outage occurrence and restoration");
    expect(result.epistemic).toHaveLength(6);
    expect(result.epistemic[0].decisionValueScore).toBeGreaterThanOrEqual(result.epistemic[1].decisionValueScore);
    expect(result.disclosure).toContain("not monetized EVPI");
  });
});
