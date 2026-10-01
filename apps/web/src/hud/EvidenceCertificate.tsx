import { useEffect, useRef, useState } from "react";
import type { EvidenceMilestone } from "@verdant/protocol/city";
import type { EvidenceEnvelope, StoredEvidence } from "@verdant/protocol/evidence";
import { criticalRiskInterval } from "@verdant/sim/decisionReadiness";
import type { ProofReplayResult } from "@verdant/sim/proofReplay";
import { replaySavedEvidence } from "../lib/proofReplayClient";
import "./evidence-city.css";

export function EvidenceCertificate({ milestone, title, loadProof, onClose, onCompare, onBusyChange }: {
  milestone: EvidenceMilestone; title: string;
  loadProof: (milestone: EvidenceMilestone) => Promise<EvidenceEnvelope>;
  onClose: () => void; onCompare: (evidence: StoredEvidence) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [envelope, setEnvelope] = useState<EvidenceEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [replaying, setReplaying] = useState(false);
  const [opening, setOpening] = useState(false);
  const [replay, setReplay] = useState<ProofReplayResult | null>(null);
  const replayController = useRef<AbortController | null>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setEnvelope(null); setError(null); setReplay(null);
    loadProof(milestone).then((value) => { if (active) setEnvelope(value); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : "The complete evidence could not be loaded."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; replayController.current?.abort(); };
  }, [milestone.id, milestone.proof.resultRunId, loadProof]);

  useEffect(() => { onBusyChange(loading || replaying || opening); return () => onBusyChange(false); }, [loading, replaying, opening, onBusyChange]);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); replayController.current?.abort(); onClose(); }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const controls = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input,select,[tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, [onClose]);

  const runReplay = async () => {
    if (!envelope || replaying) return;
    const controller = new AbortController(); replayController.current = controller;
    setReplaying(true); setReplay(null); setError(null);
    try { const result = await replaySavedEvidence(envelope.payload, controller.signal); if (!controller.signal.aborted) setReplay(result); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Replay failed."); }
    finally { if (replayController.current === controller) { replayController.current = null; setReplaying(false); } }
  };

  const compare = async () => {
    if (!envelope || replaying || opening) return;
    setOpening(true); setError(null);
    try { await onCompare(envelope.payload); onClose(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "The retained comparison could not be opened."); }
    finally { setOpening(false); }
  };

  const exportProof = () => {
    if (!envelope) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `grounded-proof-${milestone.id}.json`;
    anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const proof = milestone.proof;
  const before = criticalRiskInterval(proof.beforeCritical, proof.baselineSampleSize);
  const after = criticalRiskInterval(proof.afterCritical, proof.resultSampleSize);
  const full = envelope?.payload.optimization;
  const precool = full?.intervention.precoolHour;
  const precoolTime = precool == null ? "off" : `${String(Math.floor(precool)).padStart(2, "0")}:${String(Math.round((precool % 1) * 60)).padStart(2, "0")}`;
  return <div className="city-proof-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside className="city-proof-drawer" ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="city-certificate-title">
      <header className="city-proof-heading"><div><small>EVIDENCE CERTIFICATE · LEVEL {milestone.level}</small><h2 id="city-certificate-title">{title}</h2></div><button onClick={onClose} aria-label="Close evidence certificate">×</button></header>
      <div className={`city-proof-banner ${envelope ? "" : "warning"}`} role="status">{loading ? "Checking the retained proof and its SHA-256 checksum…" : envelope ? "Complete proof retained. The certificate matches the validated model report and its source fingerprints." : "Certificate summary only. The complete proof must be available and pass integrity checks before construction or replay."}</div>
      <div className="city-proof-stats"><article><span>Baseline modeled critical risk</span><b>{before?.observedPct.toFixed(2)}%</b><small>{proof.beforeCritical}/{proof.baselineSampleSize} futures · 95% upper {before?.highPct.toFixed(2)}%</small></article><article><span>Intervention modeled critical risk</span><b>{after?.observedPct.toFixed(2)}%</b><small>{proof.afterCritical}/{proof.resultSampleSize} futures · 95% upper {after?.highPct.toFixed(2)}%</small></article></div>
      <h3>Independent validation · target {proof.targetPct}%</h3>
      <table className="city-proof-table"><thead><tr><th>Holdout</th><th>Seed clusters</th><th>Upper 95%</th><th>Paired p</th></tr></thead><tbody>{proof.holdouts.map((cohort) => <tr key={cohort.label}><td>{cohort.label}</td><td>{cohort.clusterCount}</td><td>{cohort.upperCriticalRiskPct.toFixed(2)}%</td><td>{cohort.pairedPValue.toPrecision(3)}</td></tr>)}</tbody></table>
      <p className="city-proof-footnote">The upper bounds use independent seed clusters. This certificate records modeled validation; real facility approval requires local data and engineering review.</p>
      <dl className="city-proof-meta"><dt>Compound stress</dt><dd>{proof.compoundPassingCells}/{proof.compoundStressCells} cells passed</dd><dt>Engine</dt><dd>{proof.modelVersion}</dd><dt>Climate source</dt><dd>{proof.calibrationFingerprint}</dd><dt>Operational source</dt><dd>{proof.siteDataFingerprint}</dd><dt>Baseline run</dt><dd>{proof.baselineRunId}</dd><dt>Intervention run</dt><dd>{proof.resultRunId}</dd></dl>
      {full && <><h3>Intervention and trade-offs</h3><dl className="city-proof-meta"><dt>Policy</dt><dd>Reserve {full.intervention.reservePct}% · EV delay {full.intervention.evDelayMin} min · precooling {precoolTime}</dd><dt>CVaR95 deficit</dt><dd>{envelope?.payload.baseline.metrics?.cvar95TotalUnservedKWh} → {full.result.metrics?.cvar95TotalUnservedKWh} kWh</dd><dt>Operating cost</dt><dd>{envelope?.payload.baseline.metrics?.meanOperationalCost} → {full.result.metrics?.meanOperationalCost} model currency units / future</dd><dt>Grid emissions</dt><dd>{envelope?.payload.baseline.metrics?.meanCarbonKg} → {full.result.metrics?.meanCarbonKg} kg CO₂ / future</dd></dl></>}
      <h3>Proof identity · SHA-256</h3><code className="city-proof-fingerprint">{proof.proofIdentity}</code>
      {envelope && <><h3>Retained package checksum</h3><code className="city-proof-fingerprint">{envelope.sha256}</code></>}
      {error && <p className="city-action-error" role="alert">{error}</p>}
      <div className="city-proof-actions"><button disabled={!envelope || loading || replaying || opening} onClick={compare}>{opening ? "Opening…" : "View comparison"}</button><button disabled={!envelope || loading || replaying || opening} onClick={runReplay}>{replaying ? "Replaying proof…" : "Replay complete proof"}</button><button disabled={!envelope || loading} onClick={exportProof}>Export evidence</button>{replaying && <button onClick={() => replayController.current?.abort()}>Cancel replay</button>}</div>
      {replaying && <p className="city-proof-footnote" role="status">Recomputing the recorded baseline, policy search, holdouts, shocks, stress grid and climate replay. The stored certificate remains unchanged.</p>}
      {replay && <section aria-label="Proof replay result"><h3>{replay.status === "PASS" ? "Reproducibility check passed" : "Reproducibility check failed"}</h3><p className="city-proof-footnote">{replay.statement}</p><ul className="city-replay-checks">{replay.checks.map((check) => <li key={check.label}><strong>{check.passed ? "✓" : "!"} {check.label}</strong><span>{check.detail}</span></li>)}</ul></section>}
      <p className="city-proof-footnote">Design and placement never alter the simulation. Checksums detect changes to a package; they do not independently authenticate its data source. The complete package stays on the device where it was earned, or in the local server database.</p>
    </aside>
  </div>;
}
