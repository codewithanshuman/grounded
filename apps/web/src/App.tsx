import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from "react";
import type { ClimateCalibration, ClimateSweepResult, LocationId, MicrogridConfig, PresetId, RunSummary, SiteDataProfile } from "@verdant/protocol";
import { LOCATIONS, PRESETS, DEFAULT_CONFIG } from "@verdant/sim";
import { useVerdant, type CommissionSiteInput, type OptimizeResponse } from "./ws/client";
import { TwinPanel, StressPanel } from "./hud/ControlPanels";
import logoUrl from "../../../assets/logo.png";
import canopyUrl from "../../../assets/forest-canopy-ui.webp";
import { IdentityDialog } from "./auth/IdentityDialog";
import { completePendingFounding, pendingFoundingFor } from "./auth/localIdentity";
import { useIdentitySession } from "./auth/useIdentitySession";
import { LandingPage } from "./landing/LandingPage";
import "./fonts.css";
import "./depth-upgrade.css";
import "./proof-path.css";
import "./identity.css";
import "./dashboard-shell.css";
import type { ForestActivity, ForestInspection } from "./game/GameCanvas";

type ViewId = "overview" | "matrix" | "risk" | "optimizer" | "compare" | "method";

const WORKSPACE_META: Record<ViewId, { description: string }> = {
  overview: { description: "Configure the system and expose it to a calibrated future." },
  matrix: { description: "Compare performance across every modeled climate regime." },
  risk: { description: "Trace the exact timestep and mechanism behind each failure." },
  optimizer: { description: "Search for the smallest intervention that survives holdouts." },
  compare: { description: "Replay identical futures to isolate intervention impact." },
  method: { description: "Inspect sources, assumptions, validation and model limits." },
};

const GameCanvas = lazy(() => import("./game/GameCanvas").then((module) => ({ default: module.GameCanvas })));
const ClimateMatrixPanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.ClimateMatrixPanel })));
const RiskPanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.RiskPanel })));
const OptimizerPanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.OptimizerPanel })));
const ComparePanel = lazy(() => import("./hud/Panels").then((module) => ({ default: module.ComparePanel })));
const MethodologyPanel = lazy(() => import("./hud/MethodologyPanel").then((module) => ({ default: module.MethodologyPanel })));

const WorkspaceFallback = () => <div className="workspace-fallback"><i /><span>Loading verified workspace…</span></div>;

function WorkspaceGlyph({ id }: { id: ViewId }) {
  const paths: Record<ViewId, ReactNode> = {
    overview: <><rect x="4" y="4" width="16" height="16" rx="4" /><path d="M8 15v-3m4 3V9m4 6V7" /></>,
    matrix: <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></>,
    risk: <><path d="M12 3 21 19H3L12 3Z" /><path d="M12 9v4m0 3h.01" /></>,
    optimizer: <><path d="M5 7h14M8 12h8m-5 5h2" /><circle cx="5" cy="7" r="1" /><circle cx="16" cy="12" r="1" /><circle cx="11" cy="17" r="1" /></>,
    compare: <><path d="M8 5H5v14h3M16 5h3v14h-3M9 9h6m-6 6h6" /></>,
    method: <><path d="M7 3h8l3 3v15H7z" /><path d="M15 3v4h4M10 11h5m-5 4h5" /></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{paths[id]}</svg>;
}

export default function App() {
  const { identity, ready: identityReady, error: identityError, cloudConfigured, signIn, signOut } = useIdentitySession();
  const { world, growthLog, simulate, optimize, runClimateSweep, getCalibration, getSiteDataProfiles, commissionSite } = useVerdant(identity);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [publicLabOpen, setPublicLabOpen] = useState(() => window.location.pathname === "/lab");
  const [isFoundingWorld, setIsFoundingWorld] = useState(false);
  const [worldSceneReady, setWorldSceneReady] = useState(false);

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
  const [isRevealingEvidence, setIsRevealingEvidence] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isSweeping, setIsSweeping] = useState(false);
  const [climateSweep, setClimateSweep] = useState<ClimateSweepResult | null>(null);
  const [calibration, setCalibration] = useState<ClimateCalibration | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [forestInspection, setForestInspection] = useState<ForestInspection | null>(null);

  const [activeView, setActiveView] = useState<ViewId>("overview");

  useEffect(() => {
    const syncPath = () => setPublicLabOpen(window.location.pathname === "/lab");
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  const enterPublicLab = useCallback(() => {
    if (window.location.pathname !== "/lab") window.history.pushState({}, "", "/lab");
    setPublicLabOpen(true);
  }, []);
  const isRunning = isFoundingWorld || isSimulating || isRevealingEvidence || isOptimizing || isSweeping;
  const forestActivity: ForestActivity = isFoundingWorld ? "founding" : isOptimizing ? "optimization" : isSweeping ? "climate" : isSimulating ? "simulation" : null;

  useEffect(() => {
    if (pendingFoundingFor(identity)) setIsFoundingWorld(true);
  }, [identity?.id]);

  useEffect(() => {
    if (!isFoundingWorld || !worldSceneReady) return;
    const timer = window.setTimeout(() => {
      completePendingFounding(identity);
      setIsFoundingWorld(false);
    }, 5_800);
    return () => window.clearTimeout(timer);
  }, [identity?.id, isFoundingWorld, worldSceneReady]);

  const setConfigField = (key: keyof MicrogridConfig) => (val: number) => setConfig((c) => ({ ...c, [key]: val }));

  const runSimulation = useCallback(async () => {
    setIsSimulating(true);
    setOperationError(null);
    setOptimized(null);
    try {
      const [{ summary }] = await Promise.all([
        simulate(locationId, preset, config, scenarioCount, siteDataProfileId),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1_400)),
      ]);
      setBaseline(summary);
      setSelectedFailureSeed(summary.failures[0]?.seed ?? null);
      setIsSimulating(false);
      setIsRevealingEvidence(true);
      // Keep the twin visible long enough to show the verified tree taking
      // root. The causal report follows automatically after the world event.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2_350));
      setIsRevealingEvidence(false);
      setActiveView("risk");
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : "Simulation could not be completed.");
    } finally {
      setIsSimulating(false);
      setIsRevealingEvidence(false);
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

  if (cloudConfigured && !identityReady) {
    return <div className="entry-loading"><div><img src={logoUrl} alt="Grounded" /><i /><span>Restoring secure workspace</span></div></div>;
  }

  if (!identity && !publicLabOpen) {
    return <LandingPage cloudConfigured={cloudConfigured} authReady={identityReady} authError={identityError} onEnterLab={enterPublicLab} onGitHubSignIn={signIn} />;
  }

  return (
    <div className={`lab-shell view-${activeView} ${isRunning ? "is-processing" : ""}`}>
      <header className="lab-header">
        <div className="lab-brand">
          <span className="brand-mark"><img src={logoUrl} alt="Grounded" /></span>
          <div><strong>Grounded</strong><span>Jaipur resilience lab</span></div>
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
            ><span className="nav-glyph"><WorkspaceGlyph id={id} /></span><span className="nav-copy"><small>{index}</small><strong>{label}</strong></span></button>
          ))}
        </nav>
        <button
          className={`identity-trigger ${cloudConfigured && !identity ? "cloud-ready" : ""}`}
          onClick={() => setIdentityOpen(true)}
          aria-label={identity ? `Open ${identity.displayName}'s profile` : cloudConfigured ? "Continue with GitHub" : "Sign in or create a world"}
        >
          <i>{identity?.avatarUrl
            ? <img src={identity.avatarUrl} alt="" referrerPolicy="no-referrer" />
            : identity
              ? identity.displayName.slice(0, 1).toUpperCase()
              : cloudConfigured
                ? <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.1c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.78 1.06.78 2.14v3.28c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>
                : "+"}</i>
          <span>
            <small>{identity ? identity.authMode === "github" ? "GITHUB WORLD" : "ACTIVE WORLD" : cloudConfigured ? "SECURE CLOUD ACCESS" : "WORLD ACCESS"}</small>
            <strong>{identity?.worldName ?? (identityReady ? cloudConfigured ? "Continue with GitHub" : "Sign in / Sign up" : "Checking session…")}</strong>
          </span>
        </button>
      </header>

      <main className="lab-layout">
        <aside className="model-rail">
          <div className="rail-clean-heading"><small>MICROGRID INPUTS</small><h2>System configuration</h2><p>Every value directly changes the simulation.</p></div>
          <div className="rail-summary" aria-label="Microgrid configuration summary">
            <span><small>PV ARRAY</small><strong>{config.solarCapacityKW.toLocaleString()}</strong><em>kW</em></span>
            <span><small>STORAGE</small><strong>{config.batteryCapacityKWh.toLocaleString()}</strong><em>kWh</em></span>
            <span><small>CRITICAL</small><strong>{config.hospitalKW.toLocaleString()}</strong><em>kW</em></span>
          </div>
          <div className="panel-surface twin-controls"><TwinPanel config={config} setConfigField={setConfigField} locationId={locationId} /></div>
        </aside>

        <section className="lab-content">
          <section className="workspace-overview">
            <div className="workspace-overview-title"><span>{workspaces.find((item) => item.id === activeView)?.index}</span><div><h1>{workspaces.find((item) => item.id === activeView)?.label}</h1><p>{WORKSPACE_META[activeView].description}</p></div></div>
            <div className="workspace-overview-context">
              <span><small>ENVIRONMENT</small><strong>{environmentLabel}</strong></span>
              <span><small>ACTIVE HAZARD</small><strong>{PRESETS[preset].label}</strong></span>
              <span><small>MODEL HORIZON</small><strong>72 hours · Δ15m</strong></span>
            </div>
          </section>

          <div className="workspace-toolbar">
            <div className="toolbar-label"><small>RUN CONFIGURATION</small><strong>{PRESETS[preset].label} · {scenarioCount.toLocaleString()} futures</strong></div>
            <div className="run-controls">
              <label><span>Region</span><select value={locationId} onChange={(e) => setLocationId(e.target.value as LocationId)}>{Object.values(LOCATIONS).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
              <label><span>Population</span><select value={scenarioCount} onChange={(e) => setScenarioCount(Number(e.target.value))}>{[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()} futures</option>)}</select></label>
              <label><span>Site data</span><select value={siteDataProfileId} onChange={(e) => setSiteDataProfileId(e.target.value)}><option value="representative-model">Representative model</option>{siteDataProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
              <button onClick={runSimulation} disabled={isFoundingWorld || isSimulating || isRevealingEvidence} className="run-button"><span className="run-icon">{isRunning ? <i /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}</span><div><small>{isFoundingWorld ? "FOUNDING WORLD" : isRevealingEvidence ? "COMMITTING EVIDENCE" : isSimulating ? "CALCULATING" : "RUN SIMULATION"}</small>{isFoundingWorld ? "Assembling your field lab…" : isRevealingEvidence ? "Planting verified result…" : isSimulating ? "Exploring futures…" : `Explore ${scenarioCount.toLocaleString()} futures`}</div></button>
            </div>
          </div>
          <nav className="proof-path" aria-label="Judge proof path">
            <span><strong>Analysis path</strong></span>
            <button onClick={() => setActiveView("overview")} className={baseline ? "done" : activeView === "overview" ? "active" : ""}><b>1</b><span>Stress</span></button>
            <button onClick={() => setActiveView("risk")} disabled={!baseline} className={baseline ? "done" : ""}><b>2</b><span>Diagnose</span></button>
            <button onClick={() => setActiveView("optimizer")} disabled={!baseline} className={optimized ? "done" : baseline && activeView === "optimizer" ? "active" : ""}><b>3</b><span>Optimize</span></button>
            <button onClick={() => setActiveView("compare")} disabled={!optimized} className={optimized ? "done" : ""}><b>4</b><span>Prove</span></button>
            <button onClick={() => setActiveView("method")} className={activeSiteData?.validation?.status === "PASS" ? "done" : activeView === "method" ? "active" : ""}><b>5</b><span>Audit</span></button>
          </nav>
          {operationError && <div className="operation-error" role="alert"><span>!</span><div><strong>Analysis interrupted</strong><p>{operationError} Check that the simulation server is running, then retry—the previous verified evidence was not overwritten.</p></div><button onClick={() => setOperationError(null)} aria-label="Dismiss error">×</button></div>}
          {isRunning && <div className="analysis-progress" role="status"><i /><span><strong>{isFoundingWorld ? `Founding ${identity?.worldName ?? "your resilience world"}` : isRevealingEvidence ? "Committing verified growth" : isOptimizing ? "Validating strategy" : isSweeping ? "Stress-testing every hazard" : "Exploring calibrated futures"}</strong><small>{isFoundingWorld ? "Surveying plots · raising the operations lab · opening the evidence ledger" : isRevealingEvidence ? "The completed run is becoming an inspectable tree" : isOptimizing ? "245 strategies · 3 holdouts · 4 assumption shocks" : "Deterministic 72-hour dispatch is running"}</small></span></div>}

          {activeView === "overview" && (
            <>
            <div className="overview-grid">
              <section className="world-card">
                <div className="card-heading"><div><small>LIVE SYSTEM VIEW</small><h3>{identity?.worldName ?? "Jaipur resilience district"}</h3></div><span className="verified-pill">Interactive digital twin</span></div>
                <div className="light-world">
                  <Suspense fallback={<WorkspaceFallback />}><GameCanvas world={world} pendingGrowth={growthLog} activity={forestActivity} onInspect={setForestInspection} onReady={() => setWorldSceneReady(true)} /></Suspense>
                  <div className={`world-live-state ${forestActivity ? "working" : ""}`}><i /><span><small>{isFoundingWorld ? "WORLD FOUNDING" : forestActivity ? "LIVE ANALYSIS" : "EVIDENCE WORLD"}</small><strong>{isFoundingWorld ? "Construction sequence · profile initialized" : forestActivity ? "Work in progress · not yet evidence" : "System context · verified growth only"}</strong></span></div>
                  <div className="world-map-id"><span>{(identity?.worldName ?? "Jaipur resilience city").toUpperCase()}</span><b>{identity ? "PRIVATE OPERATING WORLD" : "OPERATING DISTRICT"}</b></div>
                  <div className="world-map-key" aria-hidden="true"><span><i className="solar" />Power flow</span><span><i className="context" />System asset</span><span><i className="reserve" />Forest reserve</span><span><i className="verified" />Verified growth</span></div>
                  {forestInspection && <aside className="world-inspector" aria-live="polite">
                    <button onClick={() => setForestInspection(null)} aria-label="Close evidence inspector">×</button>
                    <small>{forestInspection.status}</small>
                    <h4>{forestInspection.title}</h4>
                    <p>{forestInspection.evidence}</p>
                    <div><span>RUN <code>{forestInspection.runId.slice(0, 12)}</code></span><span>{new Date(forestInspection.occurredAt).toLocaleString()}</span></div>
                  </aside>}
                </div>
                <div className="world-caption"><p>Drag to explore · scroll to zoom · select an object to inspect proof</p>{world && <div><span><b>{world.trees.length}</b> verified trees</span><span><b>{world.buildings.length}</b> resilience buildings</span><span><b>{world.totalRuns}</b> completed runs</span></div>}</div>
              </section>
              <aside className="hazard-column">
                <section className="hazard-card"><div className="card-heading"><div><small>02 · CLIMATE PRESSURE</small><h3>Choose a hazard</h3></div></div><div className="panel-surface"><StressPanel preset={preset} setPreset={setPreset} isSweeping={isSweeping} runClimateSweep={runAllHazards} /></div></section>
                <section className="canopy-card" style={{ backgroundImage: `url(${canopyUrl})` }}><div><small>EVIDENCE, NOT PROMISES</small><p>Every tree appears only after a completed, reproducible simulation.</p></div></section>
              </aside>
            </div>
            <section className="world-provenance-strip" aria-label="Current model provenance">
              <div><i /> <span><small>ACTIVE HAZARD</small><strong>{PRESETS[preset].label}</strong></span></div>
              <div><span><small>MODEL HORIZON</small><strong>72 hours · Δ15m</strong></span></div>
              <div><span><small>CLIMATE INPUT</small><strong>{calibration ? `${calibration.source === "NASA_POWER" ? "NASA POWER" : "Reference"} · ${calibration.status}` : "Loading provenance…"}</strong></span></div>
              <div><span><small>OPERATIONAL INPUT</small><strong>{operationalDataLabel}</strong></span></div>
            </section>
            </>
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

      <footer className="evidence-bar"><span className="evidence-label"><i /> EVIDENCE LEDGER</span>{world ? <div className="evidence-values"><span><b>{world.totalFuturesSimulated.toLocaleString()}</b> futures simulated</span><span><b>{world.trees.length}</b> trees earned</span><span><b>{world.buildings.length}</b> buildings grown</span></div> : <span>Connecting to the persistent forest…</span>}</footer>
      {toast && <div className="light-toast"><span>✓</span><div><small>VERIFIED GROWTH</small>{toast}</div></div>}
      <IdentityDialog open={identityOpen} profile={identity} cloudConfigured={cloudConfigured} authReady={identityReady} authError={identityError} onGitHubSignIn={signIn} onSignOut={signOut} onClose={() => setIdentityOpen(false)} />
    </div>
  );
}
