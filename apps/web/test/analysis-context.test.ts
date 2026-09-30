import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION } from "@verdant/sim";
import type { RunSummary } from "@verdant/protocol";
import { AnalysisGate, analysisInputKey, assessRun, changedRunInputs, criticalRiskInterval, inputIssues, inputsForRun, type AnalysisInputs } from "../src/lib/analysisContext";

const inputs: AnalysisInputs = { locationId: "jaipur", preset: "normal", config: { ...DEFAULT_CONFIG }, scenarioCount: 500, siteDataProfileId: "representative-model" };
const run: RunSummary = { runId: "test-run", n: 500, location: "jaipur", preset: "normal", config: { ...DEFAULT_CONFIG }, intervention: DEFAULT_INTERVENTION, counts: { safe: 500, moderate: 0, high: 0, critical: 0 }, causeCounts: {}, failures: [], createdAt: 1,
  audit: { status: "PASS", checks: [{ id: "check", label: "check", passed: true, value: "pass" }], maxEnergyBalanceErrorKWh: 0, energyBalanceErrorPct: 0 },
  manifest: { runFingerprint: "test", modelVersion: "test", engine: "test", horizonHours: 72, timestepMinutes: 15, seedOffset: 0, seedScheme: "test", scenarioCount: 500, calibrationFingerprint: "test", deterministicReplay: true },
};

describe("Analysis context and decision assessment", () => {
  it("matches a recorded snapshot exactly and detects population changes", () => {
    expect(analysisInputKey(inputsForRun(run))).toBe(analysisInputKey(inputs));
    expect(changedRunInputs(run, { ...inputs, scenarioCount: 2000 })).toEqual(["population"]);
  });
  it("detects every meaningful input class", () => {
    expect(changedRunInputs(run, { ...inputs, locationId: "miami", preset: "storm", config: { ...DEFAULT_CONFIG, hospitalKW: 700 }, siteDataProfileId: "measured" })).toEqual(["region", "hazard", "data source", "system configuration"]);
  });
  it("does not depend on object property insertion order", () => {
    expect(analysisInputKey({ ...inputs, config: Object.fromEntries(Object.entries(DEFAULT_CONFIG).reverse()) as typeof DEFAULT_CONFIG })).toBe(analysisInputKey(inputs));
  });
  it("rejects invalid physical inputs and fractional asset counts", () => {
    expect(inputIssues(inputs)).toEqual([]);
    expect(inputIssues({ ...inputs, config: { ...DEFAULT_CONFIG, batteryStartPct: 0, homesCount: 1.2 } })).toHaveLength(2);
    expect(inputIssues({ ...inputs, config: { ...DEFAULT_CONFIG, solarCapacityKW: NaN } }).length).toBeGreaterThan(0);
  });
  it("zero observed failures is not zero upper risk", () => {
    expect(criticalRiskInterval(0, 500)?.highPct).toBeGreaterThan(0.7);
    expect(assessRun(run, 0.1).withinTarget).toBe(false);
    expect(assessRun(run, 1).withinTarget).toBe(true);
  });
  it("never passes missing or failed integrity evidence", () => {
    expect(assessRun({ ...run, audit: undefined }, 5).withinTarget).toBe(false);
    expect(assessRun({ ...run, counts: { ...run.counts, safe: 499 } }, 5).withinTarget).toBe(false);
    expect(assessRun({ ...run, manifest: { ...run.manifest!, deterministicReplay: false } }, 5).withinTarget).toBe(false);
  });
  it("serializes operations and rejects stale responses including same context after reset", () => {
    const gate = new AnalysisGate();
    const first = gate.begin("A")!;
    expect(gate.begin("A")).toBeNull();
    expect(gate.accepts(first, "B")).toBe(false);
    gate.invalidate();
    const next = gate.begin("A")!;
    expect(gate.accepts(first, "A")).toBe(false);
    expect(gate.finish(first)).toBe(false);
    expect(gate.accepts(next, "A")).toBe(true);
    expect(gate.finish(next)).toBe(true);
  });
});
