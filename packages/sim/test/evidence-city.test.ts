import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SiteDataProfile, type WorldState } from "@verdant/protocol";
import measuredReference from "../../../data/ausgrid-measured-reference.json";
import { CITY_PLOTS, CITY_VARIANTS, legacyEvidencePlot } from "@verdant/protocol/city";
import { applyMilestonePlacement, cityIdentity, earnEvidenceMilestones, eligibleCityPlots, summarizeCityProof, verifyMilestoneEvidence } from "../src/evidenceCity.js";
import { criticalRiskInterval } from "../src/decisionReadiness.js";
import { summarizeSeedClusters } from "../src/index.js";
import { growthBaseline, growthEvidence } from "./growthFixtures.js";

// Deliberately synthetic gate fixtures; these tests are not reported as measured
// facility evidence or inserted into a user's world.
const empty = (): WorldState => ({ trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0 });
const context = () => { let index = 0; return { id: () => `city-${++index}`, now: () => 10 }; };
function fixture() {
  const before = growthBaseline(), evidence = growthEvidence(before);
  const intervention = { reservePct: 30, evDelayMin: 30, precoolHour: 12 };
  evidence.intervention = { ...intervention }; evidence.result.intervention = { ...intervention };
  evidence.analysis.best.intervention = { ...intervention };
  return { before, evidence };
}
function improveHoldouts(evidence: ReturnType<typeof growthEvidence>, sampleSize: number) {
  evidence.validation.cohorts.forEach((cohort, index) => {
    cohort.seedOffset = 20_000 + index * 2_000;
    cohort.sampleSize = sampleSize;
    cohort.beforeCriticalPct = Math.round(40 / sampleSize * 1000) / 10;
    cohort.pairedNetBenefitPct = 40 / sampleSize * 100;
    cohort.afterWilsonHighPct = criticalRiskInterval(0, sampleSize)!.highPct;
    cohort.pairedClusterSampleSize = sampleSize / 5;
    cohort.clusterUncertainty = summarizeSeedClusters(Array.from({ length: sampleSize / 5 }, (_, i) => ({ seedIndex: cohort.seedOffset + i, evaluationCount: 5, criticalCount: 0 })), 5);
    evidence.validation.decisionStability.cohorts[index]!.seedOffset = cohort.seedOffset;
  });
}

describe("Evidence City identity and proof binding", () => {
  it("uses portable SHA-256 with deterministic codepoint key ordering", () => {
    const canonical = '{"Z":1,"a":["हिन्दी",null,{"x":true}],"z":3}';
    expect(cityIdentity({ z: 3, a: ["हिन्दी", null, { x: true }], Z: 1, absent: undefined }))
      .toBe(createHash("sha256").update(canonical).digest("hex"));
    expect(cityIdentity("a".repeat(150))).toBe(createHash("sha256").update(JSON.stringify("a".repeat(150))).digest("hex"));
    expect(cityIdentity({ b: 2, a: 1 })).toBe(cityIdentity({ a: 1, b: 2 }));
  });
  it("ignores transport IDs for anti-grinding identity but binds exact IDs in the certificate", () => {
    const { before, evidence } = fixture();
    const original = summarizeCityProof(before, evidence, 5);
    const repeat = structuredClone(evidence); repeat.result.runId = "new-transport-result"; repeat.result.createdAt++;
    const repeated = summarizeCityProof({ ...before, runId: "new-transport-baseline", createdAt: 50 }, repeat, 5);
    expect(repeated.proofIdentity).toBe(original.proofIdentity);
    expect(repeated.resultRunId).not.toBe(original.resultRunId);
    repeat.validation.cohorts[0]!.label = "Different holdout";
    expect(summarizeCityProof(before, repeat, 5).proofIdentity).not.toBe(original.proofIdentity);
  });
  it("binds actual source content when a declared source fingerprint is reused", () => {
    const { before, evidence } = fixture();
    before.siteData = SiteDataProfile.parse(measuredReference);
    const original = summarizeCityProof(before, evidence, 5);
    const altered = structuredClone(before);
    altered.siteData!.demand.multiplier15m[0]! += 0.1;
    expect(altered.siteData!.fingerprint).toBe(before.siteData.fingerprint);
    expect(summarizeCityProof(altered, evidence, 5).sourceContextKey).not.toBe(original.sourceContextKey);
  });
  it("earns category choices from validated combined policy, never auto-constructs", () => {
    const { before, evidence } = fixture();
    const result = earnEvidenceMilestones(empty(), before, evidence, context(), 5);
    expect(result.verdict.eligible).toBe(true);
    expect(result.world.buildings).toEqual([]);
    expect(result.world.pendingMilestones?.map((m) => m.family).sort()).toEqual(["flexibility", "resilience", "storage"]);
    expect(result.events.every((event) => event.kind === "milestone.earned")).toBe(true);
    for (const milestone of result.world.pendingMilestones!) expect(verifyMilestoneEvidence(milestone, before, evidence)).toBe(true);
  });
  it("refuses altered sources, reports and category entitlement", () => {
    const before = growthBaseline(), evidence = growthEvidence(before);
    const milestone = earnEvidenceMilestones(empty(), before, evidence, context()).world.pendingMilestones![0]!;
    expect(verifyMilestoneEvidence({ ...milestone, family: "storage" }, before, evidence)).toBe(false);
    expect(verifyMilestoneEvidence(milestone, { ...before, runId: "another" }, evidence)).toBe(false);
    const corrupt = structuredClone(evidence); corrupt.validation.cohorts[0]!.pairedClusterPValue = 0;
    expect(verifyMilestoneEvidence(milestone, before, corrupt)).toBe(false);
    const differentTrace = structuredClone(evidence);
    differentTrace.result.causeCounts = { "Altered cause attribution": 1 };
    expect(verifyMilestoneEvidence(milestone, before, differentTrace)).toBe(false);
    const differentFingerprint = structuredClone(evidence);
    differentFingerprint.result.manifest!.runFingerprint = "substituted-report";
    expect(verifyMilestoneEvidence(milestone, before, differentFingerprint)).toBe(false);
  });
  it("does not reward repeated evidence under new run IDs or relaxed targets", () => {
    const { before, evidence } = fixture(), ctx = context();
    const first = earnEvidenceMilestones(empty(), before, evidence, ctx).world;
    const repeat = structuredClone(evidence); repeat.result.runId = "repeat-result";
    expect(earnEvidenceMilestones(first, { ...before, runId: "repeat-baseline" }, repeat, ctx).events).toEqual([]);
    const relaxed = structuredClone(evidence); relaxed.analysis.riskTargetPct = relaxed.validation.riskTargetPct = 10;
    expect(earnEvidenceMilestones(first, before, relaxed, ctx, 10).events).toEqual([]);
  });
});

describe("Evidence City constrained construction", () => {
  it("offers exactly three authored choices and three separated seats for each family", () => {
    for (const family of ["storage", "flexibility", "resilience"] as const) {
      expect(CITY_VARIANTS.filter((variant) => variant.family === family)).toHaveLength(3);
      expect(CITY_PLOTS.filter((plot) => (plot.families as readonly string[]).includes(family))).toHaveLength(3);
    }
    expect(new Set(CITY_PLOTS.map((plot) => `${plot.gx}:${plot.gy}`)).size).toBe(9);
  });
  it("constructs the requested design on a legal plot, then safely deduplicates", () => {
    const { before, evidence } = fixture(), ctx = context();
    const world = earnEvidenceMilestones(empty(), before, evidence, ctx).world;
    const milestone = world.pendingMilestones!.find((m) => m.family === "storage")!;
    const request = { milestoneId: milestone.id, variantId: "storage-control-hall", plotId: "storage-2", rotation: 90 as const };
    const placed = applyMilestonePlacement(world, request, before, evidence, ctx);
    expect(placed.world.buildings[0]).toMatchObject({ variantId: request.variantId, plotId: request.plotId, rotation: 90, level: 1, gx: 5, gy: 1, proof: milestone.proof });
    expect(placed.world.pendingMilestones).toHaveLength(2);
    expect(placed.events[0]?.kind).toBe("building.grown");
    expect(applyMilestonePlacement(placed.world, request, before, evidence, ctx)).toEqual({ world: placed.world, events: [] });
    expect(() => applyMilestonePlacement(placed.world, { ...request, rotation: 180 }, before, evidence, ctx)).toThrow("different design");
  });
  it("rejects foreign variants, water/arbitrary coordinates, invalid rotations and forged proofs", () => {
    const { before, evidence } = fixture(), ctx = context();
    const world = earnEvidenceMilestones(empty(), before, evidence, ctx).world;
    const request = { milestoneId: world.pendingMilestones!.find((m) => m.family === "storage")!.id, variantId: "storage-control-hall", plotId: "storage-2", rotation: 0 as const };
    expect(() => applyMilestonePlacement(world, { ...request, variantId: "resilience-watchtower" }, before, evidence, ctx)).toThrow("family");
    expect(() => applyMilestonePlacement(world, { ...request, plotId: "water-1", gx: 99, gy: 99 }, before, evidence, ctx)).toThrow("eligible land");
    expect(() => applyMilestonePlacement(world, { ...request, rotation: 45 as never }, before, evidence, ctx)).toThrow();
    const corrupt = structuredClone(evidence); corrupt.validation.cohorts[0]!.pairedClusterPValue = 0;
    expect(() => applyMilestonePlacement(world, request, before, corrupt, ctx)).toThrow("immutable model proof");
    expect(() => applyMilestonePlacement(world, request, { ...before, manifest: { ...before.manifest!, modelVersion: "old" } }, evidence, ctx)).toThrow("earlier model");
  });
  it("retains legacy building seats even when legacy stored gx/gy meant forest coordinates", () => {
    const { before, evidence } = fixture(), ctx = context();
    const world = earnEvidenceMilestones({ ...empty(), buildings: [{ id: "legacy", gx: 12, gy: 12, kind: "watchtower", grownAt: 1, runId: "old", milestone: "Legacy" }] }, before, evidence, ctx).world;
    expect(legacyEvidencePlot(0)).toEqual([1, 1]);
    const milestone = world.pendingMilestones!.find((m) => m.family === "storage")!;
    expect(eligibleCityPlots(world, milestone.id).map((plot) => plot.id)).not.toContain("storage-1");
    expect(() => applyMilestonePlacement(world, { milestoneId: milestone.id, variantId: "storage-control-hall", plotId: "storage-1", rotation: 0 }, before, evidence, ctx)).toThrow("occupied");
  });
  it("uses canonical authored seats for registered occupancy and legacy seats for malformed metadata", () => {
    const { before, evidence } = fixture(), ctx = context();
    const earned = earnEvidenceMilestones(empty(), before, evidence, ctx).world;
    const storage = earned.pendingMilestones!.find((milestone) => milestone.family === "storage")!;
    const placed = applyMilestonePlacement(earned, { milestoneId: storage.id, variantId: "storage-control-hall", plotId: "storage-2", rotation: 0 }, before, evidence, ctx).world;
    const duplicate = { ...storage, id: "duplicate-category" };
    const challenger = { ...placed, pendingMilestones: [duplicate], buildings: placed.buildings.map((building) => ({ ...building, gx: 99, gy: 99 })) };
    // Existing-category upgrades must stay on plot 2 even if saved gx/gy drift.
    const upgrade = { ...duplicate, level: 2 };
    expect(eligibleCityPlots({ ...challenger, pendingMilestones: [upgrade] }, upgrade.id).map((plot) => plot.id)).toEqual(["storage-2"]);
    // Even a duplicate registered building in a stale snapshot occupies its
    // authored seat; its forged raw coordinates cannot free the plot.
    const collision = { ...challenger, pendingMilestones: [upgrade], buildings: [...challenger.buildings,
      { ...challenger.buildings[0]!, id: "other-building", milestoneId: "other-proof" }] };
    expect(eligibleCityPlots(collision, upgrade.id)).toEqual([]);
    const malformed = { ...earned, buildings: [{ ...placed.buildings[0]!, family: "resilience" as const, gx: 99, gy: 99 }] };
    expect(eligibleCityPlots(malformed, storage.id).map((plot) => plot.id)).not.toContain("storage-1");
  });
  it("upgrades in place only with strictly stronger same-context proof, capped at level 3", () => {
    const before = growthBaseline(), evidence = growthEvidence(before), ctx = context();
    let world = earnEvidenceMilestones(empty(), before, evidence, ctx).world;
    const build = (report: typeof evidence) => {
      const milestone = world.pendingMilestones![0]!;
      world = applyMilestonePlacement(world, { milestoneId: milestone.id, variantId: "resilience-watchtower", plotId: "resilience-1", rotation: 0 }, before, report, ctx).world;
    };
    build(evidence);
    const buildingId = world.buildings[0]!.id;
    const stronger = structuredClone(evidence); stronger.result.runId = "level-2"; improveHoldouts(stronger, 600);
    const second = earnEvidenceMilestones(world, before, stronger, ctx);
    expect(second.verdict.eligible, second.verdict.reasons.join(" ")).toBe(true);
    world = second.world;
    expect(world.pendingMilestones![0]!.level).toBe(2);
    expect(() => applyMilestonePlacement(world, { milestoneId: world.pendingMilestones![0]!.id, variantId: "resilience-watchtower", plotId: "resilience-2", rotation: 0 }, before, stronger, ctx)).toThrow("existing category building and plot");
    build(stronger);
    expect(world.buildings[0]).toMatchObject({ id: buildingId, level: 2 });
    const strongest = structuredClone(evidence); strongest.result.runId = "level-3"; improveHoldouts(strongest, 900);
    world = earnEvidenceMilestones(world, before, strongest, ctx).world; build(strongest);
    expect(world.buildings[0]).toMatchObject({ id: buildingId, level: 3 });
    const extra = structuredClone(evidence); extra.result.runId = "level-4"; improveHoldouts(extra, 1200);
    expect(earnEvidenceMilestones(world, before, extra, ctx).events).toEqual([]);
  });
});
