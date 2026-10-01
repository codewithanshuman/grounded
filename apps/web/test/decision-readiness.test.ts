import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { RunSummary } from "@verdant/protocol";
import type { OptimizerValidation } from "@verdant/sim";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION } from "@verdant/sim";
import type { OptimizeResponse } from "../src/ws/client";
import { growthEvidence } from "../../../packages/sim/test/growthFixtures";
import { summarizeSeedClusters, exactMcNemarPValue } from "@verdant/sim";
import { criticalRiskInterval } from "../src/lib/analysisContext";
import { assessDecisionReadiness } from "../src/lib/decisionReadiness";
import { DecisionWorkspace } from "../src/hud/DecisionWorkspace";

const baseline = (): RunSummary => ({
  runId: "baseline", n: 500, location: "jaipur", preset: "normal", config: { ...DEFAULT_CONFIG }, intervention: DEFAULT_INTERVENTION,
  counts: { safe: 500, moderate: 0, high: 0, critical: 0 }, causeCounts: {}, failures: [], createdAt: 1,
  audit: { status: "PASS", checks: [{ id: "conservation", label: "Conservation", passed: true, value: "pass" }], maxEnergyBalanceErrorKWh: 0, energyBalanceErrorPct: 0 },
  manifest: { runFingerprint: "run", modelVersion: "test", engine: "test", horizonHours: 72, timestepMinutes: 15,
    seedOffset: 0, seedScheme: "test", scenarioCount: 500, calibrationFingerprint: "climate", deterministicReplay: true },
});

const response = (targetPct = 5): OptimizeResponse => ({ ...growthEvidence(baseline(), targetPct), growthEvents: [],
  historicalBacktest: { periods: 12, futures: 288, beforeCritical: 0, afterCritical: 0, passedPeriods: 12, source: "NASA_POWER", label: "Modeled replay" } });

function withHoldoutFailures(data: OptimizeResponse, index: number, persistent: number, introduced = 0, prevented = 0) {
  const cohort = data.validation.cohorts[index];
  const failures = persistent + introduced;
  Object.assign(cohort, { persistentFailures: persistent, introducedFailures: introduced, preventedFailures: prevented,
    beforeCriticalPct: Math.round((persistent + prevented) / cohort.sampleSize * 1000) / 10,
    afterCriticalPct: Math.round(failures / cohort.sampleSize * 1000) / 10,
    afterWilsonHighPct: criticalRiskInterval(failures, cohort.sampleSize)!.highPct,
    passed: introduced <= prevented });
  cohort.clusterUncertainty = summarizeSeedClusters(Array.from({ length: cohort.sampleSize / 5 }, (_, offset) => ({
    seedIndex: cohort.seedOffset + offset, evaluationCount: 5, criticalCount: offset < failures ? 1 : 0 })), 5);
  Object.assign(cohort, { preventedFailureClusters: Math.ceil(prevented / 5), introducedFailureClusters: introduced, persistentFailureClusters: persistent,
    pairedClusterPValue: exactMcNemarPValue(Math.ceil(prevented / 5), introduced),
    targetMet: cohort.clusterUncertainty.upperCriticalRiskPct <= data.validation.riskTargetPct });
  data.validation.statisticallyResolvedCohorts = data.validation.cohorts.filter((item) => item.pairedClusterPValue < 0.05).length;
  data.validation.decisionStability.cohorts[index].targetMet = cohort.targetMet;
  data.validation.decisionStability.cohorts[index].selectionMode = cohort.targetMet ? "TARGET_FEASIBLE_MINIMAL_DISRUPTION" : "TARGET_UNRESOLVED_RISK_FIRST";
  data.validation.decisionStability.stable = data.validation.decisionStability.cohorts.every((item) => item.targetMet);
  data.validation.passedCohorts = data.validation.cohorts.filter((item) => item.passed).length;
  data.validation.zeroRegressionCohorts = data.validation.cohorts.filter((item) => item.introducedFailures === 0).length;
}

describe("Decision planning readiness", () => {
  it("keeps an audited baseline target explicitly selected-sample-only", () => {
    const readiness = assessDecisionReadiness(baseline(), null, 1);
    expect(readiness.withinTarget).toBe(true);
    expect(readiness.label).toBe("Within selected sample target");
    expect(readiness.summary).toContain("Independent mixed-hazard validation has not yet been performed");
  });
  it("zero selected-sample failures cannot clear underpowered holdouts", () => {
    const readiness = assessDecisionReadiness(baseline(), response(1), 1);
    expect(readiness.assessment!.withinTarget).toBe(true);
    expect(readiness.evidenceValid).toBe(true);
    expect(readiness.targetMetCohorts).toBe(0);
    expect(readiness.withinTarget).toBe(false);
    expect(readiness.status).toBe("unresolved");
    expect(readiness.holdouts.every((cohort) => cohort.interval!.highPct > 4.8)).toBe(true);
  });
  it("supports a target only when all independent bounds and stability checks pass", () => {
    const readiness = assessDecisionReadiness(baseline(), response(), 5);
    expect(readiness.evidenceValid).toBe(true);
    expect(readiness.withinTarget).toBe(true);
    expect(readiness.label).toBe("Holdout target supported");
    expect(readiness.summary).toContain("stable policy checks and no introduced failures");
  });
  it("does not pool cohorts to hide a single holdout above target", () => {
    const data = response();
    withHoldoutFailures(data, 1, 1);
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.targetMetCohorts).toBe(2);
    expect(readiness.withinTarget).toBe(false);
    expect(readiness.status).toBe("unresolved");
    expect(readiness.summary).toContain("2/3 independent holdouts");
  });
  it("uses integer transition counts and unrounded upper bounds at a threshold", () => {
    const upper = response().validation.cohorts[0].clusterUncertainty.upperCriticalRiskPct;
    expect(assessDecisionReadiness(baseline(), response(upper - 0.000001), upper - 0.000001).withinTarget).toBe(false);
    expect(assessDecisionReadiness(baseline(), response(upper), upper).withinTarget).toBe(true);
  });
  it("flags introduced failures even when paired aggregate improvement passes", () => {
    const data = response();
    withHoldoutFailures(data, 0, 0, 1, 2);
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(true);
    expect(readiness.recommendationStable).toBe(true);
    expect(readiness.status).toBe("regression");
    expect(readiness.introducedFailures).toBe(1);
    expect(readiness.withinTarget).toBe(false);
  });
  it("does not hide a net selected-hazard regression behind passing holdouts", () => {
    const data = response();
    data.result.counts = { ...data.result.counts, safe: 499, critical: 1 };
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(true);
    expect(readiness.targetMetCohorts).toBe(3);
    expect(readiness.selectedSampleAdditionalFailures).toBe(1);
    expect(readiness.status).toBe("regression");
    expect(readiness.withinTarget).toBe(false);
    expect(readiness.reasons.join(" ")).toContain("net count, not a paired transition total");
  });
  it("flags assumption introductions and stress-cell regressions separately", () => {
    const data = response();
    Object.assign(data.validation.shockResults[0], { beforeCritical: 2, afterCritical: 1, preventedFailures: 2, introducedFailures: 1 });
    data.validation.jointStressEnvelope.zeroRegressionCells = 80;
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.status).toBe("regression");
    expect(readiness.shockIntroducedFailures).toBe(1);
    expect(readiness.stressRegressionCells).toBe(1);
    expect(readiness.reasons.join(" ")).toContain("not a unique-future count");
  });
  it("requires shortlist rank stability even if risk targets pass", () => {
    const data = response();
    const rank = data.validation.decisionStability;
    Object.assign(rank.cohorts[0], { recommendedRank: 4, riskRegretPct: 2 });
    Object.assign(rank, { stable: false, firstPlaceCohorts: 2, topThreeCohorts: 2, meanRank: 2, maxRiskRegretPct: 2 });
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(true);
    expect(readiness.targetMetCohorts).toBe(3);
    expect(readiness.status).toBe("stability");
    expect(readiness.withinTarget).toBe(false);
  });
  it("rejects a truncated passing stress envelope instead of treating it as the full factorial", () => {
    const data = response();
    Object.assign(data.validation.jointStressEnvelope, { evaluatedCells: 1, passingCells: 1, zeroRegressionCells: 1 });
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(false);
    expect(readiness.withinTarget).toBe(false);
    expect(readiness.status).toBe("evidence");
  });
  it("requires the declared assumption shock identities, not any four unique labels", () => {
    const data = response();
    data.validation.shockResults[0].label = "Unrelated stress";
    data.validation.assumptionShocks[0] = "Unrelated stress";
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(false);
    expect(readiness.withinTarget).toBe(false);
    expect(readiness.status).toBe("evidence");
  });
  it.each([
    ["Restoration time", "Community demand", "Solar capacity"],
    ["Restoration time", "Community demand", "Solar capacity", "Solar capacity"],
    ["Restoration time", "Community demand", "Solar capacity", "Unrelated dimension"],
  ])("rejects missing, duplicate, or substituted stress dimensions: %j", (...dimensions) => {
    const data = response();
    data.validation.jointStressEnvelope.dimensions = dimensions;
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(false);
    expect(readiness.withinTarget).toBe(false);
  });
  it("retains target evidence but never approves stale configuration", () => {
    const readiness = assessDecisionReadiness(baseline(), response(), 5, true);
    expect(readiness.targetMetCohorts).toBe(3);
    expect(readiness.status).toBe("stale");
    expect(readiness.withinTarget).toBe(false);
    expect(readiness.summary).toContain("earlier inputs");
  });
  it.each(["cohort overlap", "search overlap", "missing shocks", "wrong counts", "changed inputs", "false rank summary", "impossible shock transitions", "missing stress cell", "missing rank cohorts", "wrong policy", "different comparison seeds"])("rejects inconsistent evidence: %s", (kind) => {
    const data = response();
    if (kind === "cohort overlap") data.validation.cohorts[1].seedOffset = data.validation.cohorts[0].seedOffset + 1;
    if (kind === "search overlap") data.validation.cohorts[0].seedOffset = data.analysis.seedOffset;
    if (kind === "missing shocks") data.validation.shockResults = [];
    if (kind === "wrong counts") data.validation.cohorts[0].persistentFailures = 201;
    if (kind === "changed inputs") data.result.config = { ...DEFAULT_CONFIG, homesCount: DEFAULT_CONFIG.homesCount + 1 };
    if (kind === "false rank summary") data.validation.decisionStability.topThreeCohorts = 2;
    if (kind === "impossible shock transitions") Object.assign(data.validation.shockResults[0], { beforeCritical: 200, afterCritical: 200, preventedFailures: 200, introducedFailures: 200 });
    if (kind === "missing stress cell") data.validation.jointStressEnvelope.worstCell = undefined as unknown as OptimizerValidation["jointStressEnvelope"]["worstCell"];
    if (kind === "missing rank cohorts") data.validation.decisionStability.cohorts = undefined as unknown as OptimizerValidation["decisionStability"]["cohorts"];
    if (kind === "wrong policy") data.result.intervention = { ...DEFAULT_INTERVENTION, reservePct: DEFAULT_INTERVENTION.reservePct + 5 };
    if (kind === "different comparison seeds") data.result.manifest!.seedOffset = 1;
    const readiness = assessDecisionReadiness(baseline(), data, 5);
    expect(readiness.evidenceValid).toBe(false);
    expect(readiness.status).toBe("evidence");
    expect(readiness.withinTarget).toBe(false);
  });
  it("requires baseline and optimized replay integrity", () => {
    const data = response();
    data.result.manifest!.deterministicReplay = false;
    expect(assessDecisionReadiness(baseline(), data, 5).status).toBe("integrity");
    const before = baseline();
    before.audit = undefined;
    expect(assessDecisionReadiness(before, response(), 5).status).toBe("integrity");
  });
  it("rejects a nondefault baseline because independent validation uses the no-intervention policy", () => {
    const before = baseline();
    before.intervention = { ...DEFAULT_INTERVENTION, reservePct: 25 };
    expect(assessDecisionReadiness(before, response(), 5).evidenceValid).toBe(false);
    expect(assessDecisionReadiness(before, response(), 5).withinTarget).toBe(false);
  });
  it("rejects contradictory stress-cell regression evidence", () => {
    const data=response();
    Object.assign(data.validation.jointStressEnvelope.worstCell,{beforeCritical:1,afterCritical:1,preventedFailures:1,introducedFailures:1,residualCriticalPct:100/60,passed:true});
    expect(assessDecisionReadiness(baseline(),data,5).evidenceValid).toBe(false);
  });
  it("rejects a changed operational data fingerprint behind the same profile ID", () => {
    const before=baseline(), data=response();
    before.siteData={id:"same-profile",fingerprint:"original"} as RunSummary["siteData"];
    data.result.siteData={id:"same-profile",fingerprint:"changed"} as RunSummary["siteData"];
    expect(assessDecisionReadiness(before,data,5).evidenceValid).toBe(false);
  });
  it("renders the compact target status with progressive evidence and honest scope", () => {
    const html = renderToStaticMarkup(createElement(DecisionWorkspace, { baseline: baseline(), optimized: response(1), targetPct: 1, stale: false, busy: false,
      onTargetChange() {}, onRun() {}, onRisk() {}, onStrategy() {}, onProof() {}, onMethod() {} }));
    expect(html).toContain("Target not resolved");
    expect(html).toContain("Holdouts meeting target");
    expect(html).toContain("<details");
    expect(html).not.toContain("<details open");
    expect(html).toContain("not simultaneous guarantees");
    expect(html).toContain("seed-cluster");
    expect(html).not.toContain("Within sample target");
  });
});
