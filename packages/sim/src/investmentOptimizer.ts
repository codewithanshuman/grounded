import { Intervention as InterventionSchema, MicrogridConfig as ConfigSchema, type Intervention, type MicrogridConfig, type PresetId } from "@verdant/protocol";
import { DEFAULT_INTERVENTION, PRESET_ORDER, exactMcNemarPValue, seedFor, simulateScenario,
  summarizeSeedClusters, type ClusterUncertainty, type LocationDef, type SeedClusterObservation } from "./index.js";
import { analyzeValueOfInformation, type ValueOfInformationAnalysis } from "./uncertainty.js";

export interface InfrastructureInvestment {
  solarAddKW: number;
  batteryAddKWh: number;
  generatorAddKW: number;
  /** Total installed control percentage, not an addition to existing controls. */
  demandControlPct: number;
}

export interface InvestmentCostAssumptions {
  currency: "USD_2026_REFERENCE";
  solarPerKW: number;
  batteryPerKWh: number;
  generatorPerKW: number;
  demandControlPerKW: number;
  /** Usable electric-output fuel hours provided for NEW generator capacity only. */
  generatorFuelHours: number;
}

export const DEFAULT_INVESTMENT_COSTS: InvestmentCostAssumptions = {
  currency: "USD_2026_REFERENCE", solarPerKW: 850, batteryPerKWh: 320,
  generatorPerKW: 550, demandControlPerKW: 45, generatorFuelHours: 24,
};

export interface InvestmentCandidate {
  id: string;
  investment: InfrastructureInvestment;
  capex: number;
  worstCriticalRiskPct: number;
  meanCvar95UnservedKWh: number;
  meanOperationalCost: number;
  meanCarbonKg: number;
  meanGeneratorEnergyKWh: number;
  /** Discovery-only eligibility. Independent validation controls report status. */
  feasible: boolean;
  withinBudget: boolean;
  clusterUncertainty: ClusterUncertainty;
  resilienceScore: number;
}

export interface InvestmentValidationCohort {
  label: string;
  seedOffset: number;
  sampleSizePerHazard: number;
  baseline: InvestmentCandidate;
  recommendation: InvestmentCandidate;
  preventedFailureClusters: number;
  introducedFailureClusters: number;
  persistentFailureClusters: number;
  pairedClusterPValue: number;
  targetMet: boolean;
  /** No seed that survived without the physical investment fails with it. */
  nonRegression: boolean;
}

export interface InvestmentReplayPlan {
  sampleSizePerHazard: number;
  seedOffset: number;
  hazards: PresetId[];
  targetCriticalRiskPct: number;
  budgetCapex: number | null;
  solarOptionsKW: number[];
  batteryOptionsKWh: number[];
  generatorOptionsKW: number[];
  demandControlOptionsPct: number[];
  costs: InvestmentCostAssumptions;
  intervention: Intervention;
  validationSampleSizePerHazard: number;
  validationSeedOffsets: [number, number];
  uncertaintySeedOffset: number;
}

export interface InvestmentOptimization {
  model: "GROUNDED_INFRASTRUCTURE_PARETO_V2";
  status: "SUPPORTED" | "UNRESOLVED" | "BUDGET_INFEASIBLE";
  targetCriticalRiskPct: number;
  budgetCapex: number | null;
  sampleSizePerHazard: number;
  hazards: PresetId[];
  evaluatedCandidates: number;
  assumptions: InvestmentCostAssumptions;
  baseline: InvestmentCandidate;
  recommendation: InvestmentCandidate;
  candidates: InvestmentCandidate[];
  frontier: InvestmentCandidate[];
  selectionReason: string;
  validation: {
    method: "FROZEN_CANDIDATE_TWO_HOLDOUTS_V1";
    confidenceLevel: 0.95;
    sampleSizePerHazard: number;
    requiredZeroFailureSeeds: number;
    capped: boolean;
    passedCohorts: number;
    cohorts: InvestmentValidationCohort[];
  };
  replayPlan: InvestmentReplayPlan;
  uncertainty: ValueOfInformationAnalysis;
  disclosure: string;
}

export type InvestmentSearchOptions = Partial<InvestmentReplayPlan>;

export const MAX_INVESTMENT_CANDIDATES = 256;
export const MAX_INVESTMENT_SCENARIO_EVALUATIONS = 300_000;
const MAX_SEED_INDEX = 1_000_000;

function finiteNonnegative(values: number[], label: string): number[] {
  if (!Array.isArray(values) || !values.length || values.length > MAX_INVESTMENT_CANDIDATES
    || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new Error(`${label} options must contain 1–${MAX_INVESTMENT_CANDIDATES} finite nonnegative values.`);
  }
  return [...new Set(values)].sort((a, b) => a - b);
}

function validateCosts(costs: InvestmentCostAssumptions): void {
  if (!costs || costs.currency !== "USD_2026_REFERENCE"
    || [costs.solarPerKW, costs.batteryPerKWh, costs.generatorPerKW, costs.demandControlPerKW, costs.generatorFuelHours]
      .some((value) => !Number.isFinite(value) || value < 0)
    || costs.generatorFuelHours <= 0 || costs.generatorFuelHours > 72) {
    throw new Error("Investment costs must be finite nonnegative reference USD amounts, with positive generator fuel hours up to 72.");
  }
}

function validateInvestment(investment: InfrastructureInvestment): void {
  if (!investment || [investment.solarAddKW, investment.batteryAddKWh, investment.generatorAddKW, investment.demandControlPct]
    .some((value) => !Number.isFinite(value) || value < 0) || investment.demandControlPct > 50) {
    throw new Error("Physical investments must be finite and nonnegative, with demand control no greater than 50%.");
  }
}

function validateConfig(base: MicrogridConfig): MicrogridConfig {
  const config = ConfigSchema.parse(base);
  if (!Object.values(config).every(Number.isFinite) || !Number.isInteger(config.homesCount) || !Number.isInteger(config.evCount)
    || config.clinicalTier0Pct + config.clinicalTier1Pct + config.clinicalTier2Pct > 100
    || (config.batteryCapacityKWh > 0 && config.batteryStartPct < config.batteryMinSocPct)
    || (config.generatorCapacityKW > 0 && config.generatorFuelCapacityKWh <= 0)) {
    throw new Error("Investment baseline requires finite, physically valid configuration values.");
  }
  return config;
}

export function applyInfrastructureInvestment(base: MicrogridConfig, investment: InfrastructureInvestment,
  costs: InvestmentCostAssumptions = DEFAULT_INVESTMENT_COSTS): MicrogridConfig {
  validateInvestment(investment);
  validateCosts(costs);
  // Preserve the baseline fuel exactly. Buying no generator cannot refill an
  // existing tank, and added capacity does not upgrade existing fuel provision.
  const result = {
    ...base,
    solarCapacityKW: base.solarCapacityKW + investment.solarAddKW,
    batteryCapacityKWh: base.batteryCapacityKWh + investment.batteryAddKWh,
    batteryMaxChargeKW: base.batteryMaxChargeKW + investment.batteryAddKWh / 4,
    batteryMaxDischargeKW: base.batteryMaxDischargeKW + investment.batteryAddKWh / 4,
    generatorCapacityKW: base.generatorCapacityKW + investment.generatorAddKW,
    generatorFuelCapacityKWh: base.generatorFuelCapacityKWh + investment.generatorAddKW * costs.generatorFuelHours,
    demandControlPct: Math.max(base.demandControlPct, investment.demandControlPct),
  };
  if (!Object.values(result).every(Number.isFinite)) throw new Error("Investment configuration exceeds finite physical limits.");
  return result;
}

export function investmentCapex(base: MicrogridConfig, investment: InfrastructureInvestment,
  costs: InvestmentCostAssumptions = DEFAULT_INVESTMENT_COSTS): number {
  validateInvestment(investment);
  validateCosts(costs);
  const controllableKW = base.homesCount * base.avgHomeKW + base.evCount * base.evChargerKW;
  const incrementalControlPct = Math.max(0, investment.demandControlPct - base.demandControlPct);
  const capex = investment.solarAddKW * costs.solarPerKW + investment.batteryAddKWh * costs.batteryPerKWh
    + investment.generatorAddKW * costs.generatorPerKW + controllableKW * (incrementalControlPct / 100) * costs.demandControlPerKW;
  if (!Number.isFinite(capex) || capex < 0 || capex > Number.MAX_SAFE_INTEGER) throw new Error("Investment CAPEX exceeds supported finite cost limits.");
  return capex;
}

/** Fractional tail weighting retains exactly 5% empirical probability mass. */
function empiricalCvar95(values: number[]): number {
  const sorted = [...values].sort((a, b) => b - a);
  const mass = sorted.length * .05;
  const whole = Math.floor(mass);
  const fraction = mass - whole;
  return (sorted.slice(0, whole).reduce((sum, value) => sum + value, 0) + (sorted[whole] ?? 0) * fraction) / mass;
}

function candidateId(investment: InfrastructureInvestment): string {
  return `solar:${investment.solarAddKW}|battery:${investment.batteryAddKWh}|generator:${investment.generatorAddKW}|controls:${investment.demandControlPct}`;
}

function evaluate(location: LocationDef, base: MicrogridConfig, investment: InfrastructureInvestment,
  plan: InvestmentReplayPlan, seedOffset: number, sampleSize: number): InvestmentCandidate {
  const config = applyInfrastructureInvestment(base, investment, plan.costs);
  const losses = plan.hazards.map(() => [] as number[]);
  const criticalCounts = plan.hazards.map(() => 0);
  const clusters: SeedClusterObservation[] = [];
  let cost = 0, carbon = 0, generatorEnergy = 0;
  for (let index = 0; index < sampleSize; index++) {
    const cluster = { seedIndex: seedOffset + index, evaluationCount: plan.hazards.length, criticalCount: 0 };
    const seed = seedFor(cluster.seedIndex);
    for (let hazardIndex = 0; hazardIndex < plan.hazards.length; hazardIndex++) {
      const result = simulateScenario(seed, location, plan.hazards[hazardIndex], config, plan.intervention, false);
      const loss = result.shedEnergyKWh + result.criticalEnergyUnservedKWh;
      if (![loss, result.operationalCost, result.carbonKg, result.generatorEnergyKWh ?? 0].every(Number.isFinite)) {
        throw new Error("Investment evaluation produced nonfinite scenario outputs.");
      }
      if (result.failed) { cluster.criticalCount++; criticalCounts[hazardIndex]++; }
      losses[hazardIndex].push(loss);
      cost += result.operationalCost;
      carbon += result.carbonKg;
      generatorEnergy += result.generatorEnergyKWh ?? 0;
    }
    clusters.push(cluster);
  }
  const count = sampleSize * plan.hazards.length;
  const capex = investmentCapex(base, investment, plan.costs);
  const worstCriticalRiskPct = Math.max(...criticalCounts) / sampleSize * 100;
  const clusterUncertainty = summarizeSeedClusters(clusters, plan.hazards.length);
  const meanCvar95UnservedKWh = losses.reduce((sum, loss) => sum + empiricalCvar95(loss), 0) / losses.length;
  const withinBudget = plan.budgetCapex === null || capex <= plan.budgetCapex;
  return {
    id: candidateId(investment), investment: { ...investment }, capex, worstCriticalRiskPct,
    meanCvar95UnservedKWh, meanOperationalCost: cost / count, meanCarbonKg: carbon / count,
    meanGeneratorEnergyKWh: generatorEnergy / count,
    feasible: withinBudget && clusterUncertainty.upperCriticalRiskPct <= plan.targetCriticalRiskPct,
    withinBudget, clusterUncertainty,
    resilienceScore: Math.max(0, 100 - worstCriticalRiskPct * 2 - Math.log10(1 + meanCvar95UnservedKWh) * 4
      - Math.log10(1 + capex) * .8 - carbon / count / 10_000),
  };
}

function dominates(left: InvestmentCandidate, right: InvestmentCandidate): boolean {
  const axes = (value: InvestmentCandidate) => [value.capex, value.clusterUncertainty.upperCriticalRiskPct,
    value.worstCriticalRiskPct, value.meanCvar95UnservedKWh, value.meanOperationalCost, value.meanCarbonKg];
  const leftValues = axes(left), rightValues = axes(right);
  return leftValues.every((value, index) => value <= rightValues[index]) && leftValues.some((value, index) => value < rightValues[index]);
}

function normalizedPlan(base: MicrogridConfig, options: InvestmentSearchOptions): { plan: InvestmentReplayPlan; required: number } {
  const sampleSizePerHazard = options.sampleSizePerHazard ?? 100;
  const seedOffset = options.seedOffset ?? 80_000;
  const hazards = [...(options.hazards ?? PRESET_ORDER)];
  const targetCriticalRiskPct = options.targetCriticalRiskPct ?? 5;
  const budgetCapex = options.budgetCapex ?? null;
  const costs = { ...(options.costs ?? DEFAULT_INVESTMENT_COSTS) };
  validateCosts(costs);
  const intervention = InterventionSchema.parse(options.intervention ?? DEFAULT_INTERVENTION);
  if ([intervention.reservePct, intervention.evDelayMin, intervention.precoolHour ?? 0].some((value) => !Number.isFinite(value))) {
    throw new Error("Investment policy must contain finite values.");
  }
  if (!Number.isInteger(sampleSizePerHazard) || sampleSizePerHazard < 20 || sampleSizePerHazard > 2_000) {
    throw new Error("Investment sample size must be an integer from 20 to 2,000 per hazard.");
  }
  if (!hazards.length || hazards.length > PRESET_ORDER.length || new Set(hazards).size !== hazards.length
    || hazards.some((hazard) => !PRESET_ORDER.includes(hazard))
    || !Number.isFinite(targetCriticalRiskPct) || targetCriticalRiskPct <= 0 || targetCriticalRiskPct > 100
    || (budgetCapex !== null && (!Number.isFinite(budgetCapex) || budgetCapex < 0))) {
    throw new Error("Invalid investment target, budget or unique hazard set.");
  }
  const solarOptionsKW = finiteNonnegative(options.solarOptionsKW ?? [0, 600, 1_200], "Solar");
  const batteryOptionsKWh = finiteNonnegative(options.batteryOptionsKWh ?? [0, 3_000, 6_000], "Battery");
  const generatorOptionsKW = finiteNonnegative(options.generatorOptionsKW ?? [0, 400, 800], "Generator");
  const requestedControls = finiteNonnegative(options.demandControlOptionsPct ?? [0, 10, 20], "Demand control");
  if (requestedControls.some((value) => value > 50)) throw new Error("Demand control options cannot exceed 50%.");
  const demandControlOptionsPct = [...new Set(requestedControls.map((value) => Math.max(value, base.demandControlPct)))];
  const candidates = solarOptionsKW.length * batteryOptionsKWh.length * generatorOptionsKW.length * demandControlOptionsPct.length;
  if (candidates > MAX_INVESTMENT_CANDIDATES) throw new Error(`Investment search exceeds the ${MAX_INVESTMENT_CANDIDATES}-candidate limit.`);
  const rawRequired = targetCriticalRiskPct === 100 ? 1 : Math.ceil(Math.log(.05) / Math.log1p(-targetCriticalRiskPct / 100));
  const required = Number.isFinite(rawRequired) ? Math.min(Number.MAX_SAFE_INTEGER, rawRequired) : Number.MAX_SAFE_INTEGER;
  const validationSampleSizePerHazard = Math.min(2_000, Math.max(100, required));
  if (options.validationSampleSizePerHazard !== undefined && options.validationSampleSizePerHazard !== validationSampleSizePerHazard) {
    throw new Error("Validation sample size must match the target-derived plan fixed before observing outcomes.");
  }
  const validationSeedOffsets: [number, number] = options.validationSeedOffsets
    ? [...options.validationSeedOffsets]
    : [seedOffset + sampleSizePerHazard + 17, seedOffset + sampleSizePerHazard + validationSampleSizePerHazard + 34];
  const uncertaintySeedOffset = options.uncertaintySeedOffset ?? validationSeedOffsets[1] + validationSampleSizePerHazard + 17;
  const uncertaintySamples = Math.min(40, sampleSizePerHazard);
  const ranges = [[seedOffset, sampleSizePerHazard], ...validationSeedOffsets.map((offset) => [offset, validationSampleSizePerHazard]),
    [uncertaintySeedOffset, uncertaintySamples * hazards.length]];
  if (validationSeedOffsets.length !== 2 || ranges.some(([offset, length]) => !Number.isSafeInteger(offset) || offset < 0 || offset + length - 1 > MAX_SEED_INDEX)
    || ranges.some(([start, length], index) => ranges.some(([other, otherLength], otherIndex) => index < otherIndex && start < other + otherLength && other < start + length))) {
    throw new Error(`Investment discovery, holdout and sensitivity seed ranges must be disjoint integers from 0 to ${MAX_SEED_INDEX}.`);
  }
  const evaluations = ((candidates + 1) * sampleSizePerHazard + 4 * validationSampleSizePerHazard + 12 * (uncertaintySamples + 2)) * hazards.length;
  if (evaluations > MAX_INVESTMENT_SCENARIO_EVALUATIONS) throw new Error(`Investment search exceeds the ${MAX_INVESTMENT_SCENARIO_EVALUATIONS.toLocaleString()}-scenario work limit; reduce candidates or discovery samples.`);
  return { required, plan: { sampleSizePerHazard, seedOffset, hazards, targetCriticalRiskPct, budgetCapex,
    solarOptionsKW, batteryOptionsKWh, generatorOptionsKW, demandControlOptionsPct, costs, intervention,
    validationSampleSizePerHazard, validationSeedOffsets, uncertaintySeedOffset } };
}

/** Validate compute limits and disjoint seed ranges without running scenarios. */
export function resolveInvestmentPlan(base: MicrogridConfig, options: InvestmentSearchOptions): InvestmentReplayPlan {
  return normalizedPlan(validateConfig(base), options).plan;
}

export function optimizeInfrastructure(location: LocationDef, preset: PresetId, base: MicrogridConfig,
  options: InvestmentSearchOptions = {}): InvestmentOptimization {
  const baselineConfig = validateConfig(base);
  const { plan, required } = normalizedPlan(baselineConfig, options);
  const { sampleSizePerHazard, seedOffset, hazards, targetCriticalRiskPct, costs } = plan;
  const baselineInvestment = { solarAddKW: 0, batteryAddKWh: 0, generatorAddKW: 0, demandControlPct: baselineConfig.demandControlPct };
  const investments: InfrastructureInvestment[] = [];
  for (const solarAddKW of plan.solarOptionsKW) for (const batteryAddKWh of plan.batteryOptionsKWh)
    for (const generatorAddKW of plan.generatorOptionsKW) for (const demandControlPct of plan.demandControlOptionsPct) {
      const investment = { solarAddKW, batteryAddKWh, generatorAddKW, demandControlPct };
      // Reject invalid capacity/cost arithmetic before any expensive scenarios.
      applyInfrastructureInvestment(baselineConfig, investment, costs);
      investmentCapex(baselineConfig, investment, costs);
      investments.push(investment);
    }
  const baseline = evaluate(location, baselineConfig, baselineInvestment, plan, seedOffset, sampleSizePerHazard);
  const candidates = investments.map((investment) => candidateId(investment) === baseline.id
    ? baseline : evaluate(location, baselineConfig, investment, plan, seedOffset, sampleSizePerHazard));
  const byCost = (a: InvestmentCandidate, b: InvestmentCandidate) => a.capex - b.capex || a.meanCarbonKg - b.meanCarbonKg
    || a.clusterUncertainty.upperCriticalRiskPct - b.clusterUncertainty.upperCriticalRiskPct || a.id.localeCompare(b.id);
  const byRisk = (a: InvestmentCandidate, b: InvestmentCandidate) => a.clusterUncertainty.upperCriticalRiskPct - b.clusterUncertainty.upperCriticalRiskPct
    || a.worstCriticalRiskPct - b.worstCriticalRiskPct || a.meanCvar95UnservedKWh - b.meanCvar95UnservedKWh || byCost(a, b);
  const frontier = candidates.filter((candidate) => !candidates.some((other) => other !== candidate && dominates(other, candidate))).sort(byCost);
  const affordable = frontier.filter((candidate) => candidate.withinBudget);
  const feasible = affordable.filter((candidate) => candidate.feasible);
  const recommendation = [...(feasible.length ? feasible : affordable.length ? affordable : frontier)].sort(feasible.length || !affordable.length ? byCost : byRisk)[0];
  if (!recommendation) throw new Error("Investment search produced no candidate.");
  // Freeze the discovered portfolio before opening either holdout. Validation
  // never changes its identity or searches the held-out scenarios for a winner.
  const cohorts = plan.validationSeedOffsets.map((offset, index): InvestmentValidationCohort => {
    const before = evaluate(location, baselineConfig, baselineInvestment, plan, offset, plan.validationSampleSizePerHazard);
    const after = recommendation.id === baseline.id ? before
      : evaluate(location, baselineConfig, recommendation.investment, plan, offset, plan.validationSampleSizePerHazard);
    let preventedFailureClusters = 0, introducedFailureClusters = 0, persistentFailureClusters = 0;
    before.clusterUncertainty.clusters.forEach((cluster, clusterIndex) => {
      const beforeFailed = cluster.criticalCount > 0;
      const afterFailed = after.clusterUncertainty.clusters[clusterIndex].criticalCount > 0;
      if (beforeFailed && !afterFailed) preventedFailureClusters++;
      else if (!beforeFailed && afterFailed) introducedFailureClusters++;
      else if (beforeFailed && afterFailed) persistentFailureClusters++;
    });
    return { label: `Holdout ${String.fromCharCode(65 + index)}`, seedOffset: offset,
      sampleSizePerHazard: plan.validationSampleSizePerHazard, baseline: before, recommendation: after,
      preventedFailureClusters, introducedFailureClusters, persistentFailureClusters,
      pairedClusterPValue: exactMcNemarPValue(preventedFailureClusters, introducedFailureClusters),
      targetMet: after.clusterUncertainty.upperCriticalRiskPct <= targetCriticalRiskPct,
      nonRegression: introducedFailureClusters === 0 };
  });
  const passedCohorts = cohorts.filter((cohort) => cohort.targetMet && cohort.nonRegression).length;
  const status = !affordable.length ? "BUDGET_INFEASIBLE" : passedCohorts === 2 ? "SUPPORTED" : "UNRESOLVED";
  const selectionReason = !affordable.length
    ? "No searched portfolio fits the CAPEX budget. The cheapest frontier portfolio is shown for comparison only; no affordable recommendation is available."
    : feasible.length
      ? "Selected the lowest-reference-CAPEX budget-eligible discovery portfolio whose conservative seed-cluster upper bound meets the target, then carbon and risk. The portfolio was frozen before both holdouts."
      : "No affordable discovery portfolio resolves the conservative risk target. A risk-first candidate is shown, chosen before both independent holdouts; validation cannot replace it with another portfolio.";
  const recommendedConfig = applyInfrastructureInvestment(baselineConfig, recommendation.investment, costs);
  const uncertainty = analyzeValueOfInformation(location, preset, recommendedConfig, plan.intervention, {
    sampleSizePerHazard: Math.min(40, sampleSizePerHazard), seedOffset: plan.uncertaintySeedOffset, hazards,
  });
  return {
    model: "GROUNDED_INFRASTRUCTURE_PARETO_V2", status, targetCriticalRiskPct, budgetCapex: plan.budgetCapex,
    sampleSizePerHazard, hazards, evaluatedCandidates: candidates.length, assumptions: costs,
    baseline, recommendation, candidates, frontier, selectionReason,
    validation: { method: "FROZEN_CANDIDATE_TWO_HOLDOUTS_V1", confidenceLevel: .95,
      sampleSizePerHazard: plan.validationSampleSizePerHazard, requiredZeroFailureSeeds: required,
      capped: required > 2_000, passedCohorts, cohorts },
    replayPlan: plan, uncertainty,
    disclosure: "Model-conditional planning, not facility certification. Portfolios share seed clusters across all hazards; discovery is selection-biased. The selected portfolio is frozen before two disjoint holdouts. Each holdout reports an exact one-sided 95% any-hazard-failure bound; these are not simultaneous guarantees. Zero observed failures do not establish zero risk. Baseline comparisons use the same operating policy without new assets. CAPEX is a reference assumption, not a vendor quote; new generator capacity alone receives the disclosed fuel-hours allowance. Costs and carbon are per 72-hour future, not annual estimates. CVaR95 is an equal-hazard mean of empirical tail losses, not a confidence interval or an estimated annual hazard mixture. Local engineering and independently verified telemetry are still required.",
  };
}
