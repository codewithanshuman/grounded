import { EvidenceEnvelope, StoredEvidence, type EvidenceEnvelope as Envelope, type StoredEvidence as Evidence } from "@verdant/protocol/evidence";
import { MODEL_VERSION } from "@verdant/sim";
import type { OptimizeResponse } from "../ws/client";
import type { RunSummary } from "@verdant/protocol";

const DATABASE = "grounded-evidence-v1";
const RECORDS = "records";
const MAX_RECORDS_PER_WORKSPACE = 20;
const PROOFS = "proofs";

/** Stable JSON ordering for accidental-corruption detection, not authenticity. */
export function canonicalEvidenceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalEvidenceJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

// Read-only compatibility with the unversioned locale-sorted development seals.
// New packages always use a portable, explicitly versioned code-point order.
export function legacyEvidenceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(legacyEvidenceJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${legacyEvidenceJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

async function sha256(value: unknown, legacy = false): Promise<string> {
  const data = new TextEncoder().encode(legacy ? legacyEvidenceJson(value) : canonicalEvidenceJson(value));
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function assertRunIntegrity(run: RunSummary) {
  const counts = Object.values(run.counts);
  const auditConsistent = !!run.audit && run.audit.checks.length > 0
    && (run.audit.status === "PASS") === run.audit.checks.every((check) => check.passed);
  if (!Number.isInteger(run.n) || run.n <= 0 || !counts.every((value) => Number.isInteger(value) && value >= 0)
    || counts.reduce((sum, value) => sum + value, 0) !== run.n || !auditConsistent
    || run.manifest?.deterministicReplay !== true || run.manifest.scenarioCount !== run.n
    || run.manifest.modelVersion !== MODEL_VERSION
    || run.manifest.calibrationFingerprint !== (run.calibration?.fingerprint ?? "REFERENCE")
    || run.manifest.siteDataFingerprint !== run.siteData?.fingerprint) {
    throw new Error("Saved evidence has an incompatible model or inconsistent audit/source manifest. The original record was retained.");
  }
}

export async function sealEvidence(ownerScope: string, baseline: RunSummary, optimization: OptimizeResponse | null, riskTargetPct: number): Promise<Envelope> {
  const payload = StoredEvidence.parse({ schemaVersion: 1, recordId: crypto.randomUUID(), ownerScope,
    savedAt: Date.now(), modelVersion: MODEL_VERSION, riskTargetPct, baseline, optimization });
  assertRunIntegrity(payload.baseline);
  if (payload.optimization) assertRunIntegrity(payload.optimization.result);
  return { payload, sha256: await sha256(payload), checksumFormat: "CODEPOINT_V1" };
}

export async function verifyEvidence(raw: unknown, ownerScope: string): Promise<Evidence> {
  const envelope = EvidenceEnvelope.parse(raw);
  if (envelope.payload.ownerScope !== ownerScope) throw new Error("Saved evidence belongs to a different workspace.");
  const currentChecksumMatches = envelope.sha256 === await sha256(envelope.payload);
  const legacyChecksumMatches = !currentChecksumMatches && !envelope.checksumFormat && envelope.sha256 === await sha256(envelope.payload, true);
  if (!currentChecksumMatches && !legacyChecksumMatches) throw new Error("Saved evidence checksum failed. The original record was retained.");
  if (envelope.payload.modelVersion !== MODEL_VERSION) throw new Error("Saved evidence uses an earlier simulation engine. The record is retained; run the current model before optimizing.");
  assertRunIntegrity(envelope.payload.baseline);
  if (envelope.payload.optimization) assertRunIntegrity(envelope.payload.optimization.result);
  return envelope.payload;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(RECORDS)) {
        const store = request.result.createObjectStore(RECORDS, { keyPath: "payload.recordId" });
        store.createIndex("owner", "payload.ownerScope", { unique: false });
      }
      if (!request.result.objectStoreNames.contains(PROOFS)) {
        const store = request.result.createObjectStore(PROOFS, { keyPath: "id" });
        store.createIndex("owner", "ownerScope", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser evidence storage unavailable."));
    request.onblocked = () => reject(new Error("Evidence storage upgrade is blocked by another Grounded tab."));
  });
}

function completeTransaction(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Evidence could not be stored."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Evidence save was aborted."));
  });
}

export async function loadEvidence(ownerScope: string): Promise<Evidence | null> {
  const database = await openDatabase();
  try {
    const records = await new Promise<Envelope[]>((resolve, reject) => {
      const request = database.transaction(RECORDS).objectStore(RECORDS).index("owner").getAll(ownerScope);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    // Never silently fall back from a corrupt latest decision to an older one.
    const newest = records.sort((a, b) => b.payload.savedAt - a.payload.savedAt)[0];
    return newest ? verifyEvidence(newest, ownerScope) : null;
  } finally { database.close(); }
}

export async function saveEvidence(envelope: Envelope): Promise<void> {
  await verifyEvidence(envelope, envelope.payload.ownerScope);
  const database = await openDatabase();
  try {
    const transaction = database.transaction(RECORDS, "readwrite");
    const finished = completeTransaction(transaction);
    const store = transaction.objectStore(RECORDS);
    store.put(envelope);
    const request = store.index("owner").getAll(envelope.payload.ownerScope);
    request.onsuccess = () => {
      const records = (request.result as Envelope[]).sort((a, b) => b.payload.savedAt - a.payload.savedAt);
      for (const old of records.slice(MAX_RECORDS_PER_WORKSPACE)) store.delete(old.payload.recordId);
    };
    await finished;
  } finally { database.close(); }
}

const proofKey = (ownerScope: string, milestoneId: string, resultRunId: string) =>
  JSON.stringify([ownerScope, milestoneId, resultRunId]);

/** Milestone proofs are separate from the rolling analysis history. They are
 * append-only and cannot be evicted by the 20-snapshot history limit. */
export async function pinMilestoneEvidence(envelope: Envelope, milestoneId: string): Promise<void> {
  const payload = await verifyEvidence(envelope, envelope.payload.ownerScope);
  if (!payload.optimization || !milestoneId) throw new Error("A milestone requires a complete optimization report.");
  const database = await openDatabase();
  try {
    const transaction = database.transaction(PROOFS, "readwrite");
    const finished = completeTransaction(transaction);
    const store = transaction.objectStore(PROOFS);
    const id = proofKey(payload.ownerScope, milestoneId, payload.optimization.result.runId);
    const request = store.get(id);
    request.onsuccess = () => {
      // Re-saving the same report never replaces the original evidence seal.
      if (!request.result) store.add({ id, ownerScope: payload.ownerScope, milestoneId, envelope });
    };
    await finished;
  } finally { database.close(); }
}

export async function loadMilestoneEvidence(ownerScope: string, milestoneId: string, resultRunId: string): Promise<Envelope | null> {
  const database = await openDatabase();
  try {
    const record = await new Promise<{ envelope: Envelope } | undefined>((resolve, reject) => {
      const request = database.transaction(PROOFS).objectStore(PROOFS).get(proofKey(ownerScope, milestoneId, resultRunId));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!record) return null;
    await verifyEvidence(record.envelope, ownerScope);
    return record.envelope;
  } finally { database.close(); }
}
