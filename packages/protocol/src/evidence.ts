import { z } from "zod";
import { Intervention, GrowthEvent, RunSummary } from "./index.js";

// Runtime contracts for complete evidence, including failed/unresolved decisions.
// Storage integrity is not an authority signature or field certification.
const finite = z.number().finite();
const count = finite.int().nonnegative();
const pct = finite.min(0).max(100);
const clusterUncertainty = z.object({
  method: z.literal("seed-cluster-any-failure-exact-binomial"), confidenceLevel: z.literal(0.95),
  boundType: z.literal("one-sided"), evaluationCount: count.positive(), hazardCount: count.positive(),
  clusterCount: count.positive(), criticalClusterCount: count, criticalEvaluationCount: count,
  incompleteClusterCount: count, observedCriticalPct: pct, upperCriticalRiskPct: pct,
  clusters: z.object({ seedIndex: count, evaluationCount: count.positive(), criticalCount: count }).array().nonempty(),
});
const candidate = z.object({
  intervention: Intervention, criticalCount: count, highCount: count,
  disruptionScore: finite.nonnegative(), riskPct: pct, resilienceScore: finite,
  meanUnservedKWh: finite.nonnegative(), meanOperationalCost: finite,
  meanCarbonKg: finite,
  clusterUncertainty,
}).passthrough();
const cohort = z.object({
  label: z.string(), seedOffset: count, sampleSize: count.positive(),
  beforeCriticalPct: pct, afterCriticalPct: pct, improvementPct: finite,
  preventedFailures: count, introducedFailures: count, persistentFailures: count,
  pairedNetBenefitPct: finite, pairedPValue: finite.min(0).max(1),
  afterWilsonHighPct: pct, passed: z.boolean(),
  clusterUncertainty, pairedClusterSampleSize: count.positive(),
  preventedFailureClusters: count, introducedFailureClusters: count,
  persistentFailureClusters: count, pairedClusterPValue: finite.min(0).max(1), targetMet: z.boolean(),
}).passthrough();
const shock = z.object({
  label: z.string(), beforeCritical: count, afterCritical: count,
  preventedFailures: count, introducedFailures: count, improvementPct: finite,
  passed: z.boolean(),
}).passthrough();
export const OptimizationEvidence = z.object({
  intervention: Intervention,
  result: RunSummary,
  growthEvents: GrowthEvent.array(),
  analysis: z.object({
    best: candidate, evaluatedStrategies: count.positive(), sampleSize: count.positive(),
    seedOffset: count, hazardCount: count.positive(), frontier: candidate.array(),
    selectionReason: z.string(),
    riskTargetPct: finite.positive().max(100), feasibleStrategyCount: count,
    discoveryOnly: z.literal(true),
    selectionMode: z.enum(["TARGET_FEASIBLE_MINIMAL_DISRUPTION", "TARGET_UNRESOLVED_RISK_FIRST"]),
  }).passthrough(),
  validation: z.object({
    cohortCount: count, passedCohorts: count, recommendationStable: z.boolean(),
    cohorts: cohort.array(), benchmarks: z.object({
      label: z.string(), criticalPct: pct, meanUnservedKWh: finite.nonnegative(),
      meanOperationalCost: finite, meanCarbonKg: finite,
    }).array(),
    worstCaseImprovementPct: finite, assumptionShocks: z.string().array(),
    shockResults: shock.array(), zeroRegressionCohorts: count,
    statisticallyResolvedCohorts: count,
    riskTargetPct: finite.positive().max(100),
    jointStressEnvelope: z.object({
      dimensions: z.string().array(), evaluatedCells: count.positive(),
      sampleSizePerCell: count.positive(), passingCells: count,
      zeroRegressionCells: count, minimumImprovementPct: finite,
      worstCell: shock.extend({ residualCriticalPct: pct }),
    }),
    decisionStability: z.object({
      candidateCount: count.positive(), cohortCount: count, firstPlaceCohorts: count,
      topThreeCohorts: count, meanRank: finite, maxRiskRegretPct: finite.nonnegative(),
      stable: z.boolean(), cohorts: z.object({
        label: z.string(), seedOffset: count, candidateCount: count.positive(),
        recommendedRank: count.positive(), winnerLabel: z.string(),
        recommendedRiskPct: pct, bestRiskPct: pct, riskRegretPct: finite.nonnegative(),
        targetMet: z.boolean(), selectionMode: z.enum(["TARGET_FEASIBLE_MINIMAL_DISRUPTION", "TARGET_UNRESOLVED_RISK_FIRST"]),
      }).array(),
    }),
  }).passthrough(),
  historicalBacktest: z.object({
    periods: count, futures: count, beforeCritical: count, afterCritical: count,
    passedPeriods: count, source: z.string(), label: z.string(),
  }),
}).passthrough();

export interface StoredEvidence {
  schemaVersion: 1; recordId: string; ownerScope: string; savedAt: number;
  modelVersion: string; riskTargetPct: number; baseline: RunSummary;
  optimization: z.infer<typeof OptimizationEvidence> | null;
}
export const StoredEvidence: z.ZodType<StoredEvidence, z.ZodTypeDef, unknown> = z.object({
  schemaVersion: z.literal(1), recordId: z.string().uuid(), ownerScope: z.string().min(1),
  savedAt: finite.nonnegative(), modelVersion: z.string().min(1),
  riskTargetPct: finite.positive().max(100), baseline: RunSummary,
  optimization: OptimizationEvidence.nullable(),
});
export interface EvidenceEnvelope { payload: StoredEvidence; sha256: string; checksumFormat?: "CODEPOINT_V1" }
export const EvidenceEnvelope: z.ZodType<EvidenceEnvelope, z.ZodTypeDef, unknown> = z.object({
  payload: StoredEvidence,
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  checksumFormat: z.literal("CODEPOINT_V1").optional(),
});
