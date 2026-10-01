import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openWorld, spiralCell, World, WORLD_SCHEMA_VERSION } from "../src/index.js";
import { assessOptimizationGrowth } from "@verdant/sim/growth";
import { growthBaseline, growthEvidence } from "../../sim/test/growthFixtures.js";

function fullReport(evidence = growthEvidence()) {
  return { ...evidence, growthEvents: [], historicalBacktest: { periods: 12, futures: 288, beforeCritical: 40, afterCritical: 0,
    passedPeriods: 12, source: "NASA_POWER", label: "Synthetic test fixture, not field evidence" } };
}

describe("spiralCell", () => {
  it("never repeats a cell for the first 200 indices", () => {
    const cells = Array.from({ length: 200 }, (_, index) => { const cell = spiralCell(index); return `${cell.gx},${cell.gy}`; });
    expect(new Set(cells).size).toBe(200);
  });
});

describe("Durable evidence growth", () => {
  let dir: string, world: World;
  const openTmp = () => { dir = mkdtempSync(join(tmpdir(), "grounded-world-")); world = openWorld(join(dir, "forest.db")); };
  afterEach(() => { world.close(); rmSync(dir, { recursive: true, force: true }); });

  it("plants one audited tree and deduplicates it after restart", () => {
    openTmp();
    const baseline = growthBaseline();
    expect(world.recordRun(baseline).map((event) => event.kind)).toEqual(["tree.planted"]);
    expect(world.recordRun(baseline)).toEqual([]);
    world.close(); world = openWorld(join(dir, "forest.db"));
    expect(world.recordRun(baseline)).toEqual([]);
    expect(world.getRun(baseline.runId)).toEqual(baseline);
    expect(world.getState()).toMatchObject({ totalRuns: 1, totalFuturesSimulated: 500, buildings: [] });
  });
  it("does not award solar halls or watchtowers from ordinary safe or fifth runs", () => {
    openTmp();
    for (let index = 0; index < 5; index++) world.recordRun(growthBaseline(0, `run-${index}`));
    expect(world.getState().trees).toHaveLength(5);
    expect(world.getState().buildings).toEqual([]);
  });
  it("missing or failed audits never earn world growth", () => {
    openTmp();
    world.recordRun({ ...growthBaseline(), audit: undefined });
    world.recordRun({ ...growthBaseline(), manifest: { ...growthBaseline().manifest!, deterministicReplay: false } });
    expect(world.getState().totalRuns).toBe(0);
  });
  it("selected-sample 100% improvement without full validation earns no building", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before);
    expect(world.recordOptimization(before.runId, before, evidence.result)).toEqual([]);
    expect(world.getState().bestImprovementPct).toBe(0);
  });
  it("earns a pending choice only after full proof retention, including after reopen", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before);
    world.recordRun(before);
    expect(assessOptimizationGrowth(before, evidence.result, evidence, 5).eligible).toBe(true);
    expect(world.recordOptimization(before.runId, before, evidence.result, evidence, 5)).toEqual([]);
    world.saveOptimization(before.runId, fullReport(evidence));
    const events = world.recordOptimization(before.runId, before, evidence.result, evidence, 5);
    expect(events.map((event) => event.kind)).toEqual(["milestone.earned"]);
    expect(events[0].pendingMilestone?.family).toBe("resilience");
    expect(events[0].message).toContain("Not field validation");
    expect(events[0].message).toContain(before.runId);
    world.close(); world = openWorld(join(dir, "forest.db"));
    expect(world.recordOptimization(before.runId, before, evidence.result, evidence, 5)).toEqual([]);
    expect(world.getState().buildings).toHaveLength(0);
    expect(world.getState().pendingMilestones).toHaveLength(1);
    expect(world.getState().bestImprovementPct).toBe(100);
  });
  it("retains historical proof by exact result even after a later baseline search", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before);
    world.recordRun(before); world.saveOptimization(before.runId, fullReport(evidence));
    const events = world.recordOptimization(before.runId, before, evidence.result, evidence, 5);
    const milestone = events[0]!.pendingMilestone!;
    const later = growthEvidence(before); later.result.runId = "later-result";
    world.saveOptimization(before.runId, fullReport(later));
    expect(world.getOptimization(before.runId)?.result.runId).toBe("later-result");
    expect(world.getOptimizationByResult(evidence.result.runId)?.optimization.result.runId).toBe(evidence.result.runId);
    world.close(); world = openWorld(join(dir, "forest.db"));
    const request = { milestoneId: milestone.id, variantId: "resilience-community-hall", plotId: "resilience-2", rotation: 270 as const };
    const placed = world.placeMilestone(request);
    expect(placed.growthEvents[0]?.kind).toBe("building.grown");
    expect(placed.world.buildings[0]).toMatchObject({ milestoneId: milestone.id, proof: milestone.proof, rotation: 270 });
    expect(placed.world.pendingMilestones).toEqual([]);
    world.close(); world = openWorld(join(dir, "forest.db"));
    expect(world.placeMilestone(request).growthEvents).toEqual([]);
    expect(world.getState().buildings).toHaveLength(1);
    expect(() => world.placeMilestone({ ...request, plotId: "resilience-1" })).toThrow("different design");
  });
  it("rejects immutable run/proof overwrites and leaves the original readable", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before);
    world.recordRun(before); world.saveOptimization(before.runId, fullReport(evidence));
    expect(() => world.saveRun({ ...before, preset: "heatwave" })).toThrow("immutable run");
    const altered = fullReport(evidence); altered.validation = { ...evidence.validation, recommendationStable: false };
    expect(() => world.saveOptimization(before.runId, altered)).toThrow("immutable optimized-result");
    expect(world.getRun(before.runId)).toEqual(before);
    expect(world.getOptimizationByResult(evidence.result.runId)?.optimization.validation.recommendationStable).toBe(true);
  });
  it("compares retained proof by content across schema key ordering and rejects substituted result content", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before);
    world.recordRun(before); world.saveOptimization(before.runId, fullReport(evidence));
    const reorder = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).reverse()) as T;
    const substituted = { ...evidence.result, causeCounts: { "Substituted report": 1 } };
    expect(world.recordOptimization(before.runId, reorder(before), substituted, evidence, 5)).toEqual([]);
    expect(world.getState().pendingMilestones ?? []).toEqual([]);
    expect(world.recordOptimization(before.runId, reorder(before), reorder(evidence.result), evidence, 5).map((event) => event.kind)).toEqual(["milestone.earned"]);
  });
  it("refuses placement when exact full proof is missing, without mutating the world", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before);
    world.recordRun(before); world.saveOptimization(before.runId, fullReport(evidence));
    world.recordOptimization(before.runId, before, evidence.result, evidence);
    const snapshot = world.getState();
    const db = new DatabaseSync(join(dir, "forest.db"));
    db.prepare("DELETE FROM optimization_proofs WHERE resultRunId = ?").run(evidence.result.runId); db.close();
    expect(() => world.placeMilestone({ milestoneId: snapshot.pendingMilestones![0]!.id, variantId: "resilience-watchtower", plotId: "resilience-1", rotation: 0 })).toThrow("immutable evidence is missing");
    expect(world.getState()).toEqual(snapshot);
  });
  it("refuses target failure, regressions, corrupt cluster metadata and weak paired support", () => {
    openTmp();
    const before = growthBaseline();
    world.recordRun(before);
    const unresolved = growthEvidence(before, 1);
    unresolved.result.runId = "unresolved-target";
    world.saveOptimization(before.runId, fullReport(unresolved));
    expect(world.recordOptimization(before.runId, before, unresolved.result, unresolved, 1)).toEqual([]);
    const regression = growthEvidence(before);
    regression.result.runId = "regression-proof";
    regression.validation.shockResults[0] = { label: regression.validation.shockResults[0].label, beforeCritical: 20, afterCritical: 1,
      preventedFailures: 20, introducedFailures: 1, improvementPct: 95, passed: true };
    world.saveOptimization(before.runId, fullReport(regression));
    expect(world.recordOptimization(before.runId, before, regression.result, regression, 5)).toEqual([]);
    const corrupt = growthEvidence(before);
    corrupt.result.runId = "corrupt-cluster-proof";
    corrupt.validation.cohorts[0].clusterUncertainty.upperCriticalRiskPct = 0;
    world.saveOptimization(before.runId, fullReport(corrupt));
    expect(world.recordOptimization(before.runId, before, corrupt.result, corrupt, 5)).toEqual([]);
    const weak = growthEvidence(before);
    weak.result.runId = "weak-support-proof";
    weak.validation.cohorts[0].preventedFailureClusters = 5;
    weak.validation.cohorts[0].pairedClusterPValue = 0.0625;
    weak.validation.statisticallyResolvedCohorts = 2;
    world.saveOptimization(before.runId, fullReport(weak));
    expect(world.recordOptimization(before.runId, before, weak.result, weak, 5)).toEqual([]);
    expect(world.getState().buildings).toEqual([]);
    expect(world.getState().bestImprovementPct).toBe(0);
  });
  it("retains full unresolved optimization evidence and reads it after reopen", () => {
    openTmp();
    const before = growthBaseline(), evidence = growthEvidence(before, 1);
    world.recordRun(before);
    const report = { ...evidence, growthEvents: [], historicalBacktest: { periods: 12, futures: 288, beforeCritical: 40, afterCritical: 0,
      passedPeriods: 12, source: "NASA_POWER", label: "Modeled operational replay" } };
    world.saveOptimization(before.runId, report);
    world.close(); world = openWorld(join(dir, "forest.db"));
    expect(world.getOptimization(before.runId)?.validation.cohorts).toEqual(report.validation.cohorts);
    expect(world.getState().buildings).toEqual([]);
  });
  it("runtime parses saved records instead of trusting corrupt JSON", () => {
    openTmp();
    world.recordRun(growthBaseline());
    const external = new DatabaseSync(join(dir, "forest.db"));
    external.prepare("UPDATE runs SET summaryJson = ? WHERE id = ?").run('{"bad":true}', "baseline");
    expect(world.getRun("baseline")).toBeUndefined();
    expect((external.prepare("PRAGMA user_version").get() as { user_version: number }).user_version).toBe(WORLD_SCHEMA_VERSION);
    external.close();
  });
});
