import { useEffect, useRef, useState } from "react";
import type { RunSummary } from "@verdant/protocol";
import type { EvidenceEnvelope } from "@verdant/protocol/evidence";
import type { ProofReplayResult } from "@verdant/sim/proofReplay";
import type { OptimizeResponse } from "../ws/client";
import { sealEvidence } from "../lib/evidenceStore";
import { replaySavedEvidence } from "../lib/proofReplayClient";
import "./evidence-city.css";

/** Reproducibility is available for every report, not only successful milestones. */
export function EvidenceReplayPanel({ ownerScope, baseline, optimization, targetPct, busy, onBusyChange }: {
  ownerScope: string; baseline: RunSummary; optimization: OptimizeResponse | null;
  targetPct: number; busy: boolean; onBusyChange: (busy: boolean) => void;
}) {
  const [envelope, setEnvelope] = useState<EvidenceEnvelope | null>(null);
  const [replay, setReplay] = useState<ProofReplayResult | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    let active = true;
    setEnvelope(null); setReplay(null); setError(null);
    sealEvidence(ownerScope, baseline, optimization, targetPct)
      .then((value) => { if (active) setEnvelope(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "This evidence package could not be checked."); });
    return () => { active = false; controllerRef.current?.abort(); };
  }, [ownerScope, baseline, optimization, targetPct]);
  useEffect(() => { onBusyChange(running); return () => onBusyChange(false); }, [running, onBusyChange]);
  const runReplay = async () => {
    if (!envelope || busy || controllerRef.current) return;
    const controller = new AbortController(); controllerRef.current = controller;
    setRunning(true); setReplay(null); setError(null);
    try {
      const result = await replaySavedEvidence(envelope.payload, controller.signal);
      if (!controller.signal.aborted) setReplay(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Replay failed.");
    } finally {
      if (controllerRef.current === controller) { controllerRef.current = null; setRunning(false); }
    }
  };
  const exportEvidence = () => {
    if (!envelope) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url;
    link.download = `grounded-evidence-${optimization?.result.runId ?? baseline.runId}.json`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };
  return <section className="evidence-city-panel" aria-label="Reproducibility lab">
    <header className="evidence-city-heading"><div><span className="studio-eyebrow">REPRODUCIBILITY</span><h3>Don't take the report on trust.</h3><p>Rerun the stored inputs and compare the recomputed evidence. Replay never changes your city or earns another reward.</p></div></header>
    <div className="city-proof-actions"><button disabled={!envelope || busy || running} onClick={runReplay}>{running ? "Recomputing evidence…" : optimization ? "Replay complete analysis" : "Replay baseline"}</button><button disabled={!envelope} onClick={exportEvidence}>Export full evidence package</button>{running && <button onClick={() => { controllerRef.current?.abort(); setError("Replay cancelled. The original evidence and city are unchanged."); }}>Cancel replay</button>}</div>
    {running && <p className="city-proof-footnote" role="status">{optimization ? "Recomputing the baseline, policy search, holdouts, stress grid, climate replay and any retained infrastructure search, investment holdouts and measurement priorities. This may take several minutes." : "Recomputing every recorded baseline scenario and checking the complete report."}</p>}
    {error && <p className="city-action-error" role="status">{error}</p>}
    {replay && <div aria-live="polite"><h4>{replay.status === "PASS" ? "Reproducibility check passed" : "Reproducibility check failed"}</h4><p className="city-proof-footnote">{replay.statement}</p><ul className="city-replay-checks">{replay.checks.map((check) => <li key={check.label}><strong>{check.passed ? "✓" : "!"} {check.label}</strong><span>{check.detail}</span></li>)}</ul></div>}
    {envelope && <details><summary>Package checksum and scope</summary><code className="city-proof-fingerprint">{envelope.sha256}</code><p className="city-proof-footnote">Engine {envelope.payload.modelVersion} · {baseline.n.toLocaleString()} baseline futures · {optimization ? "complete optimization report" : "baseline only"}. SHA-256 detects package changes; it does not independently authenticate facility data. Matching output demonstrates model reproducibility, not real-world safety.</p></details>}
  </section>;
}
