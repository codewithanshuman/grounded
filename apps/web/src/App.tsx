import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { ClimateCalibration, ClimateSweepResult, LocationId, MicrogridConfig, PresetId, RunSummary, SiteDataProfile } from "@verdant/protocol";
import { LOCATIONS, PRESETS, DEFAULT_CONFIG } from "@verdant/sim";
import { useVerdant, type CommissionSiteInput, type OptimizeResponse } from "./ws/client";
import { TwinPanel, StressPanel } from "./hud/ControlPanels";
import logoUrl from "../../../assets/logo-ui.png";
import canopyUrl from "../../../assets/forest-canopy-ui.webp";
import fieldHomeUrl from "../../../assets/grounded-field-home.png";
import monsoonUrl from "../../../assets/grounded-monsoon.png";
import cloverSkyUrl from "../../../assets/grounded-clover-sky.png";
import cloverStudioUrl from "../../../assets/grounded-clover-studio.png";
import "./fonts.css";
import "./depth-upgrade.css";
import "./proof-path.css";

type ViewId = "overview" | "matrix" | "risk" | "optimizer" | "compare" | "method";

const WORKSPACE_META: Record<ViewId, { description: string; glyph: string }> = {
  overview: { description: "Configure the system and expose it to a calibrated future.", glyph: "◫" },
  matrix: { description: "Compare performance across every modeled climate regime.", glyph: "⌗" },
  risk: { description: "Trace the exact timestep and mechanism behind each failure.", glyph: "△" },
  optimizer: { description: "Search for the smallest intervention that survives holdouts.", glyph: "◇" },
  compare: { description: "Replay identical futures to isolate intervention impact.", glyph: "≋" },
  method: { description: "Inspect sources, assumptions, validation and model limits.", glyph: "◎" },
};

const WORKSPACE_ART: Record<ViewId, { url: string; position: string }> = {
  overview: { url: fieldHomeUrl, position: "center 70%" },
  matrix: { url: monsoonUrl, position: "center 66%" },
  risk: { url: monsoonUrl, position: "center 72%" },
  optimizer: { url: cloverSkyUrl, position: "center 54%" },
  compare: { url: cloverSkyUrl, position: "center 59%" },
  method: { url: cloverStudioUrl, position: "center 52%" },
};

const GameCanvas = lazy(() => import("./game/GameCanvas").then((module) => ({ default: module.GameCanvas })));
const ClimateMatrixPanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.ClimateMatrixPanel })));
const RiskPanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.RiskPanel })));
const OptimizerPanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.OptimizerPanel })));
const ComparePanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.ComparePanel })));
const MethodologyPanel = lazy(() => import("./hud/MethodologyPanel").then((module) => ({ default: module.MethodologyPanel })));

const WorkspaceFallback = () => <div className="workspace-fallback"><i /><span>Loading verified workspace…</span></div>;

export default function App() {
  const { connected, world, growthLog, simulate, optimize, runClimateSweep, getCalibration, getSiteDataProfiles, commissionSite, executionMode } = useVerdant();

  const [locationId, setLocationId] = useState<LocationId>("jaipur");
  const [preset, setPreset] = useState<PresetId>("normal");
  const [config, setConfig] = useState<MicrogridConfig>(DEFAULT_CONFIG);
  const [scenarioCount, setScenarioCount] = useState(2000);
  const [siteDataProfiles, setSiteDataProfiles] = useState<SiteDataProfile[]>([]);
  const [siteDataProfileId, setSiteDataProfileId] = useState("ausgrid-measured-reference-v1");

  const [baseline, setBaseline] = useState<RunSummary | null>(null);
  const [optimized, setOptimized] = useState<OptimizeResponse | null>(null);
  const [selectedFailureSeed, setSelectedFailureSeed] = useState<number | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [climateSweep, setClimateSweep] = useState<ClimateSweepResult | null>(null);
  const [calibration, setCalibration] = useState<ClimateCalibration | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);

  const [activeView, setActiveView] = useState<ViewId>("overview");
  const isRunning = isSimulating || isOptimizing || isSweeping;

  const setConfigField = (key: keyof MicrogridConfig) => (val: number) => setConfig((c) => ({ ...c, [key]: val }));

  const runSimulation = useCallback(async () => {
    setIsSimulating(true);
    setOperationError(null);
    setOptimized(null);
    try {
      const { summary } = await simulate(locationId, preset, config, scenarioCount, siteDataProfileId);
      setBaseline(summary);
      setSelectedFailureSeed(summary.failures[0]?.seed ?? null);
      setActiveView("risk");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Simulation could not be completed.");
    } finally {
      setIsSimulating(false);
    }
  }, [simulate, locationId, preset, config, scenarioCount, siteDataProfileId]);

  const runOptimizer = useCallback(async () => {
    if (!baseline) return;
    setIsOptimizing(true);
    setOperationError(null);
    try {
      const result = await optimize(baseline.runId);
      setOptimized(result);
      setActiveView("compare");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Optimization could not be completed.");
    } finally {
      setIsOptimizing(false);
    }
  }, [optimize, baseline]);

  const runAllHazards = useCallback(async () => {
    setIsSweeping(true);
    setOperationError(null);
    try {
      const result = await runClimateSweep(locationId, config, 500, siteDataProfileId);
      setClimateSweep(result);
      setActiveView("matrix");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Climate matrix could not be completed.");
    } finally {
      setIsSweeping(false);
    }
  }, [runClimateSweep, locationId, config, siteDataProfileId]);

  // most-recent growth message, shown as a toast for a few seconds
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => {
    if (growthLog.length === 0) return;
    setToast(growthLog[growthLog.length - 1].message);
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [growthLog]);

  useEffect(() => {
    let cancelled = false;
    setCalibration(null);
    getCalibration(locationId).then((result) => { if (!cancelled) setCalibration(result); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [getCalibration, locationId]);

  useEffect(() => {
    let cancelled = false;
    getSiteDataProfiles().then((result) => { if (!cancelled) setSiteDataProfiles(result.profiles); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [getSiteDataProfiles]);

  // Evidence is valid only for the exact blueprint and hazard that produced
  // it. Editing an input invalidates stale results instead of silently showing
  // a report for a different system.
  useEffect(() => {
    setBaseline(null);
    setOptimized(null);
    setSelectedFailureSeed(null);
    setClimateSweep(null);
    setOperationError(null);
  }, [locationId, preset, config, siteDataProfileId]);

  const activeSiteData = siteDataProfiles.find((profile) => profile.id === siteDataProfileId) ?? null;
  const operationalDataLabel = activeSiteData?.scope === "COMMISSIONED_SITE"
    ? `Measured · ${activeSiteData.status === "VERIFIED_SITE" ? "commissioned site" : "quality review"}`
    : activeSiteData ? "Measured · NSW reference" : "Representative profiles";
  const environmentLabel = activeSiteData?.scope === "PUBLIC_REFERENCE"
    ? `${LOCATIONS[locationId].label} climate × NSW operations`
    : activeSiteData?.scope === "COMMISSIONED_SITE" ? `${LOCATIONS[locationId].label} · commissioned operations` : LOCATIONS[locationId].label;
  const handleCommission = useCallback(async (input: CommissionSiteInput) => {
    const profile = await commissionSite(input);
    setSiteDataProfiles((profiles) => [...profiles.filter((item) => item.id !== profile.id), profile]);
    setSiteDataProfileId(profile.id);
    setOperationError(null);
    setActiveView("method");
    return profile;
  }, [commissionSite]);

  const workspaces: Array<{ id: ViewId; label: string; index: string }> = [
    { id: "overview", label: "Living twin", index: "01" },
    { id: "matrix", label: "Climate matrix", index: "02" },
    { id: "risk", label: "Risk evidence", index: "03" },
    { id: "optimizer", label: "Strategy", index: "04" },
    { id: "compare", label: "Proof", index: "05" },
    { id: "method", label: "Method", index: "06" },
  ];
  const activeArtwork = WORKSPACE_ART[activeView];

  return (
    <div className={`lab-shell view-${activeView} ${isRunning ? "is-processing" : ""}`}>
      <header className="lab-header">
        <div className="lab-brand">
          <span className="brand-mark"><img src={logoUrl} alt="" /></span>
          <div><small>FIELD INTELLIGENCE</small><strong>Grounded</strong><span>Climate resilience laboratory</span></div>
        </div>
        <nav className="lab-nav" aria-label="Analysis workspaces">
          {workspaces.map(({ id, label, index }) => (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              disabled={id === "matrix" && !climateSweep || (id === "risk" || id === "optimizer") && !baseline || id === "compare" && !optimized}
              aria-current={activeView === id ? "page" : undefined}
              aria-label={label}
              className={activeView === id ? "active" : ""}
            ><span aria-hidden="true">{index}</span><i aria-hidden="true">{WORKSPACE_META[id].glyph}</i><strong>{label}</strong></button>
          ))}
        </nav>
        <div className="lab-status">
          <span className={connected ? "status-dot connected" : "status-dot"} />
          <div><small>{executionMode.toUpperCase()}</small><strong>{connected ? "Systems online" : "Reconnecting"}</strong></div>
        </div>
      </header>

      <main className="lab-layout">
        <aside className="model-rail">
          <div className="rail-topline"><span>CONFIGURATION DECK</span><b><i /> LIVE MODEL</b></div>
          <div className="rail-heading"><span>01</span><div><small>SYSTEM BLUEPRINT</small><h2>Build the microgrid</h2></div></div>
          <p className="rail-intro">Describe the energy system the community depends on. Every value directly changes the simulation.</p>
          <div className="rail-summary" aria-label="Microgrid configuration summary">
            <span><small>PV ARRAY</small><strong>{config.solarCapacityKW.toLocaleString()}</strong><em>kW</em></span>
            <span><small>STORAGE</small><strong>{config.batteryCapacityKWh.toLocaleString()}</strong><em>kWh</em></span>
            <span><small>CRITICAL</small><strong>{config.hospitalKW.toLocaleString()}</strong><em>kW</em></span>
          </div>
          <div className="panel-surface twin-controls"><TwinPanel config={config} setConfigField={setConfigField} locationId={locationId} /></div>
          <div className="rail-note"><span>i</span><p><strong>Critical load comes first.</strong> The hospital always claims available solar, grid power and battery reserve before flexible demand.</p></div>
        </aside>

        <section className="lab-content">
          <div className="field-banner">
            <div className="hero-artwork" aria-hidden="true" style={{ backgroundImage: `url(${activeArtwork.url})`, backgroundPosition: activeArtwork.position }}>
              <div className="hero-artwork-caption"><span>ILLUSTRATIVE FIELD ARTWORK</span><b>{workspaces.find((item) => item.id === activeView)?.index} / 06</b></div>
            </div>
            <div className="hero-grid" aria-hidden="true" />
            <div className="field-banner-copy">
              <div className="hero-kicker"><i /> GROUNDED FIELD LAB <span>/</span> {environmentLabel.toUpperCase()}</div>
              <h1><span>Test tomorrow</span><br />before it arrives.</h1>
              <p>Explore thousands of climate futures, expose the precise point of failure, and prove which intervention survives.</p>
              <div className="hero-trust"><span>Deterministic</span><span>Auditable</span><span>Site-aware</span></div>
            </div>
            <div className="field-banner-evidence">
              <div className="evidence-console-head"><span><i /> LIVE EVIDENCE CONSOLE</span><b>MODEL 01</b></div>
              <div className="field-banner-stats">
                <span><i>01</i><small>ACTIVE HAZARD</small><strong>{PRESETS[preset].label}</strong></span>
                <span><i>02</i><small>MODEL DEPTH</small><strong>72 hours · 15-minute steps</strong></span>
                <span><i>03</i><small>CLIMATE CALIBRATION</small><strong>{calibration ? `${calibration.source === "NASA_POWER" ? "NASA POWER" : "Reference"} · ${calibration.status}` : "Loading provenance…"}</strong></span>
                <span><i>04</i><small>OPERATIONAL DATA</small><strong>{operationalDataLabel}</strong></span>
              </div>
              <div className="evidence-console-foot"><span>ILLUSTRATIVE FIELD ARTWORK</span><strong>72H / Δ15M</strong></div>
            </div>
          </div>

          <div className="workspace-toolbar">
            <div className="workspace-title"><span>{workspaces.find((item) => item.id === activeView)?.index}</span><div><small>ACTIVE DECISION WORKSPACE</small><h2>{workspaces.find((item) => item.id === activeView)?.label}</h2><p>{WORKSPACE_META[activeView].description}</p></div></div>
            <div className="run-controls">
              <label><span>Region</span><select value={locationId} onChange={(e) => setLocationId(e.target.value as LocationId)}>{Object.values(LOCATIONS).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
              <label><span>Population</span><select value={scenarioCount} onChange={(e) => setScenarioCount(Number(e.target.value))}>{[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()} futures</option>)}</select></label>
              <label><span>Site data</span><select value={siteDataProfileId} onChange={(e) => setSiteDataProfileId(e.target.value)}><option value="representative-model">Representative model</option>{siteDataProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
              <button onClick={runSimulation} disabled={isSimulating} className="run-button"><span>{isSimulating ? "◌" : "→"}</span><div><small>{isSimulating ? "CALCULATING" : "RUN SIMULATION"}</small>{isSimulating ? "Exploring futures…" : `Explore ${scenarioCount.toLocaleString()} futures`}</div></button>
            </div>
          </div>
          <nav className="proof-path" aria-label="Judge proof path">
            <span><small>GUIDED PROOF PATH</small><strong>From stress to verified decision</strong></span>
            <button onClick={() => setActiveView("overview")} className={baseline ? "done" : activeView === "overview" ? "active" : ""}><b>1</b><span>Stress<small>Choose the hazard</small></span></button>
            <button onClick={() => setActiveView("risk")} disabled={!baseline} className={baseline ? "done" : ""}><b>2</b><span>Diagnose<small>Explain the failure</small></span></button>
            <button onClick={() => setActiveView("optimizer")} disabled={!baseline} className={optimized ? "done" : baseline && activeView === "optimizer" ? "active" : ""}><b>3</b><span>Optimize<small>Search + holdouts</small></span></button>
            <button onClick={() => setActiveView("compare")} disabled={!optimized} className={optimized ? "done" : ""}><b>4</b><span>Prove<small>Replay same seed</small></span></button>
            <button onClick={() => setActiveView("method")} className={activeSiteData?.validation?.status === "PASS" ? "done" : activeView === "method" ? "active" : ""}><b>5</b><span>Audit<small>Sources + limits</small></span></button>
          </nav>
          {operationError && <div className="operation-error" role="alert"><span>!</span><div><strong>Analysis interrupted</strong><p>{operationError} Check that the simulation server is running, then retry—the previous verified evidence was not overwritten.</p></div><button onClick={() => setOperationError(null)} aria-label="Dismiss error">×</button></div>}
          {isRunning && <div className="analysis-progress" role="status"><i /><span><strong>{isOptimizing ? "Validating strategy" : isSweeping ? "Stress-testing every hazard" : "Exploring calibrated futures"}</strong><small>{isOptimizing ? "245 strategies · 3 holdouts · 4 assumption shocks" : "Deterministic 72-hour dispatch is running"}</small></span></div>}

          {activeView === "overview" && (
            <div className="overview-grid">
              <section className="world-card">
                <div className="card-heading"><div><small>LIVE SYSTEM VIEW</small><h3>Resilience forest</h3></div><span className="verified-pill">Persistent evidence</span></div>
                <div className="light-world"><Suspense fallback={<WorkspaceFallback />}><GameCanvas world={world} pendingGrowth={growthLog} /></Suspense></div>
                <div className="world-caption"><p>Drag to explore · scroll to zoom</p>{world && <div><span><b>{world.trees.length}</b> verified trees</span><span><b>{world.buildings.length}</b> resilience buildings</span><span><b>{world.totalRuns}</b> completed runs</span></div>}</div>
              </section>
              <aside className="hazard-column">
                <section className="hazard-card"><div className="card-heading"><div><small>02 · CLIMATE PRESSURE</small><h3>Choose a hazard</h3></div></div><div className="panel-surface"><StressPanel preset={preset} setPreset={setPreset} isSweeping={isSweeping} runClimateSweep={runAllHazards} /></div></section>
                <section className="canopy-card" style={{ backgroundImage: `url(${canopyUrl})` }}><div><small>EVIDENCE, NOT PROMISES</small><p>Every tree appears only after a completed, reproducible simulation.</p></div></section>
              </aside>
            </div>
          )}

          <Suspense fallback={<WorkspaceFallback />}>
            {activeView === "matrix" && climateSweep && <section className="analysis-card"><div className="analysis-heading"><div><small>MULTI-HAZARD VALIDATION</small><h3>Climate resilience matrix</h3></div><p>Five climate regimes. Identical seeds. One honest worst-case score.</p></div><div className="panel-surface analysis-body"><ClimateMatrixPanel sweep={climateSweep} /></div></section>}
            {activeView === "risk" && baseline && <section className="analysis-card"><div className="analysis-heading"><div><small>CAUSAL FORENSICS</small><h3>Where the system breaks</h3></div><button className="next-step" onClick={() => setActiveView("optimizer")}>Find a resilient strategy →</button></div><div className="panel-surface analysis-body"><RiskPanel baseline={baseline} selectedFailureSeed={selectedFailureSeed} setSelectedFailureSeed={setSelectedFailureSeed} /></div></section>}
            {activeView === "optimizer" && baseline && <section className="analysis-card"><div className="analysis-heading"><div><small>DECISION INTELLIGENCE</small><h3>Smallest effective intervention</h3></div><p>245 strategies searched across five hazards, then validated on three disjoint holdouts and four assumption shocks.</p></div><div className="panel-surface analysis-body"><OptimizerPanel baseline={baseline} optimized={optimized} isOptimizing={isOptimizing} runOptimizer={runOptimizer} /></div></section>}
            {activeView === "compare" && baseline && optimized && <section className="analysis-card"><div className="analysis-heading"><div><small>COUNTERFACTUAL PROOF</small><h3>Same future. Better outcome.</h3></div><p>Only the intervention changes between these two calibrated worlds.</p></div><div className="panel-surface analysis-body"><ComparePanel baseline={baseline} optimized={optimized} /></div></section>}
            {activeView === "method" && <section className="analysis-card"><div className="analysis-heading"><div><small>SCIENTIFIC TRANSPARENCY</small><h3>Evidence &amp; methodology</h3></div><p>Sources, uncertainty, validation design and model boundaries—open for inspection.</p></div><div className="panel-surface analysis-body"><MethodologyPanel calibration={calibration} siteData={baseline?.siteData ?? activeSiteData} locationLabel={LOCATIONS[locationId].label} latestRun={optimized?.result ?? baseline} onCommission={handleCommission} /></div></section>}
          </Suspense>
        </section>
      </main>

      <footer className="evidence-bar"><span className="evidence-label"><i /> EVIDENCE LEDGER</span>{world ? <div className="evidence-values"><span><b>{world.totalFuturesSimulated.toLocaleString()}</b> futures simulated</span><span><b>{world.trees.length}</b> trees earned</span><span><b>{world.buildings.length}</b> buildings grown</span></div> : <span>Connecting to the persistent forest…</span>}<span className="evidence-proof">DETERMINISTIC · REPRODUCIBLE · EXPLAINABLE</span></footer>
      {toast && <div className="light-toast"><span>✓</span><div><small>VERIFIED GROWTH</small>{toast}</div></div>}
    </div>
  );
}
