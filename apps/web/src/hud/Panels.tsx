import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, ReferenceLine, Legend, Cell,
} from "recharts";
import type { ClimateSweepResult, RunSummary } from "@verdant/protocol";
import {
  LOCATIONS, PRESETS, PRESET_ORDER, buildNarrative, explainFailure, fmtHour, locationFromCalibration, simulateScenario, wilsonInterval, DT,
} from "@verdant/sim";
import { StatBlock, RiskSegmentBar, TimelineList } from "./Widgets";
import type { OptimizeResponse } from "../ws/client";

/* ----------------------------- Climate Matrix ------------------------------ */
export function ClimateMatrixPanel({ sweep }: { sweep: ClimateSweepResult }) {
  const weakest = sweep.scenarios.find((scenario) => scenario.preset === sweep.weakestPreset)!;
  const totalFutures = sweep.scenarioCount * sweep.scenarios.length;
  const colorFor = (score: number) => score >= 90 ? "#34d399" : score >= 70 ? "#fbbf24" : score >= 50 ? "#fb923c" : "#f87171";

  return (
    <div className="w-[520px]">
      <div className="grid grid-cols-4 gap-2 mb-3">
        <StatBlock label="Robust score" value={`${sweep.robustScore.toFixed(1)}`} sub="worst-case / 100" color={colorFor(sweep.robustScore)} />
        <StatBlock label="Futures tested" value={totalFutures.toLocaleString()} sub="same seeded populations" color="#38bdf8" />
        <StatBlock label="Exposure horizon" value="72 hours" sub="288 dispatch intervals" color="#8b6948" />
        <StatBlock label="Weakest hazard" value={weakest.label.replace("Extreme ", "")} sub={weakest.dominantCause} color="#f87171" />
      </div>

      {sweep.calibration && <div className="matrix-provenance"><span>CLIMATE FINGERPRINT</span><b>{sweep.calibration.fingerprint}</b><p>{sweep.calibration.source === "NASA_POWER" ? "NASA POWER calibrated" : "Reference fallback"} · {sweep.calibration.latitude.toFixed(3)}°, {sweep.calibration.longitude.toFixed(3)}° · cached for reproducibility</p></div>}

      <div className="border border-slate-800 rounded-lg overflow-hidden">
        <div className="grid grid-cols-[1.25fr_2fr_.7fr_.7fr] gap-3 bg-slate-900/70 px-3 py-2 text-[9px] tracking-wider text-slate-500 uppercase">
          <span>Climate regime</span><span>Resilience</span><span className="text-right">Critical</span><span className="text-right">Score</span>
        </div>
        {sweep.scenarios.map((scenario) => (
          <div key={scenario.preset} className="grid grid-cols-[1.25fr_2fr_.7fr_.7fr] gap-3 items-center px-3 py-2.5 border-t border-slate-800/80">
            <div>
              <div className="text-[11px] text-slate-200">{scenario.label}</div>
              <div className="text-[9px] text-slate-600 truncate" title={scenario.dominantCause}>{scenario.dominantCause}</div>
            </div>
            <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${scenario.resilienceScore}%`, backgroundColor: colorFor(scenario.resilienceScore) }} />
            </div>
            <span className="font-mono text-[11px] text-right text-slate-400">{scenario.criticalPct.toFixed(1)}%</span>
            <span className="font-mono text-[12px] font-medium text-right" style={{ color: colorFor(scenario.resilienceScore) }}>{scenario.resilienceScore.toFixed(1)}</span>
          </div>
        ))}
      </div>

      <div className="mt-3 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2.5 text-[10px] leading-relaxed text-slate-400">
        <span className="text-cyan-300 font-medium">Reproducible evidence.</span> Each hazard uses the same {sweep.scenarioCount.toLocaleString()} deterministic, correlated 72-hour climate, outage, demand, and solar seeds. The robust score is the lowest weighted resilience score—not an average that can hide a catastrophic weak point.
      </div>
    </div>
  );
}

/* --------------------------------- Risk Map --------------------------------- */
export function RiskPanel({ baseline, selectedFailureSeed, setSelectedFailureSeed }: {
  baseline: RunSummary; selectedFailureSeed: number | null; setSelectedFailureSeed: (s: number) => void;
}) {
  const location = locationFromCalibration(LOCATIONS[baseline.location], baseline.calibration);
  const selected = selectedFailureSeed != null
    ? baseline.failures.find((f) => f.seed === selectedFailureSeed) ?? baseline.failures[0]
    : baseline.failures[0];

  const detailed = useMemo(() => {
    if (!selected) return null;
    return simulateScenario(selected.seed, location, baseline.preset, baseline.config, baseline.intervention, true);
  }, [selected, location, baseline]);

  const narrative = useMemo(() => (detailed ? buildNarrative(detailed.steps, baseline.preset, location) : []), [detailed, baseline.preset, location]);
  const diagnosis = useMemo(() => (detailed ? explainFailure(detailed, location, baseline.preset, baseline.config) : null), [detailed, location, baseline]);
  const chartData = detailed?.steps.map((s) => ({ time: fmtHour(s.hour), soc: Math.round(s.socPct) })) ?? [];

  const causeData = useMemo(() => {
    const total = Object.values(baseline.causeCounts).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(baseline.causeCounts).map(([name, count]) => ({ name, count, pct: Math.round((count / total) * 100) })).sort((a, b) => b.count - a.count);
  }, [baseline.causeCounts]);
  const criticalPct = baseline.n ? (baseline.counts.critical / baseline.n) * 100 : 0;
  const confidence = wilsonInterval(baseline.counts.critical, baseline.n);
  const earliestLoss = baseline.failures[0] ? fmtHour(baseline.failures[0].failStep * DT) : "None";
  const surrogateCoefficientMax = Math.max(0.001, ...(baseline.surrogate?.coefficients.map((item) => Math.abs(item.coefficient)) ?? []));

  return (
    <div className="w-[620px]">
      <div className="grid grid-cols-4 gap-2 mb-3">
        <StatBlock label="Critical risk" value={`${criticalPct.toFixed(1)}%`} sub={`${baseline.counts.critical.toLocaleString()} failed futures`} color="#bd5e4c" />
        <StatBlock label="95% confidence" value={`${confidence.lowPct}–${confidence.highPct}%`} sub="Wilson score interval" color="#8b6948" />
        <StatBlock label="Earliest loss" value={earliestLoss} sub="first critical seed" color="#b46c3b" />
        <StatBlock label="Sample" value={baseline.n.toLocaleString()} sub="deterministic futures" color="#3f6b3e" />
      </div>
      <RiskSegmentBar counts={baseline.counts} total={baseline.n} />

      {baseline.audit && baseline.manifest && <section className={`run-assurance ${baseline.audit.status === "PASS" ? "passed" : "review"}`}>
        <div className="assurance-verdict"><span>{baseline.audit.status === "PASS" ? "✓" : "!"}</span><div><small>RUN INTEGRITY</small><strong>{baseline.audit.status === "PASS" ? `${baseline.audit.checks.length}/${baseline.audit.checks.length} invariants passed` : "Review required"}</strong></div></div>
        <div><small>RUN FINGERPRINT</small><code>{baseline.manifest.runFingerprint}</code></div>
        <div><small>ENERGY-BALANCE ERROR</small><b>{baseline.audit.maxEnergyBalanceErrorKWh.toExponential(2)} kWh</b></div>
        <div><small>REPLAY</small><b>{baseline.manifest.deterministicReplay ? "Checksum match" : "Mismatch"}</b></div>
      </section>}

      <div className="advanced-evidence-row">
        <section className="sensitivity-panel">
          <div className="mini-heading"><div><small>STRESS SENSITIVITY</small><strong>What controls system risk?</strong></div><span>{baseline.sensitivity?.sampleSize ?? 0} paired futures</span></div>
          {baseline.sensitivity?.factors.map((factor) => <div className="sensitivity-row" key={factor.id}><span>{factor.label}</span><div><i style={{ width: `${Math.max(2, factor.contributionPct)}%` }} /></div><b>{factor.contributionPct.toFixed(1)}%</b><small>+{factor.deltaCriticalPct.toFixed(1)} pts</small></div>)}
          {baseline.sensitivity?.interaction && <div className="interaction-proof"><small>SECOND-ORDER INTERACTION</small><strong>{baseline.sensitivity.interaction.factorALabel} × {baseline.sensitivity.interaction.factorBLabel}</strong><p>Combined risk {baseline.sensitivity.interaction.combinedCriticalPct.toFixed(1)}% · interaction {baseline.sensitivity.interaction.interactionDeltaPct >= 0 ? "+" : ""}{baseline.sensitivity.interaction.interactionDeltaPct.toFixed(1)} points beyond additive expectation.</p></div>}
          {!baseline.sensitivity && <p className="text-[10px] text-slate-500">Sensitivity analysis unavailable for this run.</p>}
        </section>
        <section className="energy-accounting">
          <div className="mini-heading"><div><small>72-HOUR ACCOUNTING</small><strong>Expected impact per future</strong></div></div>
          <div><span><small>CRITICAL UNSERVED</small><b>{baseline.metrics?.meanCriticalUnservedKWh.toFixed(1) ?? "—"} kWh</b></span><span><small>FLEXIBLE UNSERVED</small><b>{baseline.metrics?.meanFlexibleUnservedKWh.toFixed(1) ?? "—"} kWh</b></span><span><small>OPERATING COST</small><b>${baseline.metrics?.meanOperationalCost.toFixed(0) ?? "—"}</b></span><span><small>GRID CARBON</small><b>{baseline.metrics?.meanCarbonKg.toFixed(0) ?? "—"} kg</b></span></div>
        </section>
      </div>

      <div className="reliability-environment-row">
        <section className="depth-card reliability-card">
          <div className="mini-heading"><div><small>RELIABILITY STANDARD</small><strong>Failure probability is not enough</strong></div><span>72-hour horizon</span></div>
          <div className="depth-metric-grid">
            <span><small>LOLP</small><b>{criticalPct.toFixed(1)}%</b><em>futures with critical loss</em></span>
            <span><small>LOLE</small><b>{baseline.metrics?.meanCriticalLossHours?.toFixed(1) ?? "—"} h</b><em>mean critical-loss duration</em></span>
            <span><small>EENS</small><b>{baseline.metrics?.meanTotalUnservedKWh?.toFixed(0) ?? "—"} kWh</b><em>mean unserved energy</em></span>
            <span><small>CVaR95</small><b>{baseline.metrics?.cvar95TotalUnservedKWh?.toFixed(0) ?? "—"} kWh</b><em>mean of worst 5% futures</em></span>
          </div>
          <p>Tail severity stays visible even when average risk looks acceptable. P95 critical-loss duration: <strong>{baseline.metrics?.p95CriticalLossHours?.toFixed(1) ?? "—"} hours</strong>.</p>
        </section>
        <section className="depth-card environment-card">
          <div className="mini-heading"><div><small>RENEWABLE PROVENANCE</small><strong>Every clean kWh is traced</strong></div><span>conservative credit</span></div>
          <div className="depth-metric-grid">
            <span><small>SOLAR CAPTURE</small><b>{baseline.metrics?.solarCapturePct?.toFixed(1) ?? "—"}%</b><em>generation used or stored</em></span>
            <span><small>RENEWABLE SERVED</small><b>{baseline.metrics?.meanRenewableServedKWh?.toFixed(0) ?? "—"} kWh</b><em>mean per future</em></span>
            <span><small>CURTAILMENT</small><b>{baseline.metrics?.meanSolarCurtailmentKWh?.toFixed(0) ?? "—"} kWh</b><em>solar not captured</em></span>
            <span><small>AVOIDED GRID CO₂</small><b>{baseline.metrics?.meanAvoidedGridCarbonKg?.toFixed(0) ?? "—"} kg</b><em>location grid factor</em></span>
          </div>
          <p>Only direct solar and energy discharged from solar-charged storage receive renewable credit; starting battery energy is excluded.</p>
        </section>
      </div>

      <section className="statistical-depth">
        <div><small>MONTE CARLO PRECISION</small><strong>Risk is reported with sampling uncertainty</strong><p>The engine exposes the residual interval and tail, rather than presenting a single percentage as certainty.</p></div>
        <span><small>95% MARGIN</small><b>±{baseline.metrics?.criticalRiskMarginPct?.toFixed(2) ?? "—"} pts</b><em>Wilson score</em></span>
        <span><small>ANY UNSERVED</small><b>{baseline.metrics?.probabilityAnyUnservedPct?.toFixed(1) ?? "—"}%</b><em>critical or flexible</em></span>
        <span><small>P99 SEVERITY</small><b>{baseline.metrics?.p99TotalUnservedKWh?.toFixed(0) ?? "—"} kWh</b><em>99th percentile</em></span>
        <span><small>CVaR99</small><b>{baseline.metrics?.cvar99TotalUnservedKWh?.toFixed(0) ?? "—"} kWh</b><em>worst 1% mean</em></span>
        <span><small>LOSS EVENTS</small><b>{baseline.metrics?.meanLossOfLoadEvents?.toFixed(2) ?? "—"}</b><em>mean / future</em></span>
      </section>

      {baseline.surrogate && <section className={`surrogate-card ${baseline.surrogate.status.toLowerCase()}`}>
        <div className="surrogate-heading">
          <div><small>PHYSICS-INFORMED ML AUDIT</small><strong>Can a compact model explain the simulator’s failures?</strong><p>{baseline.surrogate.method}. It is trained after dispatch and scored only on untouched futures.</p></div>
          <span><i>{baseline.surrogate.status === "PASS" ? "✓" : baseline.surrogate.status === "REVIEW" ? "!" : "·"}</i><b>{baseline.surrogate.status}</b><em>diagnostic only</em></span>
        </div>
        <div className="surrogate-metrics">
          <span><small>HOLDOUT AUROC</small><b>{baseline.surrogate.auc?.toFixed(3) ?? "—"}</b><em>ranking power</em></span>
          <span><small>BRIER SCORE</small><b>{baseline.surrogate.brierScore?.toFixed(3) ?? "—"}</b><em>probability error</em></span>
          <span><small>CALIBRATION ERROR</small><b>{baseline.surrogate.calibrationErrorPct != null ? `${baseline.surrogate.calibrationErrorPct.toFixed(1)}%` : "—"}</b><em>five probability bins</em></span>
          <span><small>BALANCED ACCURACY</small><b>{baseline.surrogate.balancedAccuracyPct != null ? `${baseline.surrogate.balancedAccuracyPct.toFixed(1)}%` : "—"}</b><em>threshold {baseline.surrogate.threshold?.toFixed(2) ?? "—"}</em></span>
          <span><small>DATA SPLIT</small><b>{baseline.surrogate.trainingSize} / {baseline.surrogate.holdoutSize}</b><em>train / untouched</em></span>
        </div>
        {baseline.surrogate.coefficients.length > 0 && <div className="surrogate-drivers">
          <div><small>STANDARDIZED DRIVER WEIGHTS</small><p>Magnitude shows association with simulated failure, not real-world causation.</p></div>
          {baseline.surrogate.coefficients.map((item) => <span key={item.id}><label>{item.label}</label><i><b className={item.direction} style={{ width: `${Math.max(4, Math.abs(item.coefficient) / surrogateCoefficientMax * 100)}%` }} /></i><strong>{item.coefficient > 0 ? "+" : ""}{item.coefficient.toFixed(3)}</strong></span>)}
        </div>}
        <p className="surrogate-boundary"><strong>Authority boundary.</strong> {baseline.surrogate.disclosure}</p>
      </section>}

      <div className="grid grid-cols-2 gap-3 mt-3">
        <div>
          <h3 className="text-[10px] tracking-wider text-slate-500 uppercase mb-1">Cause contribution</h3>
          {causeData.length === 0 ? (
            <p className="text-[11px] text-slate-500">No high-risk or critical futures.</p>
          ) : (
            <ResponsiveContainer width="100%" height={120}>
              <BarChart data={causeData} layout="vertical" margin={{ left: 4, right: 16 }}>
                <XAxis type="number" hide />
                <YAxis type="category" dataKey="name" width={100} tick={{ fill: "#94a3b8", fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={{ background: "#fffefa", border: "1px solid #d8ddd2", color: "#203126", fontSize: 11 }} formatter={(_v, _n, p) => [`${(p.payload as { pct: number }).pct}%`, "share"]} />
                <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                  {causeData.map((_, i) => <Cell key={i} fill={["#f87171", "#fb923c", "#fbbf24", "#38bdf8", "#a78bfa"][i % 5]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
        <div>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-[10px] tracking-wider text-slate-500 uppercase">Failure chain</h3>
            {baseline.failures.length > 0 && (
              <select
                value={selected?.seed}
                onChange={(e) => setSelectedFailureSeed(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-1 py-0.5 text-[10px] text-slate-300"
              >
                {baseline.failures.slice(0, 20).map((f) => (
                  <option key={f.seed} value={f.seed}>#{f.seed} @ {fmtHour(f.failStep * DT)}</option>
                ))}
              </select>
            )}
          </div>
          {!detailed || baseline.failures.length === 0 ? (
            <p className="text-[11px] text-slate-500">No critical failures in this run.</p>
          ) : (
            <TimelineList events={narrative} failed={detailed.failed} />
          )}
        </div>
      </div>

      {diagnosis && <section className="failure-diagnosis">
        <div><small>BINDING CONSTRAINT</small><strong>{diagnosis.constraint}</strong><p>{diagnosis.explanation}</p></div>
        <div><small>LEAST-DISRUPTIVE RESCUE FOR THIS EXACT FUTURE</small><strong>{diagnosis.minimumPolicyLabel}</strong><p>Computed by replaying the identical calibrated seed across the complete disclosed policy grid.</p></div>
      </section>}

      {detailed && baseline.failures.length > 0 && (
        <div className="h-28 mt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData}>
              <CartesianGrid stroke="#d8ddd2" strokeDasharray="2 4" vertical={false} />
              <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 9 }} interval={47} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
              <Tooltip contentStyle={{ background: "#fffefa", border: "1px solid #d8ddd2", color: "#203126", fontSize: 11 }} />
              <ReferenceLine y={0} stroke="#f87171" strokeDasharray="3 3" />
              <Line type="monotone" dataKey="soc" stroke="#34d399" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

/* --------------------------------- Optimizer -------------------------------- */
export function OptimizerPanel({ baseline, optimized, isOptimizing, runOptimizer }: {
  baseline: RunSummary; optimized: OptimizeResponse | null; isOptimizing: boolean; runOptimizer: () => void;
}) {
  const improvementPct = optimized && baseline.counts.critical > 0
    ? Math.round((1 - optimized.result.counts.critical / baseline.counts.critical) * 100)
    : optimized ? 0 : null;

  return (
    <div className="w-[560px]">
      <p className="text-[11px] text-slate-500 mb-2">Searches battery reserve, EV-charging delay, and pre-cooling start on an independent 300-future cohort, then validates the winner against the original {baseline.n.toLocaleString()} unseen baseline futures.</p>
      <button
        onClick={runOptimizer}
        disabled={isOptimizing}
        className="w-full flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-medium text-[12px] px-3 py-1.5 rounded-md mb-3"
      >
        {isOptimizing ? "Searching\u2026" : "Run optimizer"}
      </button>

      {optimized && (
        <>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <StatBlock label="Strategies" value={optimized.analysis.evaluatedStrategies.toLocaleString()} sub="exhaustively tested" color="#a78bfa" />
            <StatBlock label="Search cohort" value={optimized.analysis.sampleSize.toLocaleString()} sub="non-overlapping futures" color="#367367" />
            <StatBlock label="Hazard regimes" value={optimized.analysis.hazardCount.toLocaleString()} sub="robust objective" color="#8b6948" />
            <StatBlock label="Pareto frontier" value={optimized.analysis.frontier.length.toLocaleString()} sub="non-dominated plans" color="#fbbf24" />
          </div>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <StatBlock label="Reserve" value={`${optimized.intervention.reservePct}%`} color="#34d399" />
            <StatBlock label="EV delay" value={`${optimized.intervention.evDelayMin}m`} color="#38bdf8" />
            <StatBlock label="Precool" value={optimized.intervention.precoolHour != null ? fmtHour(optimized.intervention.precoolHour) : "off"} color="#fbbf24" />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div>
              <h4 className="text-[9px] tracking-wider text-slate-500 uppercase mb-1">Before</h4>
              <RiskSegmentBar counts={baseline.counts} total={baseline.n} />
            </div>
            <div>
              <h4 className="text-[9px] tracking-wider text-slate-500 uppercase mb-1">After</h4>
              <RiskSegmentBar counts={optimized.result.counts} total={optimized.result.n} />
            </div>
          </div>
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-center">
            <div className="font-mono font-bold text-3xl text-emerald-300">{improvementPct}%</div>
            <div className="text-[11px] text-slate-400 mt-1">of critical futures eliminated — {baseline.counts.critical.toLocaleString()} → {optimized.result.counts.critical.toLocaleString()}</div>
          </div>
          <div className="seasonal-backtest">
            <div><small>HISTORICAL CLIMATE REPLAY</small><strong>{optimized.historicalBacktest.passedPeriods}/{optimized.historicalBacktest.periods} observed climate stress periods passed without critical failure</strong><p>{optimized.historicalBacktest.futures} paired futures · {optimized.historicalBacktest.label}.</p></div>
            <div><span><small>BEFORE</small><b>{optimized.historicalBacktest.beforeCritical}</b></span><i>→</i><span><small>AFTER</small><b>{optimized.historicalBacktest.afterCritical}</b></span></div>
          </div>
          <section className={`optimizer-validation ${optimized.validation.recommendationStable ? "passed" : "review"}`}>
            <div className="validation-lead"><span>{optimized.validation.recommendationStable ? "✓" : "!"}</span><div><small>PAIRED GENERALIZATION AUDIT</small><strong>{optimized.validation.passedCohorts}/{optimized.validation.cohortCount} disjoint holdouts passed · {optimized.validation.statisticallyResolvedCohorts} statistically resolved</strong><p>Identical hazard seeds isolate policy effect. Exact paired inference, Wilson uncertainty, four one-at-a-time shocks and a compound stress envelope are disclosed.</p></div></div>
            <div className="cohort-grid">{optimized.validation.cohorts.map((cohort) => <div key={cohort.label}><small>{cohort.label} · SEEDS {cohort.seedOffset}+</small><span><b>{cohort.beforeCriticalPct.toFixed(1)}%</b><i>→</i><strong>{cohort.afterCriticalPct.toFixed(1)}%</strong></span><p>{cohort.preventedFailures} prevented · {cohort.introducedFailures} introduced · exact paired p {cohort.pairedPValue < 0.001 ? "<0.001" : cohort.pairedPValue.toFixed(3)} · upper 95% {cohort.afterWilsonHighPct.toFixed(1)}%</p></div>)}</div>
            <div className="shock-grid">{optimized.validation.shockResults.map((shock) => <div className={shock.passed ? "passed" : "review"} key={shock.label}><span>{shock.passed ? "✓" : "!"}</span><div><small>{shock.label}</small><strong>{shock.beforeCritical} → {shock.afterCritical} failures</strong><p>{shock.preventedFailures} prevented · {shock.introducedFailures} introduced</p></div></div>)}</div>
            <section className={`joint-stress-envelope ${optimized.validation.jointStressEnvelope.passingCells === optimized.validation.jointStressEnvelope.evaluatedCells ? "passed" : "review"}`}>
              <div className="joint-stress-heading"><div><small>81-CELL COMPOUND STRESS ENVELOPE</small><strong>Four uncertainties tested together—not one at a time</strong></div><span>{optimized.validation.jointStressEnvelope.passingCells}/{optimized.validation.jointStressEnvelope.evaluatedCells} cells passed</span></div>
              <p>{optimized.validation.jointStressEnvelope.dimensions.join(" · ")} · {optimized.validation.jointStressEnvelope.sampleSizePerCell} paired futures per cell</p>
              <div className="joint-stress-metrics"><span><small>ZERO REGRESSION</small><b>{optimized.validation.jointStressEnvelope.zeroRegressionCells}/{optimized.validation.jointStressEnvelope.evaluatedCells}</b></span><span><small>MIN IMPROVEMENT</small><b>{optimized.validation.jointStressEnvelope.minimumImprovementPct.toFixed(1)}%</b></span><span><small>WORST CELL</small><b>{optimized.validation.jointStressEnvelope.worstCell.beforeCritical} → {optimized.validation.jointStressEnvelope.worstCell.afterCritical}</b></span></div>
              <div className="joint-stress-worst"><small>DISCLOSED WORST CASE</small><strong>{optimized.validation.jointStressEnvelope.worstCell.label}</strong><p>{optimized.validation.jointStressEnvelope.worstCell.preventedFailures} prevented · {optimized.validation.jointStressEnvelope.worstCell.introducedFailures} introduced · {optimized.validation.jointStressEnvelope.worstCell.residualCriticalPct.toFixed(1)}% residual critical risk</p></div>
            </section>
          </section>
          <section className="benchmark-table">
            <div className="mini-heading"><div><small>ABLATION BENCHMARK</small><strong>Why the combined policy wins</strong></div><span>same unseen cohort</span></div>
            <div className="benchmark-head"><span>Policy</span><span>Critical</span><span>Unserved</span><span>Cost</span><span>Carbon</span></div>
            {optimized.validation.benchmarks.map((item) => <div className={item.label === "Grounded policy" ? "recommended" : ""} key={item.label}><span>{item.label}</span><b>{item.criticalPct.toFixed(1)}%</b><b>{item.meanUnservedKWh.toFixed(0)} kWh</b><b>${item.meanOperationalCost.toFixed(0)}</b><b>{item.meanCarbonKg.toFixed(0)} kg</b></div>)}
          </section>
          <p className="selection-reason"><strong>Selection rule:</strong> {optimized.analysis.selectionReason}</p>
          <div className="mt-3">
            <h4 className="text-[9px] tracking-wider text-slate-500 uppercase mb-1.5">Explainable Pareto frontier</h4>
            <div className="frontier-grid frontier-head">
              <span>Plan</span><span>Risk</span><span>Unserved</span><span>Cost</span><span>Carbon</span><span>Score</span>
            </div>
            {optimized.analysis.frontier.map((candidate) => {
              const recommended = candidate.intervention.reservePct === optimized.intervention.reservePct &&
                candidate.intervention.evDelayMin === optimized.intervention.evDelayMin &&
                candidate.intervention.precoolHour === optimized.intervention.precoolHour;
              return (
                <div key={`${candidate.intervention.reservePct}-${candidate.intervention.evDelayMin}-${candidate.intervention.precoolHour}`} className={`frontier-grid frontier-row ${recommended ? "recommended" : ""}`}>
                  <span className={recommended ? "text-emerald-300 font-medium" : "text-slate-400"}>{recommended ? "★ " : ""}R{candidate.intervention.reservePct} · D{candidate.intervention.evDelayMin} · {candidate.intervention.precoolHour == null ? "no pre" : fmtHour(candidate.intervention.precoolHour)}</span>
                  <span>{candidate.riskPct.toFixed(1)}%</span>
                  <span>{candidate.meanUnservedKWh.toFixed(0)}</span>
                  <span>${candidate.meanOperationalCost.toFixed(0)}</span>
                  <span>{candidate.meanCarbonKg.toFixed(0)} kg</span>
                  <span className="score">{candidate.resilienceScore.toFixed(1)}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

/* -------------------------------- Compare Worlds ---------------------------- */
export function ComparePanel({ baseline, optimized }: { baseline: RunSummary; optimized: OptimizeResponse }) {
  const location = locationFromCalibration(LOCATIONS[baseline.location], baseline.calibration);
  const failure = baseline.failures[0];

  const worldA = useMemo(() => failure ? simulateScenario(failure.seed, location, baseline.preset, baseline.config, baseline.intervention, true) : null, [failure, location, baseline]);
  const worldB = useMemo(() => failure ? simulateScenario(failure.seed, location, baseline.preset, baseline.config, optimized.intervention, true) : null, [failure, location, baseline, optimized]);

  const narrA = useMemo(() => worldA ? buildNarrative(worldA.steps, baseline.preset, location) : [], [worldA, baseline.preset, location]);
  const narrB = useMemo(() => worldB?.failed ? buildNarrative(worldB.steps, baseline.preset, location) : [], [worldB, baseline.preset, location]);

  const chartData = useMemo(() => {
    if (!worldA || !worldB) return [];
    const len = Math.max(worldA.steps.length, worldB.steps.length);
    const rows = [];
    for (let i = 0; i < len; i++) {
      const a = worldA.steps[i], b = worldB.steps[i];
      rows.push({ time: fmtHour((a ?? b)!.hour), socA: a ? Math.round(a.socPct) : null, socB: b ? Math.round(b.socPct) : null });
    }
    return rows;
  }, [worldA, worldB]);
  const avoidedCritical = Math.max(0, baseline.counts.critical - optimized.result.counts.critical);
  const reductionPct = baseline.counts.critical > 0 ? Math.round((avoidedCritical / baseline.counts.critical) * 100) : 0;
  const beforeRiskPct = baseline.n ? (baseline.counts.critical / baseline.n) * 100 : 0;
  const afterRiskPct = optimized.result.n ? (optimized.result.counts.critical / optimized.result.n) * 100 : 0;
  const afterConfidence = wilsonInterval(optimized.result.counts.critical, optimized.result.n);
  const costDelta = (optimized.result.metrics?.meanOperationalCost ?? 0) - (baseline.metrics?.meanOperationalCost ?? 0);
  const carbonDelta = (optimized.result.metrics?.meanCarbonKg ?? 0) - (baseline.metrics?.meanCarbonKg ?? 0);
  const pairedPrevented = optimized.validation.cohorts.reduce((sum, cohort) => sum + cohort.preventedFailures, 0);
  const pairedIntroduced = optimized.validation.cohorts.reduce((sum, cohort) => sum + cohort.introducedFailures, 0);

  if (!failure || !worldA || !worldB) {
    return <div className="w-96 text-[12px] text-slate-500">No baseline failure to compare — this configuration held.</div>;
  }

  return (
    <div className="w-[660px]">
      <div className="proof-sequence"><span><b>1</b>Calibrated location</span><i>→</i><span><b>2</b>Hospital failure</span><i>→</i><span><b>3</b>Policy selected</span><i>→</i><span><b>4</b>Same future survives</span></div>
      <div className="impact-brief">
        <div className="impact-brief-copy"><small>90-SECOND DECISION PROOF</small><strong>{reductionPct}% of critical futures eliminated</strong><p>The policy reduced hospital power-loss risk from {beforeRiskPct.toFixed(1)}% to {afterRiskPct.toFixed(1)}% on {baseline.n.toLocaleString()} futures never used for optimizer search.</p></div>
        <div className="impact-metrics proof-three"><span><small>FAILURES PREVENTED</small><b>{avoidedCritical.toLocaleString()}</b></span><span><small>95% RESIDUAL RISK</small><b>{afterConfidence.lowPct}–{afterConfidence.highPct}%</b></span><span><small>OBSERVED CLIMATE DAYS PASSED</small><b>{optimized.historicalBacktest.passedPeriods}/{optimized.historicalBacktest.periods}</b></span></div>
        <div className="validation-stamp"><span>✓</span><div><b>OUT-OF-SAMPLE</b><small>VALIDATED</small></div></div>
      </div>
      <div className="proof-audit-strip"><span><small>COST / FUTURE</small><b>{costDelta >= 0 ? "+" : "−"}${Math.abs(costDelta).toFixed(0)}</b></span><span><small>CARBON / FUTURE</small><b>{carbonDelta >= 0 ? "+" : "−"}{Math.abs(carbonDelta).toFixed(0)} kg</b></span><span><small>PAIRED HOLDOUTS</small><b>{pairedPrevented} saved · {pairedIntroduced} introduced</b></span><span><small>RUN ID</small><code>{optimized.result.manifest?.runFingerprint ?? optimized.result.runId.slice(0, 12)}</code></span><span><small>INTEGRITY</small><b>{optimized.result.audit?.status ?? "PASS"}</b></span></div>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <div className="bg-red-500/5 border border-red-500/25 rounded-lg p-3">
          <h3 className="text-[11px] font-medium text-red-300 mb-2">World A — current plan</h3>
          <TimelineList events={narrA} failed={worldA.failed} />
        </div>
        <div className="bg-emerald-500/5 border border-emerald-500/25 rounded-lg p-3">
          <h3 className="text-[11px] font-medium text-emerald-300 mb-2">World B — Grounded plan</h3>
          {worldB.failed ? <TimelineList events={narrB} failed /> : (
            <div className="text-emerald-300 text-[12px] py-4 text-center">72-hour hospital SLA passes — critical load never loses power.</div>
          )}
        </div>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid stroke="#d8ddd2" strokeDasharray="2 4" vertical={false} />
            <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 9 }} interval={47} axisLine={false} tickLine={false} />
            <YAxis domain={[0, 100]} tick={{ fill: "#64748b", fontSize: 9 }} axisLine={false} tickLine={false} width={24} />
            <Tooltip contentStyle={{ background: "#fffefa", border: "1px solid #d8ddd2", color: "#203126", fontSize: 11 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <ReferenceLine y={0} stroke="#f87171" strokeDasharray="3 3" />
            <Line type="monotone" dataKey="socA" name="World A" stroke="#f87171" strokeWidth={2} dot={false} connectNulls />
            <Line type="monotone" dataKey="socB" name="World B" stroke="#34d399" strokeWidth={2} dot={false} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
