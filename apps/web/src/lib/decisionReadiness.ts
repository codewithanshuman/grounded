import type { RunSummary } from "@verdant/protocol";
import type { ValidationCohort } from "@verdant/sim";
import type { OptimizeResponse } from "../ws/client";
import { analysisInputKey, assessRun, criticalRiskInterval, inputsForRun } from "./analysisContext";

type RiskInterval = NonNullable<ReturnType<typeof criticalRiskInterval>>;
export interface HoldoutAssessment {
  label: string;
  sampleSize: number;
  seedOffset: number;
  failures: number;
  introducedFailures: number;
  interval: RiskInterval | null;
  valid: boolean;
  withinTarget: boolean;
}

const count = (value: number) => Number.isInteger(value) && value >= 0;
const matchesRoundedPct = (actual: number, reported: number) => Number.isFinite(reported) && Math.abs(actual - reported) <= 0.050001;

function assessHoldout(cohort: ValidationCohort, targetPct: number): HoldoutAssessment {
  // Paired transitions retain integer counts. Never compare a rounded display
  // percentage with the user's target or pool independent holdouts to hide one.
  const failures = cohort.introducedFailures + cohort.persistentFailures;
  const beforeFailures = cohort.preventedFailures + cohort.persistentFailures;
  const validCounts = count(cohort.sampleSize) && cohort.sampleSize > 0
    && count(cohort.seedOffset) && [cohort.preventedFailures, cohort.introducedFailures, cohort.persistentFailures].every(count)
    && cohort.preventedFailures + cohort.introducedFailures + cohort.persistentFailures <= cohort.sampleSize;
  const interval = validCounts ? criticalRiskInterval(failures, cohort.sampleSize) : null;
  const valid = !!interval && matchesRoundedPct(interval.observedPct, cohort.afterCriticalPct)
    && matchesRoundedPct(beforeFailures / cohort.sampleSize * 100, cohort.beforeCriticalPct)
    && matchesRoundedPct(interval.highPct, cohort.afterWilsonHighPct)
    && cohort.passed === (failures <= beforeFailures && cohort.preventedFailures >= cohort.introducedFailures);
  return { label: cohort.label, sampleSize: cohort.sampleSize, seedOffset: cohort.seedOffset, failures,
    introducedFailures: cohort.introducedFailures, interval, valid, withinTarget: valid && !!interval && interval.highPct <= targetPct };
}

/** Planning support, not field approval. The primary selected-hazard sample
 * cannot substitute for independent mixed-hazard evidence after optimization. */
export function assessDecisionReadiness(baseline: RunSummary | null, optimized: OptimizeResponse | null, targetPct: number, stale = false) {
  const result = optimized?.result ?? baseline;
  const assessment = result ? assessRun(result, targetPct) : null;
  const targetValid = Number.isFinite(targetPct) && targetPct > 0 && targetPct <= 100;
  const validation = optimized?.validation;
  const cohorts = Array.isArray(validation?.cohorts) ? validation.cohorts : [];
  const holdouts = cohorts.map((cohort) => assessHoldout(cohort, targetPct));
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
    const searchValid = !!search && count(hazards) && hazards > 0 && count(search.sampleSize) && search.sampleSize > 0 && count(search.seedOffset);
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
      && validation.zeroRegressionCohorts === holdouts.filter((cohort) => cohort.introducedFailures === 0).length;
    const shockEvidence = shocks.length === 4 && new Set(shocks.map((shock) => shock.label)).size === shocks.length
      && Array.isArray(validation.assumptionShocks) && validation.assumptionShocks.length === shocks.length
      && validation.assumptionShocks.every((label) => shocks.some((shock) => shock.label === label))
      && holdouts.every((cohort) => cohort.sampleSize === holdouts[0]?.sampleSize)
      && shocks.every((shock) => [shock.beforeCritical, shock.afterCritical, shock.preventedFailures, shock.introducedFailures].every(count)
        && shock.beforeCritical <= holdouts[0]?.sampleSize && shock.afterCritical <= holdouts[0]?.sampleSize
        && shock.beforeCritical + shock.introducedFailures <= holdouts[0]?.sampleSize
        && shock.beforeCritical - shock.preventedFailures === shock.afterCritical - shock.introducedFailures
        && shock.beforeCritical >= shock.preventedFailures && shock.afterCritical >= shock.introducedFailures
        && shock.passed === (shock.afterCritical <= shock.beforeCritical && shock.preventedFailures >= shock.introducedFailures));
    const envelopeEvidence = !!envelope && count(envelope.evaluatedCells) && envelope.evaluatedCells > 0
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
        && cohort.candidateCount === rank.candidateCount && Number.isInteger(cohort.recommendedRank)
        && cohort.recommendedRank >= 1 && cohort.recommendedRank <= cohort.candidateCount
        && Number.isFinite(cohort.riskRegretPct) && cohort.riskRegretPct >= 0)
      && rank.topThreeCohorts === rank.cohorts.filter((cohort) => cohort.recommendedRank <= 3).length
      && rank.firstPlaceCohorts === rank.cohorts.filter((cohort) => cohort.recommendedRank === 1).length
      && rank.maxRiskRegretPct === Math.max(...rank.cohorts.map((cohort) => cohort.riskRegretPct));
    const matchingInputs = analysisInputKey(inputsForRun(baseline)) === analysisInputKey(inputsForRun(optimized.result))
      && baseline.manifest?.calibrationFingerprint === optimized.result.manifest?.calibrationFingerprint
      && baseline.siteData?.fingerprint === optimized.result.siteData?.fingerprint
      && baseline.manifest?.seedOffset === optimized.result.manifest?.seedOffset
      && ["reservePct", "evDelayMin", "precoolHour"].every((key) => {
        const field = key as keyof OptimizeResponse["intervention"];
        return optimized.intervention[field] === optimized.result.intervention[field]
          && optimized.intervention[field] === search?.best?.intervention[field];
      });
    evidenceValid = searchValid && separated && cohortEvidence && shockEvidence && envelopeEvidence && rankEvidence && matchingInputs;
    assumptionsStable = shockEvidence && shocks.every((shock) => shock.passed)
      && !!envelope && envelope.passingCells === envelope.evaluatedCells;
    recommendationStable = cohortEvidence && cohorts.every((cohort) => cohort.passed) && assumptionsStable && validation.recommendationStable;
    rankStable = rankEvidence && !!rank && rank.topThreeCohorts === rank.cohortCount && rank.maxRiskRegretPct <= 1 && rank.stable;
  }

  const audited = !!assessment?.audited && (!optimized || !!baseline && assessRun(baseline, targetPct).audited);
  const regressionFree = selectedSampleAdditionalFailures === 0 && introducedFailures === 0 && shockIntroducedFailures === 0 && stressRegressionCells === 0;
  const withinTarget = !!result && !stale && targetValid && audited && !!assessment?.withinTarget
    && (!optimized || evidenceValid && targetMetCohorts === holdouts.length && recommendationStable && rankStable && regressionFree);

  let status: "awaiting" | "stale" | "integrity" | "evidence" | "regression" | "above" | "unresolved" | "stability" | "supported" = "awaiting";
  let label = "Awaiting first run";
  let summary = "Assess the upper 95% risk bound after a run. Optimization adds independent holdout and stability checks.";
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
        ? `${targetMetCohorts}/${holdouts.length} independent holdouts have an upper 95% risk bound within ${targetPct}%. A low selected-preset result cannot clear the remaining holdouts.`
        : "The upper 95% sampling bound exceeds your target. Zero observed failures is not zero risk; inspect failures or gather more evidence.";
    } else if (optimized && (!recommendationStable || !rankStable)) {
      status = "stability"; label = "Stability review";
      summary = "The risk bounds meet the target, but the policy did not retain its evidence or shortlist stability across tested settings.";
    } else {
      status = "supported"; label = optimized ? "Holdout target supported" : "Within selected sample target";
      summary = optimized
        ? `All ${holdouts.length} holdout upper bounds meet ${targetPct}%, with stable policy checks and no introduced failures.`
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
