import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { type Building, type GrowthEvent, type RunSummary, type Tree, type WorldState } from "@verdant/protocol";
import { RunSummary as RunSummarySchema, WorldState as WorldStateSchema } from "@verdant/protocol";
import { OptimizationEvidence as OptimizationEvidenceSchema } from "@verdant/protocol/evidence";
import { applyOptimizationGrowth, applyRunGrowth, runGrowthEligible } from "@verdant/sim/growth";
import type { OptimizationEvidence } from "@verdant/sim/decisionReadiness";
import { PlacementRequest, EvidenceMilestone, type PlacementRequest as PlaceRequest } from "@verdant/protocol/city";
import { applyMilestonePlacement, cityIdentity } from "@verdant/sim/evidenceCity";
export { spiralCell } from "@verdant/sim/growth";

/** Durable evidence ledger. Trees record audited simulations; buildings require
 * the shared holdout, target, paired-improvement and stability verdict. Neither
 * object certifies field reliability or real-world environmental impact. */

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
  CREATE TABLE IF NOT EXISTS growth_receipts (
    eventType TEXT NOT NULL, runId TEXT NOT NULL, PRIMARY KEY(eventType, runId)
  );
  CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY, summaryJson TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS optimizations (
    baselineRunId TEXT PRIMARY KEY, evidenceJson TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS optimization_proofs (
    resultRunId TEXT PRIMARY KEY, baselineRunId TEXT NOT NULL, evidenceJson TEXT NOT NULL, createdAt INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS city_milestones (id TEXT PRIMARY KEY, family TEXT NOT NULL, detailJson TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS city_proof_receipts (proofIdentity TEXT PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS building_details (id TEXT PRIMARY KEY, detailJson TEXT NOT NULL);
`;

/** v1 adds growth receipts; v2 adds full optimization reports; v3 adds
 * immutable result proof history and earned city choices. Legacy tables remain. */
export const WORLD_SCHEMA_VERSION = 3;

export class World {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    const version = this.db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version > WORLD_SCHEMA_VERSION) {
      this.db.close();
      throw new Error("This world database was written by a newer schema. No migration or overwrite was performed.");
    }
    this.db.exec(SCHEMA);
    // Keep old full reports as immutable proof history during additive migration.
    if (version.user_version < 3) {
      const reports = this.db.prepare("SELECT baselineRunId, evidenceJson, createdAt FROM optimizations").all() as { baselineRunId: string; evidenceJson: string; createdAt: number }[];
      for (const row of reports) {
        try {
          const report = OptimizationEvidenceSchema.parse(JSON.parse(row.evidenceJson));
          this.db.prepare("INSERT OR IGNORE INTO optimization_proofs VALUES (?, ?, ?, ?)").run(report.result.runId, row.baselineRunId, row.evidenceJson, row.createdAt);
        } catch { /* Legacy/corrupt evidence is retained, never granted a milestone. */ }
      }
    }
    if (version.user_version < WORLD_SCHEMA_VERSION) this.db.exec(`PRAGMA user_version = ${WORLD_SCHEMA_VERSION}`);
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
    const rows = this.db.prepare("SELECT * FROM buildings ORDER BY grownAt ASC").all() as unknown as Building[];
    const buildings = rows.map((row) => {
      const detail = this.db.prepare("SELECT detailJson FROM building_details WHERE id = ?").get(row.id) as { detailJson: string } | undefined;
      return detail ? { ...row, ...JSON.parse(detail.detailJson) } : row;
    });
    const pendingMilestones = (this.db.prepare("SELECT detailJson FROM city_milestones ORDER BY rowid").all() as { detailJson: string }[])
      .map((row) => EvidenceMilestone.parse(JSON.parse(row.detailJson)));
    const cityProofReceipts = (this.db.prepare("SELECT proofIdentity FROM city_proof_receipts ORDER BY rowid").all() as { proofIdentity: string }[]).map((row) => row.proofIdentity);
    return WorldStateSchema.parse({
      trees,
      buildings,
      totalRuns: this.getMeta("totalRuns", 0),
      totalFuturesSimulated: this.getMeta("totalFuturesSimulated", 0),
      bestImprovementPct: this.getMeta("bestImprovementPct", 0),
      ...(pendingMilestones.length || cityProofReceipts.length ? { pendingMilestones, cityProofReceipts } : {}),
    });
  }

  saveRun(summary: RunSummary): void {
    const validated = RunSummarySchema.parse(summary);
    const previous = this.getRun(validated.runId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(validated)) throw new Error("An immutable run identifier cannot be overwritten with different evidence.");
    this.db.prepare("INSERT INTO runs (id, summaryJson, createdAt) VALUES (?, ?, ?) ON CONFLICT(id) DO NOTHING")
      .run(validated.runId, JSON.stringify(validated), validated.createdAt);
  }

  getRun(runId: string): RunSummary | undefined {
    const row = this.db.prepare("SELECT summaryJson FROM runs WHERE id = ?").get(runId) as { summaryJson: string } | undefined;
    if (!row) return undefined;
    try {
      return RunSummarySchema.parse(JSON.parse(row.summaryJson));
    } catch {
      return undefined;
    }
  }

  saveOptimization(baselineRunId: string, report: unknown): void {
    if (!this.getRun(baselineRunId)) throw new Error("Cannot save an optimization without its retained baseline evidence.");
    const evidence = OptimizationEvidenceSchema.parse(report);
    this.saveRun(evidence.result);
    const previous = this.getOptimizationByResult(evidence.result.runId);
    const decisionCore = (item: typeof evidence) => cityIdentity({ ...item, growthEvents: [], growthAssessment: undefined, world: undefined });
    if (previous && (previous.baselineRunId !== baselineRunId || decisionCore(previous.optimization) !== decisionCore(evidence))) {
      throw new Error("An immutable optimized-result identifier cannot be overwritten with different proof.");
    }
    this.db.prepare("INSERT INTO optimization_proofs (resultRunId, baselineRunId, evidenceJson, createdAt) VALUES (?, ?, ?, ?) ON CONFLICT(resultRunId) DO NOTHING")
      .run(evidence.result.runId, baselineRunId, JSON.stringify(evidence), Date.now());
    this.db.prepare("INSERT INTO optimizations (baselineRunId, evidenceJson, createdAt) VALUES (?, ?, ?) ON CONFLICT(baselineRunId) DO UPDATE SET evidenceJson = excluded.evidenceJson, createdAt = excluded.createdAt")
      .run(baselineRunId, JSON.stringify(evidence), Date.now());
  }

  getOptimizationByResult(resultRunId: string): { baselineRunId: string; optimization: ReturnType<typeof OptimizationEvidenceSchema.parse> } | undefined {
    const row = this.db.prepare("SELECT baselineRunId, evidenceJson FROM optimization_proofs WHERE resultRunId = ?").get(resultRunId) as { baselineRunId: string; evidenceJson: string } | undefined;
    if (!row) return undefined;
    try { return { baselineRunId: row.baselineRunId, optimization: OptimizationEvidenceSchema.parse(JSON.parse(row.evidenceJson)) }; } catch { return undefined; }
  }

  getOptimization(baselineRunId: string): ReturnType<typeof OptimizationEvidenceSchema.parse> | undefined {
    const row = this.db.prepare("SELECT evidenceJson FROM optimizations WHERE baselineRunId = ?").get(baselineRunId) as { evidenceJson: string } | undefined;
    if (!row) return undefined;
    try { return OptimizationEvidenceSchema.parse(JSON.parse(row.evidenceJson)); } catch { return undefined; }
  }

  private commitGrowth(summary: RunSummary, events: GrowthEvent[], state: WorldState, eventType: string, receiptRunId: string): void {
    this.saveRun(summary);
    for (const event of events) {
      if (event.tree) {
        const tree = event.tree;
        this.db.prepare("INSERT INTO trees (id, gx, gy, species, plantedAt, runId) VALUES (?, ?, ?, ?, ?, ?)")
          .run(tree.id, tree.gx, tree.gy, tree.species, tree.plantedAt, tree.runId);
      }
      if (event.building) {
        const building = event.building;
        this.db.prepare("INSERT INTO buildings (id, gx, gy, kind, grownAt, runId, milestone) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET gx=excluded.gx, gy=excluded.gy, kind=excluded.kind, grownAt=excluded.grownAt, runId=excluded.runId, milestone=excluded.milestone")
          .run(building.id, building.gx, building.gy, building.kind, building.grownAt, building.runId, building.milestone);
        this.db.prepare("INSERT INTO building_details (id, detailJson) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET detailJson=excluded.detailJson")
          .run(building.id, JSON.stringify(building));
      }
    }
    this.setMeta("totalRuns", state.totalRuns);
    this.setMeta("totalFuturesSimulated", state.totalFuturesSimulated);
    this.setMeta("bestImprovementPct", state.bestImprovementPct);
    this.db.exec("DELETE FROM city_milestones");
    for (const milestone of state.pendingMilestones ?? []) this.db.prepare("INSERT INTO city_milestones VALUES (?, ?, ?)").run(milestone.id, milestone.family, JSON.stringify(milestone));
    for (const proofIdentity of state.cityProofReceipts ?? []) this.db.prepare("INSERT OR IGNORE INTO city_proof_receipts VALUES (?)").run(proofIdentity);
    this.db.prepare("INSERT OR IGNORE INTO growth_receipts (eventType, runId) VALUES (?, ?)").run(eventType, receiptRunId);
  }

  private hasReceipt(eventType: string, runId: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM growth_receipts WHERE eventType = ? AND runId = ?").get(eventType, runId));
  }

  /** One audited run yields one tree, including after a server restart. */
  recordRun(summary: RunSummary): GrowthEvent[] {
    if (!runGrowthEligible(summary)) return [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.hasReceipt("run", summary.runId)) { this.db.exec("COMMIT"); return []; }
      const transition = applyRunGrowth(this.getState(), summary, { id: randomUUID, now: Date.now });
      if (transition.events.length) this.commitGrowth(summary, transition.events, transition.world, "run", summary.runId);
      this.db.exec("COMMIT");
      return transition.events;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  /** A selected-sample improvement alone is insufficient. Missing evidence is
   * intentionally rejected; both engines use the same complete growth gate. */
  recordOptimization(runId: string, before: RunSummary, after: RunSummary, evidence?: OptimizationEvidence | null, targetPct = 5): GrowthEvent[] {
    if (runId !== before.runId) return [];
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // The exact full report must already be durable; caller-supplied flags
      // or an unretained partial report cannot grant construction choices.
      const retained = this.getOptimizationByResult(after.runId);
      const baseline = this.getRun(before.runId);
      if (!retained || !baseline || retained.baselineRunId !== before.runId || cityIdentity(baseline) !== cityIdentity(before)
        || cityIdentity(retained.optimization.result) !== cityIdentity(after)) {
        this.db.exec("COMMIT"); return [];
      }
      const transition = applyOptimizationGrowth(this.getState(), before, after, retained.optimization, { id: randomUUID, now: Date.now }, targetPct);
      if (runGrowthEligible(after)) this.saveRun(after);
      if (transition.events.length) this.commitGrowth(after, transition.events, transition.world, "optimization", before.runId);
      this.db.exec("COMMIT");
      return transition.events;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  placeMilestone(input: PlaceRequest): { world: WorldState; growthEvents: GrowthEvent[] } {
    const request = PlacementRequest.parse(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const state = this.getState();
      const milestone = state.pendingMilestones?.find((item) => item.id === request.milestoneId);
      const placed = state.buildings.find((building) => building.milestoneId === request.milestoneId);
      const proof = milestone?.proof ?? placed?.proof;
      if (!proof) throw new Error("That milestone is locked or unavailable.");
      const retained = this.getOptimizationByResult(proof.resultRunId);
      const baseline = retained && this.getRun(retained.baselineRunId);
      if (!baseline || !retained || retained.baselineRunId !== proof.baselineRunId) throw new Error("The exact immutable evidence is missing. No placement was granted.");
      const transition = applyMilestonePlacement(state, request, baseline, retained.optimization, { id: randomUUID, now: Date.now });
      if (transition.events.length) this.commitGrowth(retained.optimization.result, transition.events, transition.world, "placement", request.milestoneId);
      this.db.exec("COMMIT");
      return { world: this.getState(), growthEvents: transition.events };
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  close(): void {
    this.db.close();
  }
}

export function openWorld(path: string): World {
  return new World(path);
}
