import type { RunSummary } from "@verdant/protocol";
import type { OptimizeResponse } from "../ws/client";
import { LOCATIONS, PRESETS } from "@verdant/sim";
import { assessDecisionReadiness } from "../lib/decisionReadiness";

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
  const readiness = assessDecisionReadiness(baseline, optimized, targetPct, stale);
  const { result, assessment } = readiness;
  const interval = assessment?.interval;
  const warning = !!result && !readiness.withinTarget;
  const metrics = result?.metrics;
  return <section className={`decision-workspace ${warning ? "needs-review" : ""}`} aria-label="Decision brief">
    <div className="decision-intro">
      <div><span className="studio-eyebrow">DECISION BRIEF</span><h2>{!result ? "How resilient is your system?" : optimized ? "Policy assessment" : "System assessment"}</h2>
        <p>{!result ? "Set the inputs. Explore the failures. Test a better plan." : `${LOCATIONS[result.location].label} · ${PRESETS[result.preset].label} · ${result.n.toLocaleString()} simulated futures${optimized ? " · recommended policy" : " · baseline policy"}`}</p></div>
      <span className={`decision-status ${warning ? "is-warning" : ""}`} role="status"><i />{readiness.label}</span>
    </div>
    <div className="decision-kpis">
      <article className={`decision-kpi ${result?.counts.critical ? "is-warning" : ""}`}><span>Selected-hazard critical risk</span><strong>{interval ? `${interval.observedPct.toFixed(1)}%` : "—"}</strong><p>{interval ? `95% interval ${interval.lowPct.toFixed(2)}–${interval.highPct.toFixed(2)}%` : "Computed from your completed simulation"}</p></article>
      <article className="decision-kpi"><span>Unserved critical energy</span><strong>{metrics ? metrics.meanCriticalUnservedKWh.toLocaleString(undefined, { maximumFractionDigits: 1 }) : "—"}{metrics && <small> kWh</small>}</strong><p>Expected per modeled 72-hour future</p></article>
      <article className="decision-kpi"><span>Grid-related emissions</span><strong>{metrics ? metrics.meanCarbonKg.toLocaleString(undefined, { maximumFractionDigits: 0 }) : "—"}{metrics && <small> kg</small>}</strong><p>Operational CO₂ per modeled future</p></article>
      <article className={`decision-kpi ${optimized && readiness.targetMetCohorts < readiness.holdouts.length ? "is-warning" : ""}`}><span>{optimized ? "Holdouts meeting target" : "Evidence integrity"}</span><strong>{optimized ? `${readiness.targetMetCohorts}/${readiness.holdouts.length}` : result ? `${result.audit?.checks.filter((check) => check.passed).length ?? 0}/${result.audit?.checks.length ?? 0}` : "—"}</strong><p>{optimized ? "Conservative 95% seed-cluster bound" : "Conservation, counts and replay checks"}</p></article>
    </div>
    <div className="decision-review">
      <label>Planning target <select aria-label="Critical risk planning target" value={targetPct} disabled={busy} onChange={(event) => onTargetChange(Number(event.target.value))}><option value={1}>≤ 1% critical risk</option><option value={5}>≤ 5% critical risk</option><option value={10}>≤ 10% critical risk</option></select></label>
      <p>{readiness.summary}</p>
    </div>
    {optimized && <details className="decision-evidence">
      <summary>Decision evidence &amp; limits</summary>
      <div className="cohort-grid">{readiness.holdouts.map((cohort, index) => <article key={`${cohort.seedOffset}-${index}`}>
        <strong>{cohort.label}</strong><p>{cohort.failures}/{cohort.sampleSize} critical failures · {cohort.clusterCount ?? "—"} independent seed clusters</p>
        <p>{cohort.interval ? `Conservative upper 95% ${cohort.interval.highPct.toFixed(2)}%` : "Cluster evidence needs integrity review"}</p>
        <p>{cohort.withinTarget ? "Risk bound meets target" : "Risk bound needs review"}{cohort.introducedFailures > 0 ? ` · ${cohort.introducedFailures} introduced` : ""}</p>
      </article>)}</div>
      <p>Recommendation under tested assumptions: {readiness.recommendationStable ? "stable" : "review needed"}. Shortlist rank: {readiness.rankStable ? "stable" : "review needed"}.</p>
      {readiness.reasons.length > 0 && <ul>{readiness.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
      {optimized.analysis && <p>{optimized.analysis.selectionMode === "TARGET_FEASIBLE_MINIMAL_DISRUPTION"
        ? `Discovery selected the least-disruptive policy among ${optimized.analysis.feasibleStrategyCount} strategies meeting the ${optimized.analysis.riskTargetPct}% conservative cluster bound, then operating cost and grid carbon.`
        : `Discovery did not resolve the ${optimized.analysis.riskTargetPct}% target; the displayed policy is a risk-first fallback, not a target-supported recommendation.`}</p>}
      <p>Each holdout mixes the search's {optimized.analysis?.hazardCount ?? "recorded"} modeled hazards. A shared seed counts once: a cluster is critical when any of its hazard variants fails. Exact one-sided 95% binomial bounds conservatively cover the mean modeled hazard risk; incomplete clusters are counted pessimistically. Bounds assume independent simulated seed clusters. They are not simultaneous guarantees or field reliability certification. Discovery bounds are not adjusted for adaptive selection; the untouched holdouts challenge the chosen policy. Stress checks measure relative non-regression, not the absolute target in every cell. Changing the planning target requires a new strategy search.</p>
    </details>}
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
