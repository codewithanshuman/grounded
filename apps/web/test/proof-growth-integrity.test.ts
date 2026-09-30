import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { RunSummary, WorldState } from "@verdant/protocol";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION } from "@verdant/sim";
import { ComparePanel } from "../src/hud/Panels";
import type { OptimizeResponse } from "../src/ws/client";

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

  it("awards a qualifying baseline only once, including restored world state", () => {
    const before = summary(100), after = summary(0, "after");
    expect(recordOptimization(before, after)).toHaveLength(1);
    expect(recordOptimization(before, summary(0, "second-search"))).toEqual([]);
    worker.onmessage?.({ data: { id: "snapshot", op: "init", args: {} } });
    const saved = worker.postMessage.mock.lastCall![0].result.world as WorldState;
    expect(saved.buildings).toHaveLength(1);
    worker.onmessage?.({ data: { id: "restore", op: "init", args: { world: saved } } });
    expect(recordOptimization(before, after)).toEqual([]);
  });
  it("rejects missing, failed, inconsistent, or non-replayable integrity evidence", () => {
    const before = summary(100), after = summary(0, "after");
    expect(recordOptimization({ ...before, audit: undefined }, after)).toEqual([]);
    expect(recordOptimization(before, { ...after, audit: { ...after.audit!, checks: [] } })).toEqual([]);
    expect(recordOptimization(before, { ...after, audit: { ...after.audit!, checks: [{ id: "failed", label: "failed", value: "fail", passed: false }] } })).toEqual([]);
    expect(recordOptimization(before, { ...after, counts: { ...after.counts, safe: 499 } })).toEqual([]);
    expect(recordOptimization(before, { ...after, manifest: { ...after.manifest!, deterministicReplay: false } })).toEqual([]);
    worker.onmessage?.({ data: { id: "snapshot", op: "init", args: {} } });
    expect(worker.postMessage.mock.lastCall![0].result.world).toEqual(emptyWorld());
  });
  it("does not round a sub-threshold improvement into a milestone", () => {
    expect(recordOptimization(summary(200), summary(21, "after"))).toEqual([]); // 89.5%, displayed as 90%.
    expect(recordOptimization(summary(200), summary(20, "qualified"))).toHaveLength(1);
  });
});
