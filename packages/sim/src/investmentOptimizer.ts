import type { Intervention, MicrogridConfig, PresetId } from "@verdant/protocol";
import { DEFAULT_INTERVENTION, PRESET_ORDER, runMonteCarlo, type LocationDef } from "./index.js";
import { analyzeValueOfInformation, type ValueOfInformationAnalysis } from "./uncertainty.js";

export interface InfrastructureInvestment {
  solarAddKW: number;
  batteryAddKWh: number;
  generatorAddKW: number;
  demandControlPct: number;
}

export interface InvestmentCostAssumptions {
  currency: "USD_2026_REFERENCE";
  solarPerKW: number;
  batteryPerKWh: number;
  generatorPerKW: number;
  demandControlPerKW: number;
  generatorFuelHours: number;
}

export const DEFAULT_INVESTMENT_COSTS: InvestmentCostAssumptions = {
  currency: "USD_2026_REFERENCE",
  solarPerKW: 850,
  batteryPerKWh: 320,
  generatorPerKW: 550,
  demandControlPerKW: 45,
  generatorFuelHours: 24,
};

export interface InvestmentCandidate {
  investment: InfrastructureInvestment;
  capex: number;
  worstCriticalRiskPct: number;
  meanCvar95UnservedKWh: number;
  meanOperationalCost: number;
  meanCarbonKg: number;
  meanGeneratorEnergyKWh: number;
  feasible: boolean;
  resilienceScore: number;
}

export interface InvestmentOptimization {
  model: "GROUNDED_INFRASTRUCTURE_PARETO_V1";
  targetCriticalRiskPct: number;
  sampleSizePerHazard: number;
  hazards: PresetId[];
  evaluatedCandidates: number;
  assumptions: InvestmentCostAssumptions;
  recommendation: InvestmentCandidate;
  frontier: InvestmentCandidate[];
  uncertainty: ValueOfInformationAnalysis;
  disclosure: string;
}

export interface InvestmentSearchOptions {
  sampleSizePerHazard?: number;
  seedOffset?: number;
  hazards?: PresetId[];
  targetCriticalRiskPct?: number;
  solarOptionsKW?: number[];
  batteryOptionsKWh?: number[];
  generatorOptionsKW?: number[];
  demandControlOptionsPct?: number[];
  costs?: InvestmentCostAssumptions;
  intervention?: Intervention;
}

function finiteNonnegative(values: number[], label: string): number[] {
  const unique = [...new Set(values)];
  if (!unique.length || unique.some((value) => !Number.isFinite(value) || value < 0)) throw new Error(`${label} options must be finite and nonnegative.`);
  return unique.sort((a, b) => a - b);
}

export function applyInfrastructureInvestment(base: MicrogridConfig, investment: InfrastructureInvestment,
  costs: InvestmentCostAssumptions = DEFAULT_INVESTMENT_COSTS): MicrogridConfig {
  const generatorCapacityKW = base.generatorCapacityKW + investment.generatorAddKW;
  return {
    ...base,
    solarCapacityKW: base.solarCapacityKW + investment.solarAddKW,
    batteryCapacityKWh: base.batteryCapacityKWh + investment.batteryAddKWh,
    batteryMaxChargeKW: base.batteryMaxChargeKW + investment.batteryAddKWh / 4,
    batteryMaxDischargeKW: base.batteryMaxDischargeKW + investment.batteryAddKWh / 4,
    generatorCapacityKW,
    generatorFuelCapacityKWh: Math.max(base.generatorFuelCapacityKWh, generatorCapacityKW * costs.generatorFuelHours),
    demandControlPct: Math.max(base.demandControlPct, investment.demandControlPct),
  };
}

export function investmentCapex(base: MicrogridConfig, investment: InfrastructureInvestment,
  costs: InvestmentCostAssumptions = DEFAULT_INVESTMENT_COSTS): number {
  const controllableKW = base.homesCount * base.avgHomeKW + base.evCount * base.evChargerKW;
  return Math.round(investment.solarAddKW * costs.solarPerKW
    + investment.batteryAddKWh * costs.batteryPerKWh
    + investment.generatorAddKW * costs.generatorPerKW
    + controllableKW * (investment.demandControlPct / 100) * costs.demandControlPerKW);
}

function dominates(left: InvestmentCandidate, right: InvestmentCandidate): boolean {
  const noWorse = left.capex <= right.capex
    && left.worstCriticalRiskPct <= right.worstCriticalRiskPct
    && left.meanCvar95UnservedKWh <= right.meanCvar95UnservedKWh
    && left.meanOperationalCost <= right.meanOperationalCost
    && left.meanCarbonKg <= right.meanCarbonKg;
  const better = left.capex < right.capex
    || left.worstCriticalRiskPct < right.worstCriticalRiskPct
    || left.meanCvar95UnservedKWh < right.meanCvar95UnservedKWh
    || left.meanOperationalCost < right.meanOperationalCost
    || left.meanCarbonKg < right.meanCarbonKg;
  return noWorse && better;
}

export function optimizeInfrastructure(location: LocationDef, preset: PresetId, base: MicrogridConfig,
  options: InvestmentSearchOptions = {}): InvestmentOptimization {
  const sampleSizePerHazard = options.sampleSizePerHazard ?? 100;
  const seedOffset = options.seedOffset ?? 80_000;
  const hazards = options.hazards ?? [...PRESET_ORDER];
  const targetCriticalRiskPct = options.targetCriticalRiskPct ?? 5;
  const costs = options.costs ?? DEFAULT_INVESTMENT_COSTS;
  const intervention = options.intervention ?? DEFAULT_INTERVENTION;
  if (!Number.isInteger(sampleSizePerHazard) || sampleSizePerHazard < 20 || sampleSizePerHazard > 2_000) throw new Error("Investment sample size must be an integer from 20 to 2,000 per hazard.");
  if (!hazards.length || !Number.isFinite(targetCriticalRiskPct) || targetCriticalRiskPct <= 0 || targetCriticalRiskPct > 100) throw new Error("Invalid investment search target or hazard set.");
  const solar = finiteNonnegative(options.solarOptionsKW ?? [0, 600, 1_200], "Solar");
  const battery = finiteNonnegative(options.batteryOptionsKWh ?? [0, 3_000, 6_000], "Battery");
  const generator = finiteNonnegative(options.generatorOptionsKW ?? [0, 400, 800], "Generator");
  const controls = finiteNonnegative(options.demandControlOptionsPct ?? [0, 10, 20], "Demand control");
  if (controls.some((value) => value > 50)) throw new Error("Demand control options cannot exceed 50%.");
  const candidates: InvestmentCandidate[] = [];
  for (const solarAddKW of solar) for (const batteryAddKWh of battery) for (const generatorAddKW of generator) for (const demandControlPct of controls) {
    const investment = { solarAddKW, batteryAddKWh, generatorAddKW, demandControlPct };
    const config = applyInfrastructureInvestment(base, investment, costs);
    const results = hazards.map((hazard, index) => runMonteCarlo(sampleSizePerHazard, location, hazard, config,
      intervention, seedOffset + index * sampleSizePerHazard));
    const worstCriticalRiskPct = Math.max(...results.map((result) => result.metrics.criticalRiskPct));
    const mean = (selector: (result: typeof results[number]) => number) => results.reduce((sum, result) => sum + selector(result), 0) / results.length;
    const capex = investmentCapex(base, investment, costs);
    const meanCvar95UnservedKWh = mean((result) => result.metrics.cvar95TotalUnservedKWh);
    const meanOperationalCost = mean((result) => result.metrics.meanOperationalCost);
    const meanCarbonKg = mean((result) => result.metrics.meanCarbonKg);
    const meanGeneratorEnergyKWh = mean((result) => result.metrics.meanGeneratorEnergyKWh);
    const feasible = worstCriticalRiskPct <= targetCriticalRiskPct;
    const resilienceScore = Math.max(0, 100 - worstCriticalRiskPct * 2 - Math.log10(1 + meanCvar95UnservedKWh) * 4
      - Math.log10(1 + capex) * .8 - meanCarbonKg / 10_000);
    candidates.push({ investment, capex, worstCriticalRiskPct, meanCvar95UnservedKWh, meanOperationalCost,
      meanCarbonKg, meanGeneratorEnergyKWh, feasible, resilienceScore });
  }
  const frontier = candidates.filter((candidate) => !candidates.some((other) => other !== candidate && dominates(other, candidate)))
    .sort((a, b) => a.capex - b.capex || a.worstCriticalRiskPct - b.worstCriticalRiskPct || b.resilienceScore - a.resilienceScore);
  const feasible = frontier.filter((candidate) => candidate.feasible);
  const recommendation = [...(feasible.length ? feasible : frontier)].sort((a, b) => feasible.length
    ? a.capex - b.capex || a.meanCarbonKg - b.meanCarbonKg || a.worstCriticalRiskPct - b.worstCriticalRiskPct
    : a.worstCriticalRiskPct - b.worstCriticalRiskPct || a.meanCvar95UnservedKWh - b.meanCvar95UnservedKWh || a.capex - b.capex)[0];
  if (!recommendation) throw new Error("Investment search produced no candidate.");
  const recommendedConfig = applyInfrastructureInvestment(base, recommendation.investment, costs);
  const uncertainty = analyzeValueOfInformation(location, preset, recommendedConfig, intervention, {
    sampleSizePerHazard: Math.max(20, Math.min(40, sampleSizePerHazard)), seedOffset: seedOffset + 500_000, hazards,
  });
  return {
    model: "GROUNDED_INFRASTRUCTURE_PARETO_V1", targetCriticalRiskPct, sampleSizePerHazard,
    hazards, evaluatedCandidates: candidates.length, assumptions: costs, recommendation, frontier, uncertainty,
    disclosure: "Candidate infrastructure is compared on identical seeded futures. CAPEX values are transparent reference assumptions, not vendor quotes. Pareto membership is model-conditional and requires site engineering review.",
  };
}
