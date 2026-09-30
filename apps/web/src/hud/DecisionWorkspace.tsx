import type { RunSummary } from "@verdant/protocol";
import type { OptimizeResponse } from "../ws/client";
import { LOCATIONS, PRESETS } from "@verdant/sim";
import { assessRun } from "../lib/analysisContext";

export function DecisionWorkspace({ baseline, optimized, stale, busy, targetPct, onTargetChange, onRun, onRisk, onStrategy, onProof, onMethod }: {
  baseline: RunSummary | null;
  optimized: OptimizeResponse | null;
  stale: boolean;
  busy: boolean;
  targetPct: number;
  onTargetChange: (value: number) => void;
  onRun: () => void;
  onRisk: () => void;
  onStrategy: () => void;
  onProof: () => void;
  onMethod: () => void;
}) {
  const result = optimized?.result ?? baseline;
  const assessment = result ? assessRun(result, targetPct) : null;
  const interval = assessment?.interval;
  const status = !result ? "Awaiting first run" : stale ? "Earlier configuration" : !assessment?.audited ? "Integrity review" : assessment.withinTarget ? "Within sample target" : "Above planning target";
  const warning = !!result && (stale || !assessment?.withinTarget);
  const metrics = result?.metrics;
  return <section className={`decision-workspace ${warning ? "needs-review" : ""}`} aria-label="Decision brief">
    <div className="decision-intro">
      <div><span className="studio-eyebrow">DECISION BRIEF</span><h2>{!result ? "How resilient is your system?" : optimized ? "A strategy, with its limits in view." : "Your system, stress-tested."}</h2>
        <p>{!result ? "Set the inputs. Explore the failures. Test a better plan." : `${LOCATIONS[result.location].label} · ${PRESETS[result.preset].label} · ${result.n.toLocaleString()} simulated futures${optimized ? " · recommended policy" : " · baseline policy"}`}</p></div>
      <span className={`decision-status ${warning ? "is-warning" : ""}`}><i />{status}</span>
    </div>
    <div className="decision-kpis">
      <article className={`decision-kpi ${result?.counts.critical ? "is-warning" : ""}`}><span>Critical power-loss risk</span><strong>{interval ? `${interval.observedPct.toFixed(1)}%` : "—"}</strong><p>{interval ? `95% interval ${interval.lowPct.toFixed(2)}–${interval.highPct.toFixed(2)}%` : "Computed from your completed simulation"}</p></article>
      <article className="decision-kpi"><span>Unserved critical energy</span><strong>{metrics ? metrics.meanCriticalUnservedKWh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}{metrics && <small> kWh</small>}</strong><p>Expected per modeled 72-hour future</p></article>
      <article className="decision-kpi"><span>Grid-related emissions</span><strong>{metrics ? metrics.meanCarbonKg.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}{metrics && <small> kg</small>}</strong><p>Operational CO₂ per modeled future</p></article>
      <article className="decision-kpi"><span>{optimized ? "Independent holdouts" : "Evidence integrity"}</span><strong>{optimized ? `${optimized.validation.passedCohorts}/${optimized.validation.cohortCount}` : result ? `${result.audit?.checks.filter((check) => check.passed).length ?? 0}/${result.audit?.checks.length ?? 0}` : "—"}</strong><p>{optimized ? `${optimized.validation.statisticallyResolvedCohorts} statistically resolved cohorts` : "Conservation, counts and replay checks"}</p></article>
    </div>
    <div className="decision-review">
      <label>Planning target <select aria-label="Critical risk planning target" value={targetPct} onChange={(event) => onTargetChange(Number(event.target.value))}><option value={1}>≤ 1% critical risk</option><option value={5}>≤ 5% critical risk</option><option value={10}>≤ 10% critical risk</option></select></label>
      <p>{!result ? "We compare the upper 95% sampling bound against your target after a run." : assessment?.withinTarget ? "The upper sampling bound is within your target. This is model evidence, not a field reliability guarantee." : "The upper sampling bound exceeds your target or the integrity audit needs review. Inspect before choosing a plan."}</p>
    </div>
    <div className="decision-actions">
      {!baseline || stale ? <button className="studio-primary" disabled={busy} onClick={onRun}>{stale ? "Test updated inputs" : "Run first analysis"}<span aria-hidden="true">↗</span></button> : <>
        <button onClick={onRisk}>Inspect failures <span aria-hidden="true">↗</span></button>
        <button className="studio-primary" disabled={busy} onClick={optimized ? onProof : onStrategy}>{optimized ? "Open paired proof" : "Evaluate strategies"}<span aria-hidden="true">↗</span></button>
      </>}
      <button className="studio-text-action" onClick={onMethod}>Sources &amp; assumptions</button>
      {result && <span className="decision-meta" title={result.runId}>RUN {result.manifest?.runFingerprint ?? result.runId.slice(0, 8)}</span>}
    </div>
  </section>;
}
