import { FOREST_CENTER, FOREST_GRID_SIZE, type Building, type GrowthEvent, type RunSummary, type TreeSpecies, type WorldState } from "@verdant/protocol";
import { assessDecisionReadiness, assessRun, type OptimizationEvidence } from "./decisionReadiness.js";
import { exactMcNemarPValue } from "./index.js";
import { cityIdentity, earnEvidenceMilestones } from "./evidenceCity.js";

export const DEFAULT_GROWTH_RISK_TARGET_PCT = 5;
export type GrowthContext = { id: () => string; now: () => number };

/** World growth records computational work; it never certifies a real facility. */
export function spiralCell(index: number): { gx: number; gy: number } {
  let x = 0, y = 0, dx = 0, dy = -1;
  for (let i = 0; i < FOREST_GRID_SIZE * FOREST_GRID_SIZE; i++) {
    if (i === index) break;
    if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) { const next = dx; dx = -dy; dy = next; }
    x += dx; y += dy;
  }
  return { gx: Math.min(FOREST_GRID_SIZE - 1, Math.max(0, Math.round(FOREST_CENTER + x))),
    gy: Math.min(FOREST_GRID_SIZE - 1, Math.max(0, Math.round(FOREST_CENTER + y))) };
}

function speciesForRun(summary: RunSummary): TreeSpecies {
  const safeRatio = (summary.counts.safe + summary.counts.moderate) / Math.max(1, summary.n);
  return safeRatio >= 0.97 ? "ancient" : safeRatio >= 0.85 ? "flowering" : safeRatio >= 0.6 ? "oak" : "sapling";
}

export function runGrowthEligible(summary: RunSummary): boolean {
  try { return assessRun(summary, 100).audited; } catch { return false; }
}

export function applyRunGrowth(world: WorldState, summary: RunSummary, context: GrowthContext) {
  if (!runGrowthEligible(summary) || world.trees.some((tree) => tree.runId === summary.runId)) return { world, events: [] as GrowthEvent[] };
  const tree = { id: context.id(), ...spiralCell(world.trees.length + world.buildings.length), species: speciesForRun(summary),
    plantedAt: context.now(), runId: summary.runId };
  const event: GrowthEvent = { kind: "tree.planted", runId: summary.runId, tree,
    message: `An audited ${summary.n.toLocaleString()}-future simulation planted a ${tree.species} tree. This records model work, not real-world planting.` };
  return { world: { ...world, trees: [...world.trees, tree], totalRuns: world.totalRuns + 1,
    totalFuturesSimulated: world.totalFuturesSimulated + summary.n }, events: [event] };
}

export function assessOptimizationGrowth(before: RunSummary, after: RunSummary, evidence?: OptimizationEvidence | null,
  targetPct = DEFAULT_GROWTH_RISK_TARGET_PCT) {
  const improvementPct = before.counts.critical > 0 ? (1 - after.counts.critical / before.counts.critical) * 100 : 0;
  let readiness: ReturnType<typeof assessDecisionReadiness> | null = null;
  let pairedSupport = false;
  let pairedEvidenceValid = false;
  const reasons: string[] = [];
  try {
    if (!evidence || cityIdentity(evidence.result) !== cityIdentity(after)) reasons.push("The optimization evidence does not identify this exact result.");
    else {
      readiness = assessDecisionReadiness(before, evidence, targetPct);
      const cohorts = evidence.validation.cohorts;
      // A confidence gate cannot pool repeated hazards sharing a seed. Paired
      // improvement evidence uses the independent seed-cluster transitions.
      pairedEvidenceValid = cohorts.length >= 3 && cohorts.every((cohort) => {
        const c = cohort as typeof cohort & { preventedFailureClusters?: number; introducedFailureClusters?: number;
          persistentFailureClusters?: number; pairedClusterSampleSize?: number; pairedClusterPValue?: number };
        const values = [c.preventedFailureClusters, c.introducedFailureClusters, c.persistentFailureClusters, c.pairedClusterSampleSize];
        if (!values.every((value) => Number.isInteger(value) && value! >= 0) || !c.pairedClusterSampleSize
          || c.preventedFailureClusters! + c.introducedFailureClusters! + c.persistentFailureClusters! > c.pairedClusterSampleSize!) return false;
        // Eligibility below requires zero introductions, so exact two-sided
        // McNemar is 2*(1/2)^prevented; no normal approximation or pooled p.
        const expected = exactMcNemarPValue(c.preventedFailureClusters!, c.introducedFailureClusters!);
        return c.introducedFailureClusters === 0 && Number.isFinite(c.pairedClusterPValue)
          && Math.abs(c.pairedClusterPValue! - expected) <= 1e-12;
      });
      pairedSupport = pairedEvidenceValid && cohorts.every((cohort) =>
        (cohort as typeof cohort & { pairedClusterPValue: number }).pairedClusterPValue < 0.05)
        && evidence.validation.statisticallyResolvedCohorts === cohorts.length;
      if (!readiness.withinTarget) reasons.push(readiness.summary, ...readiness.reasons);
      if (!pairedEvidenceValid) reasons.push("Independent paired seed-cluster counts and exact McNemar evidence need integrity review.");
      else if (!pairedSupport) reasons.push("The improvement is not statistically resolved in every independent seed-cluster holdout.");
    }
  } catch { reasons.push("Optimization evidence is incomplete or malformed."); }
  if (before.counts.critical <= 0 || !(improvementPct > 0)) reasons.push("No reduction from a nonzero baseline critical-failure sample was demonstrated.");
  const eligible = !!readiness?.withinTarget && pairedSupport && improvementPct > 0 && before.counts.critical > 0 && reasons.length === 0;
  const kind: Building["kind"] | null = eligible ? after.counts.critical === 0 ? "reservoir" : "resilienceHall" : null;
  const milestone = eligible
    ? `Model evidence milestone: ${Math.round(improvementPct)}% fewer selected-sample critical failures; all ${readiness!.holdouts.length} independent seed-cluster holdouts support the ${targetPct}% planning target and paired improvement, with audited replay, zero introduced failures and stable stress/shortlist checks. Baseline ${before.runId}; result ${after.runId}. Not field validation or a reliability guarantee.`
    : null;
  return { eligible, targetPct, improvementPct, readiness, pairedEvidenceValid, pairedSupport, kind, milestone, reasons,
    baselineRunId: before.runId, optimizedRunId: after.runId };
}

/** Identical browser/server transition; persistence belongs to the caller. */
export function applyOptimizationGrowth(world: WorldState, before: RunSummary, after: RunSummary, evidence: OptimizationEvidence | null | undefined,
  context: GrowthContext, targetPct = DEFAULT_GROWTH_RISK_TARGET_PCT) {
  const verdict = assessOptimizationGrowth(before, after, evidence, targetPct);
  if (!verdict.eligible || !evidence) return { world, events: [] as GrowthEvent[], verdict };
  return earnEvidenceMilestones(world, before, evidence, context, targetPct);
}
