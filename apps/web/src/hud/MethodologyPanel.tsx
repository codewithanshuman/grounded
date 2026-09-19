const sources = [
  {
    name: "NASA POWER",
    tag: "CLIMATE REFERENCE",
    description: "Supplies the climatology and dated historical solar and meteorological observations used by Grounded's climate calibration.",
    href: "https://power.larc.nasa.gov/docs/services/api/temporal/hourly/",
  },
  {
    name: "NREL PVWatts",
    tag: "PV PHYSICS",
    description: "Reference methodology for irradiance-to-power conversion and temperature-related photovoltaic performance.",
    href: "https://pvwatts.nrel.gov/downloads/pvwattsv5.pdf",
  },
  {
    name: "WHO · World Bank · IRENA",
    tag: "PROBLEM EVIDENCE",
    description: "Global evidence on reliable, modern electricity for climate-resilient health-care facilities.",
    href: "https://www.who.int/publications/i/item/9789240066960",
  },
];

export function MethodologyPanel({ calibration, siteData, locationLabel, latestRun, onCommission }: { calibration: ClimateCalibration | null; siteData?: SiteDataProfile | null; locationLabel: string; latestRun?: RunSummary | null; onCommission: (input: CommissionSiteInput) => Promise<SiteDataProfile> }) {
  return (
    <div className="methodology">
      <section className="model-card-hero">
        <div><small>MODEL CARD · ENGINE 2.6</small><h4>Transparent enough to challenge.</h4><p>Grounded is a data-calibrated decision-support prototype, not a certified engineering design tool. Every result comes from executable energy physics, measured operational profiles, correlated hazards and seeded uncertainty; every simplification is disclosed below.</p></div>
        <div className="model-card-seal"><span>{latestRun?.audit?.status === "PASS" ? "✓" : "·"}</span><strong>{latestRun?.audit?.status === "PASS" ? "Audited" : calibration?.source === "NASA_POWER" ? "Calibrated" : "Auditable"}</strong><small>{latestRun?.audit?.status ?? calibration?.status?.toUpperCase() ?? "LOADING"}</small></div>
      </section>

      <section className="evidence-partition">
        <div><small>OBSERVED</small><strong>Climate + operational meters</strong><p>NASA POWER climate plus measured demand, PV production and regulated network reliability history.</p></div>
        <div><small>INFERRED</small><strong>Engineering parameters</strong><p>PV temperature response, load profiles, storage losses and operational costs.</p></div>
        <div><small>SIMULATED</small><strong>Future operating conditions</strong><p>Outage occurrence, restoration, demand coincidence and compound-event severity.</p></div>
      </section>

      {siteData && <section className="method-section site-data-card">
        <div className="method-heading"><span>↯</span><div><small>MEASURED OPERATIONAL LAYER</small><h4>{siteData.label}</h4></div><code>{siteData.fingerprint}</code></div>
        <div className="site-data-verdict"><div><small>QUALITY GATE</small><strong>{siteData.status.replaceAll("_", " ")}</strong><p>{siteData.disclosure}</p></div><span><small>DEMAND COMPLETENESS</small><b>{siteData.quality.demandCompletenessPct.toFixed(1)}%</b></span><span><small>PV COMPLETENESS</small><b>{siteData.quality.pvCompletenessPct.toFixed(1)}%</b></span><span><small>OUTAGE HISTORY</small><b>{siteData.reliability.eventCount?.toLocaleString() ?? "ANNUAL"}</b></span></div>
        {siteData.reliability.eventCount && <p className="site-outage-proof"><strong>Observed restoration distribution</strong><span>{siteData.reliability.eventCount.toLocaleString()} events · median {siteData.reliability.medianRestorationHours?.toFixed(2)} h · P90 {siteData.reliability.p90RestorationHours?.toFixed(2)} h · P95 {siteData.reliability.p95RestorationHours?.toFixed(2)} h</span></p>}
        <div className="site-source-grid">{siteData.sources.map((source) => source.url ? <a href={source.url} target="_blank" rel="noreferrer" key={`${source.kind}-${source.url}`}><small>{source.kind} · {source.measured ? "MEASURED" : "MODELED"}</small><strong>{source.authority}</strong><p>{source.title}</p><span>{source.period} · {source.nativeResolutionMinutes ? `${source.nativeResolutionMinutes}-minute native` : source.title.includes("SAIDI") ? "annual audited indices" : "event-level history"}</span></a> : <div key={`${source.kind}-${source.fileName}`}><small>{source.kind} · COMMISSIONED FILE</small><strong>{source.authority}</strong><p>{source.title}</p><span>{source.fileName} · {source.period}</span></div>)}</div>
        <div className="profile-strip"><div><small>15-MINUTE DEMAND SHAPE</small><span>{siteData.demand.multiplier15m.map((value, index) => <i key={index} style={{ height: `${Math.max(4, Math.min(100, value / Math.max(...siteData.demand.multiplier15m) * 100))}%` }} />)}</span></div><div><small>MEASURED PV CAPACITY FACTOR</small><span>{siteData.pv.capacityFactor15m.map((value, index) => <i key={index} style={{ height: `${Math.max(4, value * 100)}%` }} />)}</span></div></div>
        {siteData.validation && <div className={`holdout-proof ${siteData.validation.status.toLowerCase()}`}><div><small>OUT-OF-SAMPLE VALIDATION</small><strong>{siteData.validation.status}</strong><p>{siteData.validation.method}</p></div><span><small>DEMAND HOLDOUT</small><b>{siteData.validation.demand.maePct.toFixed(2)}%</b><em>MAE · {siteData.validation.demand.holdoutDays} days</em></span><span><small>PV HOLDOUT</small><b>{siteData.validation.pv.maeCapacityFactor.toFixed(3)}</b><em>capacity-factor MAE</em></span><span><small>OUTAGE HOLDOUT</small><b>{siteData.validation.outage.ksStatistic.toFixed(3)}</b><em>KS drift · {siteData.validation.outage.holdoutEvents.toLocaleString()} events</em></span></div>}
      </section>}

      <section className="method-section jaipur-anchor-card">
        <div className="method-heading"><span>RJ</span><div><small>REAL JAIPUR FACILITY ANCHOR</small><h4>{jaipurFacilityEvidence.label}</h4></div><a href={jaipurFacilityEvidence.source.url} target="_blank" rel="noreferrer">OPEN SOURCE ↗</a></div>
        <div className="jaipur-anchor-summary">
          <div><small>PUBLISHED EVIDENCE STATUS</small><strong>FIELD-ASSESSED SITE</strong><p>{jaipurFacilityEvidence.evidenceBasis}</p></div>
          <span><small>ON-GRID SOLAR</small><b>{jaipurFacilityEvidence.solarCapacityKWp} kWp</b><em>installed capacity</em></span>
          <span><small>REPORTED DEMAND SHARE</small><b>≈{jaipurFacilityEvidence.reportedSolarDemandSharePct}%</b><em>hospital representative</em></span>
          <span><small>MONTHLY BILL</small><b>₹{(jaipurFacilityEvidence.monthlyBillBeforeINR / 1000).toFixed(0)}k → ₹{(jaipurFacilityEvidence.monthlyBillAfterINR / 1000).toFixed(0)}k</b><em>reported before / after</em></span>
        </div>
        <div className="jaipur-evidence-boundary"><div><small>WHAT THIS PROVES</small><p>A real Jaipur public-health site has a documented solar intervention, operational stakeholder evidence and material reported cost reduction.</p></div><div><small>WHAT REMAINS TO COMMISSION</small><p>{jaipurFacilityEvidence.commissioningRequest.join(" · ")}</p></div></div>
        <div className="collaboration-status"><span>OUTREACH READY</span><p><strong>No partnership is claimed yet.</strong> The field packet targets the hospital operations team and Aavas Foundation for data permission, boundary confirmation and a named reviewer.</p><code>PAGES {jaipurFacilityEvidence.source.pages.join(" · ")}</code></div>
      </section>

      <SiteCommissionPanel onCommission={onCommission} />

      {latestRun?.audit && latestRun.manifest && <section className="method-section audit-ledger">
        <div className="method-heading"><span>✓</span><div><small>LATEST RUN AUDIT</small><h4>{latestRun.audit.checks.filter((check) => check.passed).length}/{latestRun.audit.checks.length} machine checks passed</h4></div><code>{latestRun.manifest.runFingerprint}</code></div>
        <div>{latestRun.audit.checks.map((check) => <p key={check.id} className={check.passed ? "passed" : "review"}><span>{check.passed ? "✓" : "!"}</span><strong>{check.label}</strong><small>{check.value}</small></p>)}</div>
      </section>}

      <div className="method-grid">
        <section className="method-section">
          <div className="method-heading"><span>01</span><div><small>EVIDENCE CHAIN</small><h4>How a claim becomes proof</h4></div></div>
          <ol className="evidence-chain">
            <li><b>Define</b><span>Hospital, homes, PV, battery and grid constraints</span></li>
            <li><b>Stress</b><span>Correlated 72-hour heat, cloud, demand and outage futures</span></li>
            <li><b>Explain</b><span>Exact causal timeline for each critical failure</span></li>
            <li><b>Validate</b><span>Recommended strategy replayed on unseen futures</span></li>
          </ol>
        </section>

        <section className="method-section">
          <div className="method-heading"><span>02</span><div><small>STATISTICAL DESIGN</small><h4>Built to resist lucky results</h4></div></div>
          <div className="validation-list">
            <p><strong>Deterministic seeds</strong><span>Identical inputs always reproduce identical outcomes.</span></p>
            <p><strong>Paired comparisons</strong><span>Before and after worlds share the same hazard seeds.</span></p>
            <p><strong>Independent search cohort</strong><span>245 strategies train on 300 non-overlapping futures across five hazards.</span></p>
            <p><strong>Three disjoint holdouts</strong><span>The selected policy must improve all three unseen seeded cohorts.</span></p>
            <p><strong>Exact paired inference</strong><span>McNemar's exact test measures whether prevented failures outweigh newly introduced failures without a normal approximation.</span></p>
            <p><strong>81-cell compound envelope</strong><span>Restoration, demand, solar and starting SOC are varied together in a full-factorial audit; the worst cell stays visible.</span></p>
            <p><strong>95% Wilson interval</strong><span>Risk reports include sampling uncertainty, even near 0%.</span></p>
            <p><strong>Reliability depth</strong><span>LOLP, LOLE, EENS and CVaR95 separate frequency, duration, energy severity and tail risk.</span></p>
            <p><strong>Carbon-aware Pareto search</strong><span>Grid carbon joins risk, unserved energy, cost and disruption in dominance testing.</span></p>
            <p><strong>Interpretable ML audit</strong><span>A regularized surrogate explains simulator failures on an untouched seed holdout; it never controls dispatch or recommendations.</span></p>
          </div>
        </section>
      </div>

      <section className="method-section source-section">
        <div className="method-heading"><span>03</span><div><small>PROVENANCE</small><h4>Authoritative reference layer</h4></div></div>
        {calibration && <><div className="calibration-card"><div><small>ACTIVE CLIMATE FINGERPRINT</small><strong>{locationLabel}</strong><span>{calibration.latitude.toFixed(4)}°, {calibration.longitude.toFixed(4)}° · {calibration.period}</span></div><div><small>MEAN TEMPERATURE</small><b>{calibration.meanTempC.toFixed(1)}°C</b></div><div><small>MAX TEMPERATURE</small><b>{calibration.maxTempC.toFixed(1)}°C</b></div><div><small>SOLAR RESOURCE</small><b>{calibration.solarKWhM2Day.toFixed(2)}</b><span>kWh/m²/day</span></div><code>{calibration.fingerprint}</code></div>{calibration.quality && <div className="calibration-quality"><span><small>MONTH COVERAGE</small><b>{calibration.quality.coverageMonths}/12</b></span><span><small>DATED STRESS PERIODS</small><b>{calibration.quality.historicalPeriods}</b></span><span><small>FIELD COMPLETENESS</small><b>{calibration.quality.fieldCompletenessPct.toFixed(1)}%</b></span><span><small>INPUT STATUS</small><b>{calibration.quality.status.toUpperCase()}</b></span></div>}<div className="climate-profile"><div><small>12-MONTH CALIBRATION PROFILE</small><strong>Solar resource and mean temperature</strong></div><div>{calibration.monthly.map((month) => <span key={month.month} title={`${month.month}: ${month.solarKWhM2Day.toFixed(2)} kWh/m²/day, ${month.meanTempC.toFixed(1)}°C`}><i style={{ height: `${Math.max(12, month.solarKWhM2Day / 8 * 100)}%` }} /><b>{month.month.slice(0, 1)}</b><small>{Math.round(month.meanTempC)}°</small></span>)}</div></div></>}
        <div className="source-grid">
          {sources.map((source) => <a key={source.name} href={source.href} target="_blank" rel="noreferrer"><small>{source.tag}</small><strong>{source.name}<span>↗</span></strong><p>{source.description}</p></a>)}
        </div>
        <p className="source-disclosure"><strong>Calibration status:</strong> {calibration?.source === "NASA_POWER" ? "climate distributions are calibrated from NASA POWER climatology and cached for reproducible/offline demonstrations." : "the safe fallback uses a disclosed representative climatology because NASA POWER was unavailable."} {siteData ? "The selected operational layer uses measured public-network demand, PV and outage/restoration history; it is a verified reference cohort, not local Jaipur commissioning data." : "Operational demand, PV and outage behavior use disclosed representative engineering profiles."} Procurement still requires local meter exports and engineering review.</p>
      </section>

      <section className="method-section assumptions-section">
        <div className="method-heading"><span>04</span><div><small>ASSUMPTIONS LEDGER</small><h4>What the model does—and does not—claim</h4></div></div>
        <div className="assumption-table">
          <div><span>Time model</span><b>72 hours · 288 × 15-minute steps</b><small>Battery state and compound hazards carry across three days</small></div>
          <div><span>Dispatch</span><b>Critical load receives first priority</b><small>Solar → grid → battery; flexible demand can be shed</small></div>
          <div><span>Uncertainty</span><b>Correlated cloud, heat, outage and demand</b><small>Seeded severity and restoration-duration distributions</small></div>
          <div><span>Renewable accounting</span><b>Solar provenance follows storage</b><small>Direct solar and solar-charged discharge count; starting SOC receives no renewable credit</small></div>
          <div><span>Environmental boundary</span><b>Operational grid carbon only</b><small>No embodied carbon, lifecycle assessment or carbon-offset claim</small></div>
          <div><span>Machine-learning boundary</span><b>Diagnostic surrogate only</b><small>Holdout metrics describe simulator fidelity, not future real-world accuracy or causality</small></div>
          <div><span>Boundary</span><b>No AC power-flow or component failure network</b><small>Requires engineering review before real procurement</small></div>
        </div>
      </section>
    </div>
  );
}
import type { ClimateCalibration, RunSummary, SiteDataProfile } from "@verdant/protocol";
import type { CommissionSiteInput } from "../ws/client";
import { SiteCommissionPanel } from "./SiteCommissionPanel";
import jaipurFacilityEvidence from "../../../../data/jaipur-sms-hospital-public-evidence.json";
