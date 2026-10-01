import type { RunSummary } from "@verdant/protocol";
import type { Intervention, LocationId, MicrogridConfig, PresetId } from "@verdant/protocol";
import type { OptimizationSearch, OptimizerValidation, ValidationCohort } from "./index.js";
import { DEFAULT_INTERVENTION, exactMcNemarPValue, validateClusterUncertainty } from "./index.js";

/** Transport-independent evidence required by planning and world growth. */
export interface OptimizationEvidence {
  intervention: Intervention;
  result: RunSummary;
  analysis: OptimizationSearch;
  validation: OptimizerValidation;
}

export interface AnalysisInputs {
  locationId: LocationId;
  preset: PresetId;
  config: MicrogridConfig;
  scenarioCount: number;
  siteDataProfileId: string;
}

export function analysisInputKey(input: AnalysisInputs): string {
  return JSON.stringify([input.locationId, input.preset, input.scenarioCount, input.siteDataProfileId,
    Object.entries(input.config).sort(([a], [b]) => a.localeCompare(b))]);
}

export function inputsForRun(run: RunSummary): AnalysisInputs {
  return { locationId: run.location, preset: run.preset, config: { ...run.config }, scenarioCount: run.n,
    siteDataProfileId: run.siteData?.id ?? "representative-model" };
}

export function criticalRiskInterval(failures: number, total: number) {
  if (!Number.isInteger(total) || total <= 0 || !Number.isInteger(failures) || failures < 0 || failures > total) return null;
  const p = failures / total, z2 = 1.96 ** 2, denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius = 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { observedPct: p * 100, lowPct: Math.max(0, center - radius) * 100, highPct: Math.min(1, center + radius) * 100 };
}

export function assessRun(run: RunSummary, targetPct: number) {
  const interval = criticalRiskInterval(run.counts.critical, run.n);
  const countValid = Object.values(run.counts).every((value) => Number.isInteger(value) && value >= 0)
    && Object.values(run.counts).reduce((sum, value) => sum + value, 0) === run.n;
  const audited = countValid && run.audit?.status === "PASS" && run.audit.checks.length > 0
    && run.audit.checks.every((check) => check.passed) && run.manifest?.deterministicReplay === true
    && run.manifest.scenarioCount === run.n && Number.isInteger(run.manifest.seedOffset) && run.manifest.seedOffset >= 0;
  return { interval, audited, withinTarget: audited && !!interval && interval.highPct <= targetPct };
}

type RiskInterval = NonNullable<ReturnType<typeof criticalRiskInterval>>;
export interface HoldoutAssessment {
  label: string;
  sampleSize: number;
  seedOffset: number;
  failures: number;
  introducedFailures: number;
  interval: RiskInterval | null;
  nominalInterval: RiskInterval | null;
  clusterCount: number;
  uncertaintyMethod: "seed-cluster";
  valid: boolean;
  withinTarget: boolean;
}

const count = (value: number) => Number.isInteger(value) && value >= 0;
const matchesRoundedPct = (actual: number, reported: number) => Number.isFinite(reported) && Math.abs(actual - reported) <= 0.050001;

function assessHoldout(cohort: ValidationCohort, targetPct: number, hazardCount: number, recordedTargetPct: number): HoldoutAssessment {
  // Paired transitions retain integer counts. Never compare a rounded display
  // percentage with the user's target or pool independent holdouts to hide one.
  const failures = cohort.introducedFailures + cohort.persistentFailures;
  const beforeFailures = cohort.preventedFailures + cohort.persistentFailures;
  const validCounts = count(cohort.sampleSize) && cohort.sampleSize > 0
    && count(cohort.seedOffset) && [cohort.preventedFailures, cohort.introducedFailures, cohort.persistentFailures].every(count)
    && cohort.preventedFailures + cohort.introducedFailures + cohort.persistentFailures <= cohort.sampleSize;
  const nominalInterval = validCounts ? criticalRiskInterval(failures, cohort.sampleSize) : null;
  const clusterValid = validateClusterUncertainty(cohort.clusterUncertainty, { evaluationCount: cohort.sampleSize,
    hazardCount, seedOffset: cohort.seedOffset, criticalEvaluationCount: failures });
  const interval = clusterValid && nominalInterval ? { ...nominalInterval, lowPct: 0,
    highPct: cohort.clusterUncertainty.upperCriticalRiskPct } : null;
  const pairedClusterCount = Math.floor(cohort.sampleSize / hazardCount);
  const completeCriticalClusters = clusterValid ? cohort.clusterUncertainty.clusters.filter((cluster) =>
    cluster.evaluationCount === hazardCount && cluster.criticalCount > 0).length : -1;
  const clusterTransitionsValid = [cohort.preventedFailureClusters, cohort.introducedFailureClusters, cohort.persistentFailureClusters].every(count)
    && cohort.pairedClusterSampleSize === pairedClusterCount && pairedClusterCount > 0
    && cohort.preventedFailureClusters + cohort.introducedFailureClusters + cohort.persistentFailureClusters <= pairedClusterCount
    && cohort.introducedFailureClusters + cohort.persistentFailureClusters === completeCriticalClusters
    && cohort.preventedFailureClusters <= cohort.preventedFailures && cohort.introducedFailureClusters <= cohort.introducedFailures
    && Number.isFinite(cohort.pairedClusterPValue)
    && Math.abs(cohort.pairedClusterPValue - exactMcNemarPValue(cohort.preventedFailureClusters, cohort.introducedFailureClusters)) < 1e-12;
  const valid = !!interval && !!nominalInterval && clusterTransitionsValid && matchesRoundedPct(interval.observedPct, cohort.afterCriticalPct)
    && matchesRoundedPct(beforeFailures / cohort.sampleSize * 100, cohort.beforeCriticalPct)
    && matchesRoundedPct(nominalInterval.highPct, cohort.afterWilsonHighPct)
    && cohort.targetMet === (interval.highPct <= recordedTargetPct)
    && cohort.passed === (failures <= beforeFailures && cohort.preventedFailures >= cohort.introducedFailures);
  return { label: cohort.label, sampleSize: cohort.sampleSize, seedOffset: cohort.seedOffset, failures,
    introducedFailures: cohort.introducedFailures, interval, nominalInterval, clusterCount: cohort.clusterUncertainty?.clusterCount ?? 0,
    uncertaintyMethod: "seed-cluster", valid, withinTarget: valid && !!interval && interval.highPct <= targetPct };
}

/** Planning support, not field approval. The primary selected-hazard sample
 * cannot substitute for independent mixed-hazard evidence after optimization. */
export function assessDecisionReadiness(baseline: RunSummary | null, optimized: OptimizationEvidence | null, targetPct: number, stale = false) {
  const result = optimized?.result ?? baseline;
  const assessment = result ? assessRun(result, targetPct) : null;
  const targetValid = Number.isFinite(targetPct) && targetPct > 0 && targetPct <= 100;
  const validation = optimized?.validation;
  const cohorts = Array.isArray(validation?.cohorts) ? validation.cohorts : [];
  const holdouts = cohorts.map((cohort) => assessHoldout(cohort, targetPct, optimized?.analysis?.hazardCount ?? 0, validation?.riskTargetPct ?? NaN));
  const targetMetCohorts = holdouts.filter((cohort) => cohort.withinTarget).length;
  const selectedSampleAdditionalFailures = optimized && baseline
    ? Math.max(0, optimized.result.counts.critical - baseline.counts.critical) : 0;
  const introducedFailures = holdouts.reduce((sum, cohort) => sum + (count(cohort.introducedFailures) ? cohort.introducedFailures : 0), 0);
  const shocks = Array.isArray(validation?.shockResults) ? validation.shockResults : [];
  const shockIntroducedFailures = shocks.reduce((sum, shock) => sum + (count(shock.introducedFailures) ? shock.introducedFailures : 0), 0);
  const envelope = validation?.jointStressEnvelope;
  const stressRegressionCells = envelope && count(envelope.evaluatedCells) && count(envelope.zeroRegressionCells)
    ? Math.max(0, envelope.evaluatedCells - envelope.zeroRegressionCells) : 0;
  const rank = validation?.decisionStability;
  let evidenceValid = false;
  let recommendationStable = false;
  let rankStable = false;
  let assumptionsStable = false;
  const reasons: string[] = [];

  if (optimized && baseline && validation) {
    const search = optimized.analysis;
    const hazards = search?.hazardCount;
    const searchValid = !!search && count(hazards) && hazards > 0 && count(search.sampleSize) && search.sampleSize > 0 && count(search.seedOffset)
      && search.riskTargetPct === targetPct && validation.riskTargetPct === targetPct && search.discoveryOnly === true
      && count(search.evaluatedStrategies) && search.evaluatedStrategies > 0 && count(search.feasibleStrategyCount)
      && search.feasibleStrategyCount <= search.evaluatedStrategies
      && search.selectionMode === (search.feasibleStrategyCount > 0 ? "TARGET_FEASIBLE_MINIMAL_DISRUPTION" : "TARGET_UNRESOLVED_RISK_FIRST")
      && validateClusterUncertainty(search.best?.clusterUncertainty, { evaluationCount: search.sampleSize,
        hazardCount: hazards, seedOffset: search.seedOffset, criticalEvaluationCount: search.best?.criticalCount })
      && (search.feasibleStrategyCount === 0 || search.best.clusterUncertainty.upperCriticalRiskPct <= targetPct);
    // One seed is reused across the hazard strata inside a cohort. Separation
    // is checked in seed-index space, not by treating sampleSize as a stride.
    const ranges = searchValid ? holdouts.map((cohort) => ({ start: cohort.seedOffset, end: cohort.seedOffset + Math.ceil(cohort.sampleSize / hazards) })) : [];
    const searchRange = searchValid ? { start: search.seedOffset, end: search.seedOffset + Math.ceil(search.sampleSize / hazards) } : null;
    const baselineRange = { start: baseline.manifest?.seedOffset ?? 0, end: (baseline.manifest?.seedOffset ?? 0) + baseline.n };
    const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;
    const separated = !!searchRange && !overlaps(searchRange, baselineRange)
      && ranges.every((range, index) => !overlaps(range, baselineRange) && !overlaps(range, searchRange)
        && ranges.every((other, otherIndex) => index === otherIndex || !overlaps(range, other)));
    const cohortEvidence = holdouts.length >= 3 && validation.cohortCount === holdouts.length && holdouts.every((cohort) => cohort.valid)
      && new Set(holdouts.map((cohort) => cohort.label)).size === holdouts.length
      && validation.passedCohorts === cohorts.filter((cohort) => cohort.passed).length
      && validation.statisticallyResolvedCohorts === cohorts.filter((cohort) => cohort.pairedClusterPValue < 0.05).length
      && validation.zeroRegressionCohorts === holdouts.filter((cohort) => cohort.introducedFailures === 0).length;
    const expectedShockLabels = ["+20% restoration time", "+10% community demand", "−10% solar capacity", "−10 battery SOC points"];
    const shockEvidence = shocks.length === expectedShockLabels.length && new Set(shocks.map((shock) => shock.label)).size === shocks.length
      && expectedShockLabels.every((label) => shocks.some((shock) => shock.label === label))
      && Array.isArray(validation.assumptionShocks) && validation.assumptionShocks.length === shocks.length
      && validation.assumptionShocks.every((label) => shocks.some((shock) => shock.label === label))
      && holdouts.every((cohort) => cohort.sampleSize === holdouts[0]?.sampleSize)
      && shocks.every((shock) => [shock.beforeCritical, shock.afterCritical, shock.preventedFailures, shock.introducedFailures].every(count)
        && shock.beforeCritical <= holdouts[0]?.sampleSize && shock.afterCritical <= holdouts[0]?.sampleSize
        && shock.beforeCritical + shock.introducedFailures <= holdouts[0]?.sampleSize
        && shock.beforeCritical - shock.preventedFailures === shock.afterCritical - shock.introducedFailures
        && shock.beforeCritical >= shock.preventedFailures && shock.afterCritical >= shock.introducedFailures
        && shock.passed === (shock.afterCritical <= shock.beforeCritical && shock.preventedFailures >= shock.introducedFailures));
    const expectedStressDimensions = ["Restoration time", "Community demand", "Solar capacity", "Starting battery SOC"];
    // The declared validation design is a 3×3×3×3 full factorial, not an
    // arbitrary subset whose passing cells can masquerade as a complete test.
    const envelopeEvidence = !!envelope && envelope.evaluatedCells === 81
      && Array.isArray(envelope.dimensions) && envelope.dimensions.length === expectedStressDimensions.length
      && new Set(envelope.dimensions).size === expectedStressDimensions.length
      && expectedStressDimensions.every((dimension) => envelope.dimensions.includes(dimension))
      && count(envelope.sampleSizePerCell) && envelope.sampleSizePerCell > 0
      && count(envelope.passingCells) && envelope.passingCells <= envelope.evaluatedCells
      && count(envelope.zeroRegressionCells) && envelope.zeroRegressionCells <= envelope.evaluatedCells
      && !!envelope.worstCell && [envelope.worstCell.beforeCritical, envelope.worstCell.afterCritical, envelope.worstCell.preventedFailures, envelope.worstCell.introducedFailures].every(count)
      && envelope.worstCell.beforeCritical <= envelope.sampleSizePerCell && envelope.worstCell.afterCritical <= envelope.sampleSizePerCell
      && envelope.worstCell.beforeCritical >= envelope.worstCell.preventedFailures && envelope.worstCell.afterCritical >= envelope.worstCell.introducedFailures
      && envelope.worstCell.beforeCritical + envelope.worstCell.introducedFailures <= envelope.sampleSizePerCell
      && envelope.worstCell.beforeCritical - envelope.worstCell.preventedFailures === envelope.worstCell.afterCritical - envelope.worstCell.introducedFailures
      && matchesRoundedPct(envelope.worstCell.afterCritical / envelope.sampleSizePerCell * 100, envelope.worstCell.residualCriticalPct)
      && envelope.worstCell.passed === (envelope.worstCell.afterCritical <= envelope.worstCell.beforeCritical && envelope.worstCell.preventedFailures >= envelope.worstCell.introducedFailures)
      && (envelope.passingCells < envelope.evaluatedCells || envelope.worstCell.passed)
      && (envelope.zeroRegressionCells < envelope.evaluatedCells || envelope.worstCell.introducedFailures === 0);
    const rankEvidence = !!rank && count(rank.candidateCount) && rank.candidateCount > 0
      && rank.cohortCount === holdouts.length && Array.isArray(rank.cohorts) && rank.cohorts.length === holdouts.length
      && rank.cohorts.every((cohort, index) => cohort.seedOffset === holdouts[index]?.seedOffset
        && cohort.label === holdouts[index]?.label && cohort.targetMet === holdouts[index]?.withinTarget
        && ["TARGET_FEASIBLE_MINIMAL_DISRUPTION", "TARGET_UNRESOLVED_RISK_FIRST"].includes(cohort.selectionMode)
        && (!cohort.targetMet || cohort.selectionMode === "TARGET_FEASIBLE_MINIMAL_DISRUPTION")
        && cohort.candidateCount === rank.candidateCount && Number.isInteger(cohort.recommendedRank)
        && cohort.recommendedRank >= 1 && cohort.recommendedRank <= cohort.candidateCount
        && Number.isFinite(cohort.riskRegretPct) && cohort.riskRegretPct >= 0)
      && rank.topThreeCohorts === rank.cohorts.filter((cohort) => cohort.recommendedRank <= 3).length
      && rank.firstPlaceCohorts === rank.cohorts.filter((cohort) => cohort.recommendedRank === 1).length
      && rank.maxRiskRegretPct === Math.max(...rank.cohorts.map((cohort) => cohort.riskRegretPct));
    const matchingInputs = analysisInputKey(inputsForRun(baseline)) === analysisInputKey(inputsForRun(optimized.result))
      && ["reservePct", "evDelayMin", "precoolHour"].every((key) =>
        baseline.intervention[key as keyof typeof DEFAULT_INTERVENTION] === DEFAULT_INTERVENTION[key as keyof typeof DEFAULT_INTERVENTION])
      && baseline.manifest?.calibrationFingerprint === optimized.result.manifest?.calibrationFingerprint
      && ["modelVersion", "engine", "horizonHours", "timestepMinutes", "seedScheme"].every((field) =>
        baseline.manifest?.[field as keyof NonNullable<RunSummary["manifest"]>] === optimized.result.manifest?.[field as keyof NonNullable<RunSummary["manifest"]>])
      && baseline.siteData?.fingerprint === optimized.result.siteData?.fingerprint
      && baseline.manifest?.seedOffset === optimized.result.manifest?.seedOffset
      && ["reservePct", "evDelayMin", "precoolHour"].every((key) => {
        const field = key as keyof OptimizationEvidence["intervention"];
        return optimized.intervention[field] === optimized.result.intervention[field]
          && optimized.intervention[field] === search?.best?.intervention[field];
      });
    evidenceValid = searchValid && separated && cohortEvidence && shockEvidence && envelopeEvidence && rankEvidence && matchingInputs;
    assumptionsStable = shockEvidence && shocks.every((shock) => shock.passed)
      && !!envelope && envelope.passingCells === envelope.evaluatedCells;
    recommendationStable = cohortEvidence && cohorts.every((cohort) => cohort.passed) && assumptionsStable && validation.recommendationStable;
    rankStable = rankEvidence && !!rank && rank.topThreeCohorts === rank.cohortCount && rank.cohorts.every((cohort) => cohort.targetMet) && rank.stable;
  }

  const audited = !!assessment?.audited && (!optimized || !!baseline && assessRun(baseline, targetPct).audited);
  const regressionFree = selectedSampleAdditionalFailures === 0 && introducedFailures === 0 && shockIntroducedFailures === 0 && stressRegressionCells === 0;
  const withinTarget = !!result && !stale && targetValid && audited && !!assessment?.withinTarget
    && (!optimized || evidenceValid && targetMetCohorts === holdouts.length && recommendationStable && rankStable && regressionFree);

  let status: "awaiting" | "stale" | "integrity" | "evidence" | "regression" | "above" | "unresolved" | "stability" | "supported" = "awaiting";
  let label = "Awaiting first run";
  let summary = "Assess the upper 95% risk bound after a run. Optimization adds independent seed-cluster holdout and stability checks.";
  if (result) {
    if (stale) {
      status = "stale"; label = "Earlier configuration";
      summary = "These results belong to earlier inputs. Test the current configuration before using them to choose a plan.";
    } else if (!targetValid || !audited) {
      status = "integrity"; label = "Integrity review";
      summary = "The sampling target cannot be supported until the run's counts, conservation audit and deterministic replay pass.";
    } else if (optimized && !evidenceValid) {
      status = "evidence"; label = "Evidence review";
      summary = "Independent validation is missing, inconsistent or overlaps the selection sample. The selected-preset result alone is insufficient.";
    } else if (optimized && !regressionFree) {
      status = "regression"; label = "Regression review";
      summary = "The policy introduced critical failures in at least one tested setting. Aggregate improvement does not clear that trade-off.";
    } else if (!assessment?.withinTarget || optimized && targetMetCohorts < holdouts.length) {
      const observedAbove = (assessment?.interval?.observedPct ?? Infinity) > targetPct || holdouts.some((cohort) => (cohort.interval?.observedPct ?? Infinity) > targetPct);
      status = observedAbove ? "above" : "unresolved";
      label = observedAbove ? "Above planning target" : "Target not resolved";
      summary = optimized
        ? `${targetMetCohorts}/${holdouts.length} independent holdouts have a one-sided 95% seed-cluster risk upper bound within ${targetPct}%. A low selected-preset result cannot clear the remaining holdouts.`
        : "The upper 95% sampling bound exceeds your target. Zero observed failures is not zero risk; inspect failures or gather more evidence.";
    } else if (optimized && (!recommendationStable || !rankStable)) {
      status = "stability"; label = "Stability review";
      summary = "The risk bounds meet the target, but the policy did not retain its evidence or shortlist stability across tested settings.";
    } else {
      status = "supported"; label = optimized ? "Holdout target supported" : "Within selected sample target";
      summary = optimized
        ? `All ${holdouts.length} seed-cluster holdout upper bounds meet ${targetPct}%, with stable policy checks and no introduced failures.`
        : "The upper sampling bound meets your target for this selected hazard only. Independent mixed-hazard validation has not yet been performed.";
    }
  }
  if (optimized) {
    if (!evidenceValid) reasons.push("Validate cohort counts, seed separation and complete stress evidence.");
    if (selectedSampleAdditionalFailures) reasons.push(`${selectedSampleAdditionalFailures} additional critical failures in the selected-hazard comparison (net count, not a paired transition total).`);
    if (introducedFailures) reasons.push(`${introducedFailures} introduced critical failures across the disjoint holdouts.`);
    if (shockIntroducedFailures) reasons.push(`${shockIntroducedFailures} introduced critical failures across the four assumption shocks; these settings reuse seeds, so this is not a unique-future count.`);
    if (stressRegressionCells) reasons.push(`${stressRegressionCells} compound stress cells contained introduced failures.`);
    if (targetMetCohorts < holdouts.length) reasons.push(`${holdouts.length - targetMetCohorts} holdout upper bounds exceed the target or need integrity review.`);
    if (!recommendationStable) reasons.push("The recommendation needs non-regression review under the tested assumptions.");
    if (!rankStable) reasons.push("The selected policy needs rank-stability review among the discovered shortlist.");
  }
  return { result, assessment, holdouts, targetMetCohorts, selectedSampleAdditionalFailures, introducedFailures, shockIntroducedFailures, stressRegressionCells,
    evidenceValid, recommendationStable, rankStable, assumptionsStable, audited, withinTarget, status, label, summary, reasons };
}
