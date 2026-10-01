import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, LOCATIONS, MODEL_VERSION, runMonteCarlo, toRunSummary } from "@verdant/sim";
import { canonicalEvidenceJson, legacyEvidenceJson, sealEvidence, verifyEvidence } from "../src/lib/evidenceStore";

const baseline = () => toRunSummary("persisted-real-run", runMonteCarlo(500, LOCATIONS.jaipur, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION));

describe("Durable complete evidence envelope", () => {
  it("round-trips a real audited summary with all replay inputs and a SHA-256 checksum", async () => {
    const envelope = await sealEvidence("guest", baseline(), null, 5);
    expect(envelope.sha256).toMatch(/^[a-f0-9]{64}$/);
    const restored = await verifyEvidence(JSON.parse(JSON.stringify(envelope)), "guest");
    expect(restored.baseline).toEqual(envelope.payload.baseline);
    expect(restored.modelVersion).toBe(MODEL_VERSION);
    expect(restored.riskTargetPct).toBe(5);
  });
  it("does not mix two account workspaces", async () => {
    const envelope = await sealEvidence("user-A", baseline(), null, 5);
    await expect(verifyEvidence(envelope, "user-B")).rejects.toThrow(/different workspace/);
  });
  it("detects changed configuration, counters, and sources after serialization", async () => {
    const envelope = await sealEvidence("guest", baseline(), null, 5);
    const changed = structuredClone(envelope);
    changed.payload.baseline.config.hospitalKW++;
    await expect(verifyEvidence(changed, "guest")).rejects.toThrow(/checksum/);
  });
  it("rejects malformed records and contradictory audit claims", async () => {
    await expect(verifyEvidence({ payload: {} }, "guest")).rejects.toThrow();
    const run = baseline();
    run.audit!.status = "REVIEW";
    await expect(sealEvidence("guest", run, null, 5)).rejects.toThrow(/inconsistent audit/);
  });
  it("preserves honest REVIEW evidence without converting it to an approval", async () => {
    const run = baseline();
    run.audit!.status = "REVIEW";
    run.audit!.checks[0].passed = false;
    const envelope = await sealEvidence("guest", run, null, 5);
    expect((await verifyEvidence(envelope, "guest")).baseline.audit?.status).toBe("REVIEW");
  });
  it("retains but refuses an incompatible engine snapshot", async () => {
    const run = baseline();
    run.manifest!.modelVersion = "earlier-model";
    await expect(sealEvidence("guest", run, null, 5)).rejects.toThrow(/incompatible model/);
  });
  it("canonicalizes object order without changing trajectory array order", () => {
    expect(canonicalEvidenceJson({ b: [2, 1], a: 3 })).toBe(canonicalEvidenceJson({ a: 3, b: [2, 1] }));
    expect(canonicalEvidenceJson([1, 2])).not.toBe(canonicalEvidenceJson([2, 1]));
    expect(canonicalEvidenceJson({ z: 1, A: 2, a: 3 })).toBe('{"A":2,"a":3,"z":1}');
  });
  it("can check unversioned earlier seals without mislabeling their different key order as corruption", async () => {
    const envelope = await sealEvidence("guest", baseline(), null, 5);
    delete envelope.checksumFormat;
    // Synthetic zero-valued keys force the two historical sort orders to differ.
    envelope.payload.baseline.causeCounts = { A: 0, a: 0 };
    expect(legacyEvidenceJson(envelope.payload)).not.toBe(canonicalEvidenceJson(envelope.payload));
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(legacyEvidenceJson(envelope.payload)));
    envelope.sha256 = [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
    await expect(verifyEvidence(envelope, "guest")).resolves.toMatchObject({ modelVersion: MODEL_VERSION });
    envelope.checksumFormat = "CODEPOINT_V1";
    await expect(verifyEvidence(envelope, "guest")).rejects.toThrow(/checksum/);
  });
});
