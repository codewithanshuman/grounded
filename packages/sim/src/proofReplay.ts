import type { RunSummary } from "@verdant/protocol";
import { StoredEvidence as StoredEvidenceSchema, type StoredEvidence } from "@verdant/protocol/evidence";
import { SimulationRequest } from "@verdant/protocol/requests";
import {
  DEFAULT_INTERVENTION, LOCATIONS, MODEL_VERSION, PRESET_ORDER, analyzeInterventions, analyzeSensitivity,
  locationFromCalibration, locationWithSiteData, runMonteCarlo, toRunSummary, validateIntervention,
} from "./index.js";
import { optimizeInfrastructure, resolveInvestmentPlan } from "./investmentOptimizer.js";

export interface ProofReplayCheck { label: string; passed: boolean; detail: string }
export interface ProofReplayResult {
  status: "PASS" | "FAIL";
  modelVersion: string;
  checkedAt: number;
  scope: "BASELINE_ONLY" | "POLICY_OPTIMIZATION_ONLY" | "FULL_OPTIMIZATION" | "REJECTED";
  statement: string;
  checks: ProofReplayCheck[];
  replayedStages: string[];
  baselineRunId?: string;
  optimizedRunId?: string;
}

const MAX_RUN_SIZE = 10_000;
const MAX_COHORT_SIZE = 2_000;
const MAX_SEED_OFFSET = 1_000_000;
const FLOAT_TOLERANCE = 1e-9;

function mismatch(recorded: unknown, replayed: unknown, path = "evidence"): string | null {
  if (typeof recorded === "number" && typeof replayed === "number") {
    return Number.isFinite(recorded) && Number.isFinite(replayed) && Math.abs(recorded - replayed) <= FLOAT_TOLERANCE
      ? null : `${path}: recorded ${recorded}, replayed ${replayed}`;
  }
  if (recorded === replayed) return null;
  if (Array.isArray(recorded) && Array.isArray(replayed)) {
    if (recorded.length !== replayed.length) return `${path}: array lengths ${recorded.length} and ${replayed.length} differ`;
    for (let index = 0; index < recorded.length; index++) {
      const difference = mismatch(recorded[index], replayed[index], `${path}[${index}]`);
      if (difference) return difference;
    }
    return null;
  }
  if (recorded && replayed && typeof recorded === "object" && typeof replayed === "object") {
    const before = recorded as Record<string, unknown>, after = replayed as Record<string, unknown>;
    // JSON omits undefined optional fields; an exported proof must replay like
    // the original in-memory report without ignoring any scientific quantity.
    const keysBefore = Object.keys(before).filter((key) => before[key] !== undefined).sort();
    const keysAfter = Object.keys(after).filter((key) => after[key] !== undefined).sort();
    if (JSON.stringify(keysBefore) !== JSON.stringify(keysAfter)) return `${path}: object fields differ`;
    for (const key of keysBefore) {
      const difference = mismatch(before[key], after[key], `${path}.${key}`);
      if (difference) return difference;
    }
    return null;
  }
  return `${path}: recorded and replayed values differ`;
}

function modelRun(run: RunSummary) {
  const { runId: _id, createdAt: _time, ...scientific } = run;
  return scientific;
}

function finiteEvidence(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(finiteEvidence);
  if (value && typeof value === "object") return Object.values(value).every(finiteEvidence);
  return true;
}

function seedOffset(value: number | undefined): value is number {
  return Number.isSafeInteger(value) && value! >= 0 && value! <= MAX_SEED_OFFSET;
}

function assertRunPlan(run: RunSummary): void {
  if (!Number.isInteger(run.n) || run.n < 100 || run.n > MAX_RUN_SIZE || !seedOffset(run.manifest?.seedOffset)) {
    throw new Error(`Unsupported replay plan: runs need 100–${MAX_RUN_SIZE} futures and an integer seed offset in 0–${MAX_SEED_OFFSET}.`);
  }
  SimulationRequest.parse({ location: run.location, preset: run.preset, config: run.config, scenarioCount: run.n,
    siteDataProfileId: run.siteData?.id ?? "representative-model" });
  if (!run.metrics || !run.audit || !run.manifest || run.manifest.modelVersion !== MODEL_VERSION
    || run.manifest.scenarioCount !== run.n || run.manifest.horizonHours !== 72 || run.manifest.timestepMinutes !== 15
    || run.manifest.calibrationFingerprint !== (run.calibration?.fingerprint ?? "REFERENCE")
    || run.manifest.siteDataFingerprint !== run.siteData?.fingerprint) {
    throw new Error("The run is incomplete, uses another model, or has inconsistent source/horizon/sample metadata.");
  }
  if (!Object.values(run.counts).every((count) => Number.isInteger(count) && count >= 0)
    || Object.values(run.counts).reduce((sum, count) => sum + count, 0) !== run.n || run.failures.length > run.n) {
    throw new Error("The run's classification counts or retained failures are inconsistent.");
  }
  if (run.calibration && (run.calibration.monthly.length > 12 || run.calibration.historicalDays.length > 12)) {
    throw new Error("Unsupported climate replay: this engine's contract retains at most 12 monthly and 12 historical profiles.");
  }
  if (run.sensitivity && run.sensitivity.sampleSize !== Math.min(300, run.n)) {
    throw new Error("Unsupported sensitivity sample: the declared engine uses min(300, run population)." );
  }
}

function replayRun(run: RunSummary, includeSensitivity: boolean): RunSummary {
  const location = locationFromCalibration(locationWithSiteData(LOCATIONS[run.location], run.siteData), run.calibration);
  const offset = run.manifest!.seedOffset;
  const mc = runMonteCarlo(run.n, location, run.preset, run.config, run.intervention, offset);
  const sensitivity = includeSensitivity && run.sensitivity
    ? analyzeSensitivity(location, run.preset, run.config, run.sensitivity.sampleSize) : undefined;
  return toRunSummary(run.runId, mc, run.calibration, sensitivity, offset, run.siteData);
}

/** Replay embedded model evidence, without network access, writes or growth.
 * A matching report establishes reproducibility under its recorded assumptions,
 * not data authenticity, independent field validation or a future guarantee.
 * Intended for an isolated worker because full optimization replay is costly. */
export function replayEvidence(input: unknown): ProofReplayResult {
  const checks: ProofReplayCheck[] = [];
  const replayedStages: string[] = [];
  let payload: StoredEvidence;
  const result = (scope: ProofReplayResult["scope"], baselineRunId?: string, optimizedRunId?: string): ProofReplayResult => ({
    status: checks.length > 0 && checks.every((check) => check.passed) ? "PASS" : "FAIL",
    modelVersion: MODEL_VERSION, checkedAt: Date.now(), scope,
    statement: "Deterministic replay of the embedded model evidence only. Not a source-authenticity check, field validation, or reliability guarantee. World growth and event timestamps are not model outputs and are never mutated by replay."
      + (scope === "POLICY_OPTIMIZATION_ONLY" ? " This legacy package contains operating-policy evidence only; no physical-investment result was checked." : ""),
    checks, replayedStages, baselineRunId, optimizedRunId,
  });
  try {
    if (JSON.stringify(input).length > 20 * 1024 * 1024) throw new Error("Proof exceeds the 20 MB bounded replay limit.");
    payload = StoredEvidenceSchema.parse(input);
    if (payload.modelVersion !== MODEL_VERSION) throw new Error(`Model mismatch: proof ${payload.modelVersion}; replay engine ${MODEL_VERSION}.`);
    if (!finiteEvidence(payload)) throw new Error("Proof contains non-finite numerical evidence.");
    assertRunPlan(payload.baseline);
    const optimization = payload.optimization;
    if (optimization) {
      assertRunPlan(optimization.result);
      const search = optimization.analysis, validation = optimization.validation;
      if (mismatch(payload.baseline.intervention, DEFAULT_INTERVENTION)) throw new Error("Full strategy replay requires the declared no-intervention baseline.");
      if (!Number.isInteger(search.sampleSize) || search.sampleSize < 100 || search.sampleSize > MAX_COHORT_SIZE
        || search.hazardCount !== PRESET_ORDER.length || search.evaluatedStrategies !== 245
        || !seedOffset(search.seedOffset) || search.frontier.length > 12
        || validation.cohorts.length !== 3 || validation.cohorts.some((cohort) =>
          !Number.isInteger(cohort.sampleSize) || cohort.sampleSize < 100 || cohort.sampleSize > MAX_COHORT_SIZE
          || cohort.sampleSize !== validation.cohorts[0].sampleSize || !seedOffset(cohort.seedOffset))
        || search.riskTargetPct !== payload.riskTargetPct || validation.riskTargetPct !== payload.riskTargetPct) {
        throw new Error("Unsupported or inconsistent discovery/validation sampling plan; no stage was silently omitted.");
      }
      if (search.seedOffset !== payload.baseline.manifest!.seedOffset + payload.baseline.n
        || validation.cohorts[0].seedOffset !== search.seedOffset + 10_000) {
        throw new Error("Unsupported seed plan: discovery and validation must follow the declared engine's disjoint offsets.");
      }
      if (!payload.baseline.calibration || payload.baseline.calibration.monthly.length + payload.baseline.calibration.historicalDays.length === 0) {
        throw new Error("Historical validation is declared but its recorded climate profiles are missing; full replay cannot pass by skipping it.");
      }
      if (optimization.result.sensitivity) throw new Error("The declared optimized-result contract does not include a separately fitted sensitivity report.");
      const investment = optimization.investmentAnalysis;
      if (investment?.model === "GROUNDED_INFRASTRUCTURE_PARETO_V1") {
        throw new Error("The retained V1 investment report has no independent validation or replay plan. It remains available; rerun optimization to create a replayable V2 report.");
      }
      if (investment?.model === "GROUNDED_INFRASTRUCTURE_PARETO_V2") {
        const plan = resolveInvestmentPlan(payload.baseline.config, investment.replayPlan);
        const planMismatch = mismatch(investment.replayPlan, plan)
          ?? mismatch(plan.intervention, optimization.intervention)
          ?? mismatch(plan.hazards, PRESET_ORDER);
        if (planMismatch || investment.targetCriticalRiskPct !== payload.riskTargetPct
          || plan.targetCriticalRiskPct !== payload.riskTargetPct) {
          throw new Error(`Investment evidence must use the retained operating policy, planning target and normalized replay plan. ${planMismatch ?? "Target differs."}`);
        }
        // Include every seed consumed by selection and its diagnostics. Physical
        // investment evidence must not reuse scenarios that chose the policy.
        const policyClusters = Math.ceil(validation.cohorts[0].sampleSize / PRESET_ORDER.length);
        const usedRanges = [
          [payload.baseline.manifest!.seedOffset, payload.baseline.n],
          [search.seedOffset, Math.ceil(search.sampleSize / PRESET_ORDER.length)],
          [validation.cohorts[0].seedOffset, 5 * (policyClusters + 17) + policyClusters],
          [50_000, 12 * 24],
        ];
        const investmentRanges = [[plan.seedOffset, plan.sampleSizePerHazard],
          ...plan.validationSeedOffsets.map((offset) => [offset, plan.validationSampleSizePerHazard]),
          [plan.uncertaintySeedOffset, Math.min(40, plan.sampleSizePerHazard) * plan.hazards.length]];
        if (investmentRanges.some(([start, length]) => usedRanges.some(([other, count]) => start < other + count && other < start + length))) {
          throw new Error("Investment scenarios overlap the retained baseline or policy selection/validation seeds. Independent investment evidence requires disjoint ranges.");
        }
      }
    }
    checks.push({ label: "Replay plan and model", passed: true, detail: `Schema and finite values accepted; engine ${MODEL_VERSION}, bounded samples and recorded source fingerprints.` });
  } catch (error) {
    checks.push({ label: "Replay plan and model", passed: false, detail: error instanceof Error ? error.message : "Proof rejected before simulation." });
    return result("REJECTED");
  }

  const compare = (label: string, recorded: unknown, replayed: unknown, detail: string) => {
    const difference = mismatch(recorded, replayed);
    checks.push({ label, passed: difference === null, detail: difference ?? detail });
    replayedStages.push(label);
  };
  try {
    const baseline = payload.baseline;
    const replayedBaseline = replayRun(baseline, true);
    compare("Baseline run", modelRun(baseline), modelRun(replayedBaseline),
      `Recomputed ${baseline.n} recorded seeds, counts, every metric and retained failure, surrogate, audit, manifest${baseline.sensitivity ? " and sensitivity" : ""}. Only run ID and creation time are excluded.`);
    if (!payload.optimization) return result("BASELINE_ONLY", baseline.runId);

    const optimization = payload.optimization;
    const replayedResult = replayRun(optimization.result, false);
    compare("Optimized run", modelRun(optimization.result), modelRun(replayedResult),
      `Recomputed ${optimization.result.n} recorded seeds with the recorded policy; all counts, metrics, failures, surrogate, audit and manifest matched.`);
    const location = locationFromCalibration(locationWithSiteData(LOCATIONS[baseline.location], baseline.siteData), baseline.calibration);
    const search = optimization.analysis;
    const replayedSearch = analyzeInterventions(location, baseline.preset, baseline.config, search.sampleSize, search.seedOffset,
      PRESET_ORDER, search.riskTargetPct);
    compare("Discovery search", search, replayedSearch,
      `Re-evaluated all 245 policies on ${search.sampleSize} modeled evaluations; exact selected policy, frontier, cluster bounds, target and selection metadata matched.`);
    const validation = optimization.validation;
    const replayedValidation = validateIntervention(location, baseline.config, optimization.intervention,
      validation.cohorts[0].seedOffset, validation.cohorts[0].sampleSize, PRESET_ORDER,
      search.frontier.map((candidate) => candidate.intervention), validation.riskTargetPct);
    compare("Independent validation", validation, replayedValidation,
      "Recomputed all three holdouts, integer paired/cluster transitions, uncertainty bounds, five benchmarks, four assumption shocks, 81 stress cells and shortlist stability. No validation stage was omitted.");
    const calibration = baseline.calibration!;
    const periods = calibration.historicalDays.length ? calibration.historicalDays : calibration.monthly.map((month) => ({ ...month, date: month.month }));
    let beforeCritical = 0, afterCritical = 0, passedPeriods = 0;
    periods.forEach((period, index) => {
      const historical = locationFromCalibration(locationWithSiteData(LOCATIONS[baseline.location], baseline.siteData), calibration, { ...period, month: period.date });
      const offset = 50_000 + index * 24;
      const before = runMonteCarlo(24, historical, baseline.preset, baseline.config, DEFAULT_INTERVENTION, offset);
      const after = runMonteCarlo(24, historical, baseline.preset, baseline.config, optimization.intervention, offset);
      beforeCritical += before.counts.critical;
      afterCritical += after.counts.critical;
      if (after.counts.critical === 0) passedPeriods++;
    });
    const historicalBacktest = { periods: periods.length, futures: periods.length * 24, beforeCritical, afterCritical, passedPeriods,
      source: calibration.source, label: calibration.historicalDays.length
        ? "12 highest-stress observed NASA POWER climate days from 2023; outage and demand remain simulated"
        : "12 representative monthly climate profiles; all operational conditions are simulated" };
    compare("Historical climate replay", optimization.historicalBacktest, historicalBacktest,
      `Recomputed ${periods.length} recorded climate profiles and ${periods.length * 24} paired futures; operational conditions remain simulated.`);
    if (optimization.investmentAnalysis?.model === "GROUNDED_INFRASTRUCTURE_PARETO_V2") {
      const replayedInvestment = optimizeInfrastructure(location, baseline.preset, baseline.config,
        optimization.investmentAnalysis.replayPlan);
      compare("Physical investment search", optimization.investmentAnalysis, replayedInvestment,
        `Recomputed all ${optimization.investmentAnalysis.evaluatedCandidates} physical portfolios, the frozen winner, both independent holdouts and all measurement priorities from the retained plan.`);
    }
    const relationshipError = mismatch(optimization.intervention, optimization.result.intervention)
      ?? mismatch(optimization.intervention, search.best.intervention)
      ?? mismatch({ location: baseline.location, preset: baseline.preset, config: baseline.config, n: baseline.n,
        calibration: baseline.calibration, siteData: baseline.siteData, seedOffset: baseline.manifest!.seedOffset },
      { location: optimization.result.location, preset: optimization.result.preset, config: optimization.result.config, n: optimization.result.n,
        calibration: optimization.result.calibration, siteData: optimization.result.siteData, seedOffset: optimization.result.manifest!.seedOffset });
    checks.push({ label: "Evidence relationships", passed: relationshipError === null,
      detail: relationshipError ?? "Discovery winner, declared intervention and result policy match; baseline/result share the same config, sources, sample population and paired seeds." });
    return result(optimization.investmentAnalysis ? "FULL_OPTIMIZATION" : "POLICY_OPTIMIZATION_ONLY", baseline.runId, optimization.result.runId);
  } catch (error) {
    checks.push({ label: "Replay execution", passed: false,
      detail: `${error instanceof Error ? error.message : "Replay failed"}. Only stages listed in replayedStages completed; remaining stages were not validated.` });
    return result(payload.optimization ? payload.optimization.investmentAnalysis ? "FULL_OPTIMIZATION" : "POLICY_OPTIMIZATION_ONLY" : "BASELINE_ONLY", payload.baseline.runId, payload.optimization?.result.runId);
  }
}
