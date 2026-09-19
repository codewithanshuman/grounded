import { describe, it, expect } from "vitest";
import { MicrogridConfig, Intervention, RunSummary, GrowthEvent, FOREST_GRID_SIZE, FOREST_CENTER } from "../src/index.js";

describe("protocol schemas", () => {
  it("accepts a well-formed microgrid config", () => {
    const parsed = MicrogridConfig.parse({
      solarCapacityKW: 600, batteryCapacityKWh: 2400, batteryStartPct: 81,
      hospitalKW: 180, homesCount: 420, avgHomeKW: 1.4, evCount: 60, evChargerKW: 7, gridMaxImportKW: 700,
    });
    expect(parsed.hospitalKW).toBe(180);
  });

  it("rejects an intervention with an out-of-range reserve percentage", () => {
    expect(() => Intervention.parse({ reservePct: 130, evDelayMin: 0, precoolHour: null })).toThrow();
  });

  it("round-trips a full run summary", () => {
    const summary = RunSummary.parse({
      runId: "r1", n: 100, location: "jaipur", preset: "storm",
      config: { solarCapacityKW: 1, batteryCapacityKWh: 1, batteryStartPct: 1, hospitalKW: 1, homesCount: 1, avgHomeKW: 1, evCount: 1, evChargerKW: 1, gridMaxImportKW: 1 },
      intervention: { reservePct: 0, evDelayMin: 0, precoolHour: null },
      counts: { safe: 90, moderate: 5, high: 3, critical: 2 },
      causeCounts: { "Grid outage": 2 },
      failures: [],
      createdAt: Date.now(),
    });
    expect(summary.counts.critical).toBe(2);
  });

  it("validates a growth event referencing a tree", () => {
    const event = GrowthEvent.parse({
      kind: "tree.planted", runId: "r1", message: "grew",
      tree: { id: "t1", gx: 1, gy: 1, species: "oak", plantedAt: Date.now(), runId: "r1" },
    });
    expect(event.tree?.species).toBe("oak");
  });

  it("keeps the forest centre inside the grid bounds", () => {
    expect(FOREST_CENTER).toBeGreaterThan(0);
    expect(FOREST_CENTER).toBeLessThan(FOREST_GRID_SIZE);
  });
});
