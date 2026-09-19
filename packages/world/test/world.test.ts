import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openWorld, spiralCell, World } from "../src/index.js";
import type { RunSummary } from "@verdant/protocol";

function makeSummary(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runId: "run-1",
    n: 1000,
    location: "jaipur",
    preset: "normal",
    config: {
      solarCapacityKW: 600, batteryCapacityKWh: 2400, batteryStartPct: 81,
      hospitalKW: 180, homesCount: 420, avgHomeKW: 1.4, evCount: 60, evChargerKW: 7, gridMaxImportKW: 700,
    },
    intervention: { reservePct: 0, evDelayMin: 0, precoolHour: null },
    counts: { safe: 950, moderate: 40, high: 8, critical: 2 },
    causeCounts: { "Grid outage": 6, "Heat-driven demand": 4 },
    failures: [],
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("spiralCell", () => {
  it("never repeats a cell for the first 200 indices", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const { gx, gy } = spiralCell(i);
      const key = `${gx},${gy}`;
      expect(seen.has(key)).toBe(false);
      seen.add(key);
    }
  });
});

describe("World", () => {
  let dir: string;
  let world: World;
  const openTmp = () => {
    dir = mkdtempSync(join(tmpdir(), "verdant-world-"));
    world = openWorld(join(dir, "forest.db"));
  };
  afterEach(() => {
    world.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("plants exactly one tree per recorded run and persists it", () => {
    openTmp();
    const events = world.recordRun(makeSummary());
    expect(events.filter((e) => e.kind === "tree.planted")).toHaveLength(1);
    expect(world.getState().trees).toHaveLength(1);
    expect(world.getState().totalRuns).toBe(1);
  });

  it("persists the complete evidence summary across a server-style reopen", () => {
    openTmp();
    const summary = makeSummary({ runId: "durable-run" });
    const path = join(dir, "forest.db");
    world.recordRun(summary);
    world.close();
    world = openWorld(path);
    expect(world.getRun("durable-run")?.counts).toEqual(summary.counts);
    expect(world.getRun("durable-run")?.config.hospitalKW).toBe(180);
  });

  it("grows a watchtower on every fifth run, without losing earlier trees", () => {
    openTmp();
    for (let i = 0; i < 5; i++) world.recordRun(makeSummary({ runId: `run-${i}` }));
    const state = world.getState();
    expect(state.trees).toHaveLength(5);
    expect(state.buildings.some((b) => b.kind === "watchtower")).toBe(true);
  });

  it("only grows a reservoir once the optimizer fully eliminates failures", () => {
    openTmp();
    const before = makeSummary({ counts: { safe: 900, moderate: 60, high: 13, critical: 27 } });
    const partialAfter = makeSummary({ counts: { safe: 950, moderate: 45, high: 4, critical: 1 } });
    const fullAfter = makeSummary({ counts: { safe: 970, moderate: 30, high: 0, critical: 0 } });

    const partialEvents = world.recordOptimization("run-1", before, partialAfter);
    expect(partialEvents.some((e) => e.building?.kind === "reservoir")).toBe(false);

    const fullEvents = world.recordOptimization("run-1", before, fullAfter);
    expect(fullEvents.some((e) => e.building?.kind === "reservoir")).toBe(true);
  });

  it("never grows a building from an optimization that made things worse", () => {
    openTmp();
    const before = makeSummary({ counts: { safe: 990, moderate: 8, high: 1, critical: 1 } });
    const worse = makeSummary({ counts: { safe: 900, moderate: 60, high: 20, critical: 20 } });
    const events = world.recordOptimization("run-1", before, worse);
    expect(events.filter((e) => e.kind === "building.grown")).toHaveLength(0);
  });
});
