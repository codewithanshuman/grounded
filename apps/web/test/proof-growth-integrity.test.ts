import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunSummary, WorldState } from "@verdant/protocol";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION } from "@verdant/sim";
import { ComparePanel } from "../src/hud/Panels";
import type { OptimizeResponse } from "../src/ws/client";
import { growthBaseline, growthEvidence } from "../../../packages/sim/test/growthFixtures";
import { assessOptimizationGrowth } from "@verdant/sim/growth";
import { openWorld } from "../../../packages/world/src/index";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const emptyWorld = (): WorldState => ({ trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0 });
const summary = (critical: number, runId = "baseline"): RunSummary => ({
  runId, n: 500, location: "jaipur", preset: "normal", config: { ...DEFAULT_CONFIG }, intervention: DEFAULT_INTERVENTION,
  counts: { safe: 500 - critical, moderate: 0, high: 0, critical }, causeCounts: {}, failures: [], createdAt: 1,
  audit: { status: "PASS", checks: [{ id: "check", label: "check", passed: true, value: "pass" }], maxEnergyBalanceErrorKWh: 0, energyBalanceErrorPct: 0 },
  manifest: { runFingerprint: runId, modelVersion: "test", engine: "test", horizonHours: 72, timestepMinutes: 15, seedOffset: 0, seedScheme: "test", scenarioCount: 500, calibrationFingerprint: "test", deterministicReplay: true },
});
const optimized = (critical: number): OptimizeResponse => ({
  result: summary(critical, "optimized"), intervention: DEFAULT_INTERVENTION, growthEvents: [],
  validation: { recommendationStable: false, cohorts: [{ preventedFailures: 0, introducedFailures: critical }] },
  historicalBacktest: { passedPeriods: 10, periods: 12, futures: 288, beforeCritical: 0, afterCritical: critical, source: "NASA_POWER", label: "Simulated operational replay" },
} as unknown as OptimizeResponse);

describe("Aggregate proof never hides an empty baseline failure sample", () => {
  it("discloses introduced failures even when there is no paired baseline trace", () => {
    const html = renderToStaticMarkup(createElement(ComparePanel, { baseline: summary(0), optimized: optimized(3) }));
    expect(html).toContain("3 additional critical failures");
    expect(html).toContain("NET ADDITIONAL FAILURES");
    expect(html).toContain("PAIRED HOLDOUTS");
    expect(html).toContain("REVIEW REQUIRED");
    expect(html).not.toContain("this configuration held");
  });
  it("retains uncertainty and holdout results when both samples have zero failures", () => {
    const html = renderToStaticMarkup(createElement(ComparePanel, { baseline: summary(0), optimized: optimized(0) }));
    expect(html).toContain("No critical failures observed in either sample");
    expect(html).toContain("95% RESIDUAL RISK");
    expect(html).toContain("not a field reliability guarantee");
    expect(html).toContain("No retained baseline failure trace");
  });
});

describe("Verified, idempotent world milestones", () => {
  const worker = { onmessage: null as null | ((event: { data: unknown }) => void), postMessage: vi.fn() };
  let recordOptimization: typeof import("../src/ws/static-engine.worker").recordOptimization;
  beforeAll(async () => {
    vi.stubGlobal("self", worker);
    ({ recordOptimization } = await import("../src/ws/static-engine.worker"));
  });
  beforeEach(() => worker.onmessage?.({ data: { id: "reset", op: "init", args: { world: emptyWorld() } } }));
  afterAll(() => vi.unstubAllGlobals());

  it("awards a supported baseline only once, including restored world state", () => {
    const before = growthBaseline(), evidence = growthEvidence(before), after = evidence.result;
    expect(recordOptimization(before, after, evidence, 5)).toHaveLength(1);
    const repeat = growthEvidence(before); repeat.result.runId = "second-search";
    expect(recordOptimization(before, repeat.result, repeat, 5)).toEqual([]);
    worker.onmessage?.({ data: { id: "snapshot", op: "init", args: {} } });
    const saved = worker.postMessage.mock.lastCall![0].result.world as WorldState;
    expect(saved.buildings).toHaveLength(0);
    expect(saved.pendingMilestones).toHaveLength(1);
    worker.onmessage?.({ data: { id: "restore", op: "init", args: { world: saved } } });
    expect(recordOptimization(before, after, evidence, 5)).toEqual([]);
  });
  it("rejects missing, failed, inconsistent, or non-replayable integrity evidence", () => {
    const before = growthBaseline(), evidence = growthEvidence(before), after = evidence.result;
    expect(recordOptimization({ ...before, audit: undefined }, after, evidence)).toEqual([]);
    expect(recordOptimization(before, { ...after, audit: { ...after.audit!, checks: [] } }, evidence)).toEqual([]);
    expect(recordOptimization(before, { ...after, audit: { ...after.audit!, checks: [{ id: "failed", label: "failed", value: "fail", passed: false }] } }, evidence)).toEqual([]);
    expect(recordOptimization(before, { ...after, counts: { ...after.counts, safe: 499 } }, evidence)).toEqual([]);
    expect(recordOptimization(before, { ...after, manifest: { ...after.manifest!, deterministicReplay: false } }, evidence)).toEqual([]);
    worker.onmessage?.({ data: { id: "snapshot", op: "init", args: {} } });
    expect(worker.postMessage.mock.lastCall![0].result.world).toEqual(emptyWorld());
  });
  it("does not confuse selected-sample improvement with independent target support", () => {
    const before = growthBaseline(), evidence = growthEvidence(before, 1);
    expect(recordOptimization(before, evidence.result)).toEqual([]);
    expect(recordOptimization(before, evidence.result, evidence, 1)).toEqual([]);
    expect(assessOptimizationGrowth(before, evidence.result, evidence, 1).reasons.join(" ")).toContain("seed-cluster risk upper bound");
  });
  it("requires paired cluster improvement support as well as non-regression", () => {
    const before = growthBaseline(), evidence = growthEvidence(before);
    evidence.validation.cohorts[0].preventedFailureClusters = 5;
    evidence.validation.cohorts[0].pairedClusterPValue = 0.0625;
    evidence.validation.statisticallyResolvedCohorts = 2;
    expect(recordOptimization(before, evidence.result, evidence, 5)).toEqual([]);
    expect(assessOptimizationGrowth(before, evidence.result, evidence, 5).reasons.join(" ")).toContain("not statistically resolved");
  });
  it("places only with the exact pinned full proof after a worker reload", () => {
    // Synthetic gate fixture exercises the real transport boundary. It is
    // never inserted into a browser session or described as facility evidence.
    const before = growthBaseline(), evidence = growthEvidence(before);
    const milestone = recordOptimization(before, evidence.result, evidence, 5)[0]!.pendingMilestone!;
    worker.onmessage?.({ data: { id: "snapshot", op: "init", args: {} } });
    const saved = worker.postMessage.mock.lastCall![0].result.world as WorldState;
    worker.onmessage?.({ data: { id: "reload", op: "init", args: { world: saved } } });
    const request = { milestoneId: milestone.id, variantId: "resilience-community-hall", plotId: "resilience-2", rotation: 90 };
    const invoke = (args: Record<string, unknown>) => {
      worker.onmessage?.({ data: { id: "place", op: "placeMilestone", args } });
      return worker.postMessage.mock.lastCall![0];
    };
    expect(invoke(request)).toMatchObject({ ok: false, error: expect.stringContaining("complete evidence") });
    const full = { ...evidence, growthEvents: [], historicalBacktest: { periods: 0, futures: 0,
      beforeCritical: 0, afterCritical: 0, passedPeriods: 0, source: "test", label: "Synthetic transport fixture" } };
    const altered = structuredClone(full); altered.result.causeCounts = { "Altered report": 1 };
    expect(invoke({ ...request, evidence: { baseline: before, optimization: altered } })).toMatchObject({ ok: false });
    worker.onmessage?.({ data: { id: "unchanged", op: "init", args: {} } });
    expect(worker.postMessage.mock.lastCall![0].result.world).toEqual(saved);
    const placed = invoke({ ...request, evidence: { baseline: before, optimization: full } });
    expect(placed).toMatchObject({ ok: true, result: { growthEvents: [{ kind: "building.grown" }],
      world: { pendingMilestones: [], buildings: [{ milestoneId: milestone.id, plotId: "resilience-2", rotation: 90 }] } } });
    worker.onmessage?.({ data: { id: "placement-reload", op: "init", args: { world: placed.result.world } } });
    expect(invoke({ ...request, evidence: { baseline: before, optimization: full } })).toMatchObject({ ok: true, result: { growthEvents: [] } });
  });
  it("has server/browser parity for qualifying and withheld milestones", () => {
    const dir = mkdtempSync(join(tmpdir(), "grounded-parity-")), server = openWorld(join(dir, "forest.db"));
    try {
      const before = growthBaseline(), evidence = growthEvidence(before);
      const browserEvents = recordOptimization(before, evidence.result, evidence, 5);
      server.saveRun(before);
      server.saveOptimization(before.runId, { ...evidence, growthEvents: [], historicalBacktest: { periods: 0, futures: 0,
        beforeCritical: 0, afterCritical: 0, passedPeriods: 0, source: "test", label: "Synthetic gate fixture" } });
      const serverEvents = server.recordOptimization(before.runId, before, evidence.result, evidence, 5);
      const semantic = (events: typeof browserEvents) => events.map((event) => ({ kind: event.kind, runId: event.runId,
        family: event.pendingMilestone?.family, proof: event.pendingMilestone?.proof,
        message: event.message, building: event.building && { gx: event.building.gx, gy: event.building.gy,
          kind: event.building.kind, runId: event.building.runId, milestone: event.building.milestone } }));
      expect(semantic(serverEvents)).toEqual(semantic(browserEvents));
      expect(server.recordOptimization(before.runId, before, evidence.result, evidence, 5)).toEqual([]);
      const unresolved = growthEvidence(growthBaseline(100, "other"), 1);
      expect(recordOptimization(growthBaseline(100, "other"), unresolved.result, unresolved, 1)).toEqual([]);
      expect(server.recordOptimization("other", growthBaseline(100, "other"), unresolved.result, unresolved, 1)).toEqual([]);
    } finally { server.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
