import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  FOREST_CENTER, FOREST_GRID_SIZE,
  type Building, type BuildingKind, type GrowthEvent, type RunSummary, type Tree, type TreeSpecies, type WorldState,
} from "@verdant/protocol";

/* ============================================================================
 * The Resilience Forest: VERDANT's answer to claude-clan-main's "buildings
 * grow as the codebase grows". Here, growth is earned by *doing the work* —
 * running a simulation plants a tree; proving a real fix (via the optimizer)
 * grows a building. Nothing here is decorative: every planting/growth call
 * below is triggered from apps/server right after a genuine simulation run,
 * never from a timer or from the UI alone.
 * ========================================================================== */

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS trees (
    id TEXT PRIMARY KEY, gx INTEGER, gy INTEGER, species TEXT,
    plantedAt INTEGER, runId TEXT
  );
  CREATE TABLE IF NOT EXISTS buildings (
    id TEXT PRIMARY KEY, gx INTEGER, gy INTEGER, kind TEXT,
    grownAt INTEGER, runId TEXT, milestone TEXT
  );
  CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY, value TEXT
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, summaryJson TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
`;

/** Square spiral outward from the forest's centre, so early growth clusters
 * densely and the forest visibly expands as more runs accumulate. */
export function spiralCell(index: number): { gx: number; gy: number } {
  let x = 0, y = 0, dx = 0, dy = -1;
  const maxI = FOREST_GRID_SIZE * FOREST_GRID_SIZE;
  for (let i = 0; i < maxI; i++) {
    if (i === index) break;
    if (x === y || (x < 0 && x === -y) || (x > 0 && x === 1 - y)) { const t = dx; dx = -dy; dy = t; }
    x += dx; y += dy;
  }
  const gx = Math.round(FOREST_CENTER + x);
  const gy = Math.round(FOREST_CENTER + y);
  return {
    gx: Math.min(FOREST_GRID_SIZE - 1, Math.max(0, gx)),
    gy: Math.min(FOREST_GRID_SIZE - 1, Math.max(0, gy)),
  };
}

function speciesForRun(summary: RunSummary): TreeSpecies {
  const safeRatio = (summary.counts.safe + summary.counts.moderate) / Math.max(1, summary.n);
  if (safeRatio >= 0.97) return "ancient";
  if (safeRatio >= 0.85) return "flowering";
  if (safeRatio >= 0.6) return "oak";
  return "sapling";
}

export class World {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(SCHEMA);
  }

  private getMeta(key: string, fallback: number): number {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? Number(row.value) : fallback;
  }
  private setMeta(key: string, value: number): void {
    this.db.prepare("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, String(value));
  }

  getState(): WorldState {
    const trees = this.db.prepare("SELECT * FROM trees ORDER BY plantedAt ASC").all() as unknown as Tree[];
    const buildings = this.db.prepare("SELECT * FROM buildings ORDER BY grownAt ASC").all() as unknown as Building[];
    return {
      trees,
      buildings,
      totalRuns: this.getMeta("totalRuns", 0),
      totalFuturesSimulated: this.getMeta("totalFuturesSimulated", 0),
      bestImprovementPct: this.getMeta("bestImprovementPct", 0),
    };
  }

  saveRun(summary: RunSummary): void {
    this.db.prepare("INSERT INTO runs (id, summaryJson, createdAt) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET summaryJson = excluded.summaryJson, createdAt = excluded.createdAt")
      .run(summary.runId, JSON.stringify(summary), summary.createdAt);
  }

  getRun(runId: string): RunSummary | undefined {
    const row = this.db.prepare("SELECT summaryJson FROM runs WHERE id = ?").get(runId) as { summaryJson: string } | undefined;
    if (!row) return undefined;
    try {
      return JSON.parse(row.summaryJson) as RunSummary;
    } catch {
      return undefined;
    }
  }

  private nextCellIndex(): number {
    const trees = this.db.prepare("SELECT COUNT(*) as c FROM trees").get() as { c: number };
    const buildings = this.db.prepare("SELECT COUNT(*) as c FROM buildings").get() as { c: number };
    return trees.c + buildings.c;
  }

  /** Every completed Monte Carlo run plants exactly one tree — running the
   * simulation, on its own, is the thing that grows the forest. */
  recordRun(summary: RunSummary): GrowthEvent[] {
    this.saveRun(summary);
    const events: GrowthEvent[] = [];
    const { gx, gy } = spiralCell(this.nextCellIndex());
    const tree: Tree = {
      id: randomUUID(), gx, gy, species: speciesForRun(summary), plantedAt: Date.now(), runId: summary.runId,
    };
    this.db.prepare("INSERT INTO trees (id, gx, gy, species, plantedAt, runId) VALUES (?, ?, ?, ?, ?, ?)")
      .run(tree.id, tree.gx, tree.gy, tree.species, tree.plantedAt, tree.runId);

    const totalRuns = this.getMeta("totalRuns", 0) + 1;
    this.setMeta("totalRuns", totalRuns);
    this.setMeta("totalFuturesSimulated", this.getMeta("totalFuturesSimulated", 0) + summary.n);

    events.push({ kind: "tree.planted", runId: summary.runId, tree, message: `A ${tree.species} tree took root from a ${summary.n.toLocaleString()}-future run.` });

    const safeRatio = (summary.counts.safe + summary.counts.moderate) / Math.max(1, summary.n);
    if (safeRatio >= 0.98) {
      const b = this.growBuilding(summary.runId, "solarHall", `Exceptionally resilient design: ${(safeRatio * 100).toFixed(1)}% of futures stayed safe.`);
      events.push({ kind: "building.grown", runId: summary.runId, building: b, message: b.milestone });
    }
    if (totalRuns % 5 === 0) {
      const b = this.growBuilding(summary.runId, "watchtower", `${totalRuns} simulation runs completed — a watchtower rises to mark the milestone.`);
      events.push({ kind: "building.grown", runId: summary.runId, building: b, message: b.milestone });
    }
    return events;
  }

  /** Called after the optimizer both proposes AND the improved plan has been
   * validated by re-running the full population — a building only grows once
   * the fix is actually demonstrated, never on the strength of the proposal
   * alone. */
  recordOptimization(runId: string, before: RunSummary, after: RunSummary): GrowthEvent[] {
    this.saveRun(after);
    const events: GrowthEvent[] = [];
    const improvementPct = before.counts.critical > 0
      ? Math.round((1 - after.counts.critical / before.counts.critical) * 100)
      : after.counts.critical === 0 ? 0 : -100;

    if (improvementPct > this.getMeta("bestImprovementPct", 0)) this.setMeta("bestImprovementPct", improvementPct);

    if (before.counts.critical > 0 && after.counts.critical === 0) {
      const b = this.growBuilding(runId, "reservoir", `Full resilience achieved: ${before.counts.critical.toLocaleString()} failures eliminated across ${after.n.toLocaleString()} futures.`);
      events.push({ kind: "building.grown", runId, building: b, message: b.milestone });
    } else if (improvementPct >= 90) {
      const b = this.growBuilding(runId, "resilienceHall", `${improvementPct}% of critical failures eliminated by the recommended intervention.`);
      events.push({ kind: "building.grown", runId, building: b, message: b.milestone });
    }
    return events;
  }

  private growBuilding(runId: string, kind: BuildingKind, milestone: string): Building {
    const { gx, gy } = spiralCell(this.nextCellIndex());
    const building: Building = { id: randomUUID(), gx, gy, kind, grownAt: Date.now(), runId, milestone };
    this.db.prepare("INSERT INTO buildings (id, gx, gy, kind, grownAt, runId, milestone) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(building.id, building.gx, building.gy, building.kind, building.grownAt, building.runId, building.milestone);
    return building;
  }

  close(): void {
    this.db.close();
  }
}

export function openWorld(path: string): World {
  return new World(path);
}
