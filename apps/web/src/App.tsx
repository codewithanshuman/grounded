import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ClimateCalibration, ClimateSweepResult, LocationId, MicrogridConfig, PresetId, RunSummary, SiteDataProfile } from "@verdant/protocol";
import { LOCATIONS, PRESETS, DEFAULT_CONFIG } from "@verdant/sim";
import { useVerdant, type CommissionSiteInput, type OptimizeResponse } from "./ws/client";
import { TwinPanel, StressPanel } from "./hud/ControlPanels";
import { DecisionWorkspace } from "./hud/DecisionWorkspace";
import { AnalysisGate, analysisInputKey, changedRunInputs, inputIssues, inputsForRun } from "./lib/analysisContext";
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
import type { EvidenceBuildPlan } from "./game/evidenceCity/placementModel";
import { CITY_VARIANTS, type EvidenceMilestone, type PlacementRequest } from "@verdant/protocol/city";
import type { StoredEvidence } from "@verdant/protocol/evidence";
import { eligibleCityPlots } from "@verdant/sim/evidenceCity";
import { EvidenceCityPanel } from "./hud/EvidenceCityPanel";
import { EvidenceCertificate } from "./hud/EvidenceCertificate";
import { EvidenceReplayPanel } from "./hud/EvidenceReplayPanel";
import { worldStorageKey } from "./auth/localIdentity";

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

const WorkspaceFallback = () => <div className="workspace-fallback"><i /><span>Loading workspace…</span></div>;

const NAV_LABELS: Record<ViewId, string> = {
  overview: "Twin",
  matrix: "Climate",
  risk: "Risk",
  optimizer: "Strategy",
  compare: "Proof",
  method: "Method",
};

export default function App() {
  const { identity, ready: identityReady, error: identityError, cloudConfigured, signIn, signOut } = useIdentitySession();
  const { connected, engineError, engineNotice, restoredEvidence, persistEvidence, getMilestoneEvidence, placeMilestone, openEvidence, world, growthLog, simulate, optimize, runClimateSweep, getCalibration, getSiteDataProfiles, commissionSite, executionMode } = useVerdant(identity);
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
  const [buildPlan, setBuildPlan] = useState<EvidenceBuildPlan | null>(null);
  const [cityError, setCityError] = useState<string | null>(null);
  const [cityBusy, setCityBusy] = useState(false);
  const [proofBusy, setProofBusy] = useState(false);
  const [certificate, setCertificate] = useState<{ milestone: EvidenceMilestone; title: string } | null>(null);
  const ownerRef = useRef(identity?.id);
  ownerRef.current = identity?.id;
  const cityOperationRef = useRef(false);

  const [activeView, setActiveView] = useState<ViewId>("overview");
  const [runElapsed, setRunElapsed] = useState(0);
  const [riskTargetPct, setRiskTargetPct] = useState(5);
  const [matrixInputKey, setMatrixInputKey] = useState<string | null>(null);
  const gateRef = useRef(new AnalysisGate());
  const inputs = { locationId, preset, config, scenarioCount, siteDataProfileId };
  const inputsKey = analysisInputKey(inputs);
  const selectedProfile = siteDataProfiles.find((profile) => profile.id === siteDataProfileId);
  const sweepKey = analysisInputKey({ ...inputs, preset: "normal", scenarioCount: 500 }) + (selectedProfile?.fingerprint ?? "");
  const requestContextRef = useRef("");
  requestContextRef.current = `${identity?.id ?? "guest"}:${inputsKey}:${selectedProfile?.fingerprint ?? ""}:${riskTargetPct}`;
  const configIssues = inputIssues(inputs);
  const inputChanges = baseline ? changedRunInputs(baseline, inputs) : [];
  if (baseline?.siteData?.id === selectedProfile?.id && baseline?.siteData?.fingerprint !== selectedProfile?.fingerprint) inputChanges.push("data revision");
  const baselineIsCurrent = !!baseline && inputChanges.length === 0;
  const matrixIsCurrent = !!climateSweep && matrixInputKey === sweepKey;
  const dataReady = siteDataProfileId === "representative-model" || !!selectedProfile;

  useEffect(() => {
    const syncPath = () => setPublicLabOpen(window.location.pathname === "/lab");
    window.addEventListener("popstate", syncPath);
    return () => window.removeEventListener("popstate", syncPath);
  }, []);

  const enterPublicLab = useCallback(() => {
    if (window.location.pathname !== "/lab") window.history.pushState({}, "", "/lab");
    setPublicLabOpen(true);
  }, []);
  const isAnalysisRunning = isFoundingWorld || isSimulating || isRevealingEvidence || isOptimizing || isSweeping;
  const isRunning = isAnalysisRunning || cityBusy || proofBusy;
  const forestActivity: ForestActivity = isFoundingWorld ? "founding" : isOptimizing ? "optimization" : isSweeping ? "climate" : isSimulating ? "simulation" : null;

  useEffect(() => {
    if (!isRunning) {
      setRunElapsed(0);
      return;
    }
    const startedAt = performance.now();
    const timer = window.setInterval(() => setRunElapsed((performance.now() - startedAt) / 1000), 100);
    return () => window.clearInterval(timer);
  }, [isRunning]);

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
    if (!connected || isRunning || configIssues.length || !dataReady) return;
    const ticket = gateRef.current.begin(requestContextRef.current);
    if (!ticket) return;
    setIsSimulating(true);
    setOperationError(null);
    try {
      const [{ summary }] = await Promise.all([
        simulate(locationId, preset, config, scenarioCount, siteDataProfileId),
        new Promise<void>((resolve) => window.setTimeout(resolve, 1_400)),
      ]);
      if (!gateRef.current.accepts(ticket, requestContextRef.current)) return;
      setBaseline(summary);
      setOptimized(null);
      await persistEvidence(summary, null, riskTargetPct);
      if (!gateRef.current.accepts(ticket, requestContextRef.current)) return;
      setSelectedFailureSeed(summary.failures[0]?.seed ?? null);
      setIsSimulating(false);
      setIsRevealingEvidence(true);
      // Keep the twin visible long enough to show the verified tree taking
      // root. The causal report follows automatically after the world event.
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2_350));
      if (gateRef.current.accepts(ticket, requestContextRef.current)) setActiveView("risk");
    } catch (error) {
      if (gateRef.current.accepts(ticket, requestContextRef.current)) setOperationError(error instanceof Error ? error.message : "Simulation could not be completed.");
    } finally {
      if (gateRef.current.finish(ticket)) { setIsSimulating(false); setIsRevealingEvidence(false); }
    }
  }, [simulate, persistEvidence, riskTargetPct, locationId, preset, config, scenarioCount, siteDataProfileId, connected, isRunning, configIssues.length, dataReady]);

  const runOptimizer = useCallback(async () => {
    if (!baseline || !baselineIsCurrent || isRunning || !connected) return;
    const ticket = gateRef.current.begin(requestContextRef.current);
    if (!ticket) return;
    setIsOptimizing(true);
    setOperationError(null);
    try {
      const result = await optimize(baseline.runId, riskTargetPct);
      if (!gateRef.current.accepts(ticket, requestContextRef.current)) return;
      setOptimized(result);
      await persistEvidence(baseline, result, riskTargetPct);
      if (!gateRef.current.accepts(ticket, requestContextRef.current)) return;
      setActiveView(result.world?.pendingMilestones?.some((item) => item.proof.resultRunId === result.result.runId) ? "overview" : "compare");
    } catch (error) {
      if (gateRef.current.accepts(ticket, requestContextRef.current)) setOperationError(error instanceof Error ? error.message : "Optimization could not be completed.");
    } finally {
      if (gateRef.current.finish(ticket)) setIsOptimizing(false);
    }
  }, [optimize, persistEvidence, riskTargetPct, baseline, baselineIsCurrent, isRunning, connected]);

  const runAllHazards = useCallback(async () => {
    if (!connected || isRunning || configIssues.length || !dataReady) return;
    const ticket = gateRef.current.begin(requestContextRef.current);
    if (!ticket) return;
    setIsSweeping(true);
    setOperationError(null);
    try {
      const result = await runClimateSweep(locationId, config, 500, siteDataProfileId);
      if (!gateRef.current.accepts(ticket, requestContextRef.current)) return;
      setClimateSweep(result);
      setMatrixInputKey(sweepKey);
      setActiveView("matrix");
    } catch (error) {
      if (gateRef.current.accepts(ticket, requestContextRef.current)) setOperationError(error instanceof Error ? error.message : "Climate matrix could not be completed.");
    } finally {
      if (gateRef.current.finish(ticket)) setIsSweeping(false);
    }
  }, [runClimateSweep, locationId, config, siteDataProfileId, connected, isRunning, configIssues.length, dataReady, sweepKey]);

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
  }, [getCalibration, locationId, identity?.id]);

  useEffect(() => {
    let cancelled = false;
    getSiteDataProfiles().then((result) => { if (!cancelled) setSiteDataProfiles(result.profiles); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [getSiteDataProfiles, identity?.id]);

  // A new owner must not inherit another account's in-memory reports. Within
  // one workspace, keep the last good snapshot and label changed inputs.
  useEffect(() => {
    gateRef.current.invalidate();
    setBaseline(null);
    setOptimized(null);
    setSelectedFailureSeed(null);
    setClimateSweep(null);
    setMatrixInputKey(null);
    setOperationError(null);
    setIsSimulating(false);
    setIsOptimizing(false);
    setIsSweeping(false);
    setIsRevealingEvidence(false);
    setBuildPlan(null);
    setCityError(null);
    setCityBusy(false);
    setProofBusy(false);
    setCertificate(null);
    setForestInspection(null);
    cityOperationRef.current = false;
    setActiveView("overview");
    return () => gateRef.current.invalidate();
  }, [identity?.id]);

  useEffect(() => {
    if (!restoredEvidence) return;
    const recorded = inputsForRun(restoredEvidence.baseline);
    setBaseline(restoredEvidence.baseline);
    setOptimized(restoredEvidence.optimization as unknown as OptimizeResponse | null);
    setLocationId(recorded.locationId);
    setPreset(recorded.preset);
    setConfig(recorded.config);
    setScenarioCount(recorded.scenarioCount);
    setSiteDataProfileId(recorded.siteDataProfileId);
    setRiskTargetPct(restoredEvidence.riskTargetPct);
    setSelectedFailureSeed(restoredEvidence.baseline.failures[0]?.seed ?? null);
  }, [restoredEvidence]);

  const chooseArchitecture = useCallback(async (milestone: EvidenceMilestone, variantId: string) => {
    if (isRunning || cityOperationRef.current) return;
    const owner = ownerRef.current;
    cityOperationRef.current = true;
    setCityBusy(true); setCityError(null);
    try {
      await getMilestoneEvidence(milestone);
      if (ownerRef.current !== owner) return;
      setBuildPlan({ milestoneId: milestone.id, variantId, rotation: 0 });
      setForestInspection(null);
    } catch (error) {
      if (ownerRef.current === owner) setCityError(error instanceof Error ? error.message : "The milestone proof could not be verified.");
    } finally {
      if (ownerRef.current === owner) { cityOperationRef.current = false; setCityBusy(false); }
    }
  }, [getMilestoneEvidence, isRunning]);

  const constructMilestone = useCallback(async (request: PlacementRequest) => {
    if (isRunning || cityOperationRef.current) return;
    const owner = ownerRef.current;
    cityOperationRef.current = true;
    setCityBusy(true); setCityError(null);
    try {
      await placeMilestone(request);
      if (ownerRef.current === owner) setBuildPlan(null);
    } catch (error) {
      if (ownerRef.current === owner) setCityError(error instanceof Error ? error.message : "Construction could not be saved.");
    } finally {
      if (ownerRef.current === owner) { cityOperationRef.current = false; setCityBusy(false); }
    }
  }, [placeMilestone, isRunning]);

  const inspectMilestone = useCallback((milestoneId: string) => {
    const pending = world?.pendingMilestones?.find((item) => item.id === milestoneId);
    const building = world?.buildings.find((item) => item.milestoneId === milestoneId);
    const milestone = pending ?? (building?.proof && building.family ? {
      id: milestoneId, family: building.family, level: building.level ?? 1,
      earnedAt: building.grownAt, proof: building.proof,
    } : null);
    if (!milestone) { setCityError("No evidence certificate is attached to this structure."); return; }
    setCertificate({ milestone, title: CITY_VARIANTS.find((variant) => variant.id === building?.variantId)?.label ?? `${milestone.family} milestone` });
    setBuildPlan(null); setForestInspection(null);
  }, [world]);
  const inspectForest = useCallback((inspection: ForestInspection) => {
    if (inspection.milestoneId) inspectMilestone(inspection.milestoneId);
    else setForestInspection(inspection);
  }, [inspectMilestone]);
  const closeCertificate = useCallback(() => setCertificate(null), []);
  const compareCertificate = useCallback(async (evidence: StoredEvidence) => {
    await openEvidence(evidence);
    setActiveView("compare");
  }, [openEvidence]);
  const rotateConstruction = useCallback(() => {
    if (!cityOperationRef.current) setBuildPlan((plan) => plan ? { ...plan, rotation: ((plan.rotation + 90) % 360) as EvidenceBuildPlan["rotation"] } : null);
  }, []);
  const cancelConstruction = useCallback(() => { if (!cityOperationRef.current) setBuildPlan(null); }, []);
  const availablePlotIds = world && buildPlan ? eligibleCityPlots(world, buildPlan.milestoneId).map((plot) => plot.id) : [];

  const restoreRunInputs = () => {
    if (!baseline || isRunning) return;
    const recorded = inputsForRun(baseline);
    setLocationId(recorded.locationId);
    setPreset(recorded.preset);
    setConfig(recorded.config);
    setScenarioCount(recorded.scenarioCount);
    setSiteDataProfileId(recorded.siteDataProfileId);
  };

  const activeSiteData = siteDataProfiles.find((profile) => profile.id === siteDataProfileId) ?? null;
  const operationalDataLabel = activeSiteData?.scope === "COMMISSIONED_SITE"
    ? `Measured · ${activeSiteData.status === "VERIFIED_SITE" ? "commissioned site" : "quality review"}`
    : activeSiteData ? "Measured · NSW reference" : "Representative profiles";
  const environmentLabel = activeSiteData?.scope === "PUBLIC_REFERENCE"
    ? `${LOCATIONS[locationId].label} climate × NSW operations`
    : activeSiteData?.scope === "COMMISSIONED_SITE" ? `${LOCATIONS[locationId].label} · commissioned operations` : LOCATIONS[locationId].label;
  const cannotRun = isRunning || !connected || configIssues.length > 0 || !dataReady;
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
          <div><strong>Grounded</strong><span>Resilience workspace</span></div>
        </div>
        <nav className="lab-nav" aria-label="Analysis workspaces">
          {workspaces.map(({ id, label, index }) => (
            <button
              key={id}
              onClick={() => setActiveView(id)}
              disabled={id === "matrix" && !climateSweep || (id === "risk" || id === "optimizer") && !baseline || id === "compare" && !optimized}
              aria-current={activeView === id ? "page" : undefined}
              aria-label={label}
              title={id === "matrix" && !climateSweep ? "Compare all five hazards from the Living twin" : (id === "risk" || id === "optimizer") && !baseline ? "Run a simulation to unlock this workspace" : id === "compare" && !optimized ? "Evaluate a strategy to unlock paired proof" : label}
              className={activeView === id ? "active" : ""}
            ><span className="nav-copy"><strong>{NAV_LABELS[id]}</strong></span></button>
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
              : <svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .7a11.5 11.5 0 0 0-3.64 22.41c.58.11.79-.25.79-.56v-2.23c-3.22.7-3.9-1.37-3.9-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.71.08-.71 1.17.08 1.78 1.2 1.78 1.2 1.04 1.77 2.72 1.26 3.38.96.1-.75.41-1.26.74-1.55-2.57-.29-5.27-1.29-5.27-5.69 0-1.26.45-2.29 1.19-3.09-.12-.29-.52-1.47.11-3.05 0 0 .97-.31 3.16 1.18A10.98 10.98 0 0 1 12 6.1c.98 0 1.95.13 2.86.39 2.2-1.49 3.16-1.18 3.16-1.18.63 1.58.23 2.76.11 3.05.74.8 1.19 1.83 1.19 3.09 0 4.42-2.71 5.39-5.29 5.68.42.36.78 1.06.78 2.14v3.28c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .7Z" /></svg>}</i>
          <span>
            <small>{identity ? identity.authMode === "github" ? "GITHUB WORLD" : "ACTIVE WORLD" : cloudConfigured ? "SECURE CLOUD ACCESS" : "WORLD ACCESS"}</small>
            <strong>{identity?.worldName ?? (identityReady ? cloudConfigured ? "Continue with GitHub" : "Sign in / Sign up" : "Checking session…")}</strong>
          </span>
        </button>
      </header>

      <main className="lab-layout">
        <aside id="system-inputs" className="model-rail">
          <div className="rail-studio">
            <img src={logoUrl} alt="" aria-hidden="true" />
            <span><small>YOUR MODEL</small><strong>Scenario studio</strong></span>
            <em><i /> {isRunning ? "Busy" : "Editable"}</em>
          </div>
          <div className="rail-clean-heading"><small>CONFIGURATION</small><h2>Build your scenario.</h2><p>Set the assets and operating assumptions to test.</p></div>
          <div className="rail-summary" aria-label="Microgrid configuration summary">
            <span><small>PV ARRAY</small><strong>{config.solarCapacityKW.toLocaleString()}</strong><em>kW</em></span>
            <span><small>STORAGE</small><strong>{config.batteryCapacityKWh.toLocaleString()}</strong><em>kWh</em></span>
            <span><small>CRITICAL</small><strong>{config.hospitalKW.toLocaleString()}</strong><em>kW</em></span>
          </div>
          <fieldset className="panel-surface twin-controls" disabled={isRunning}><legend className="sr-only">Microgrid inputs</legend><TwinPanel config={config} setConfigField={setConfigField} locationId={locationId} /></fieldset>
          <div className="studio-rail-footer"><span>{isRunning ? "Inputs locked while this run completes" : "Inputs stay local until you run an analysis"}</span><button disabled={isRunning} onClick={() => setConfig({ ...DEFAULT_CONFIG })}>Reset inputs</button></div>
        </aside>

        <section id="analysis-workspace" className="lab-content">
          <section className="workspace-overview">
            <div className="workspace-overview-title"><span>{workspaces.find((item) => item.id === activeView)?.index}</span><div><h1>{workspaces.find((item) => item.id === activeView)?.label}</h1><p>{WORKSPACE_META[activeView].description}</p></div></div>
            <div className="workspace-overview-context">
              <span><small>ENVIRONMENT</small><strong>{environmentLabel}</strong></span>
              <span><small>ACTIVE HAZARD</small><strong>{PRESETS[preset].label}</strong></span>
              <span><small>MODEL HORIZON</small><strong>72 hours · Δ15m</strong></span>
            </div>
          </section>
          <a className="config-link" href="#system-inputs">Edit system inputs ↗</a>
          <div className="workspace-toolbar">
            <div className="toolbar-label"><small>RUN CONFIGURATION</small><strong>{PRESETS[preset].label} · {scenarioCount.toLocaleString()} futures</strong></div>
            <fieldset className="run-controls" disabled={isRunning}><legend className="sr-only">Run configuration</legend>
              <label><span>Region</span><select value={locationId} onChange={(e) => setLocationId(e.target.value as LocationId)}>{Object.values(LOCATIONS).map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}</select></label>
              <label><span>Population</span><select value={scenarioCount} onChange={(e) => setScenarioCount(Number(e.target.value))}>{[500, 1000, 2000, 5000, 10000].map((n) => <option key={n} value={n}>{n.toLocaleString()} futures</option>)}</select></label>
              <label><span>Site data</span><select value={siteDataProfileId} onChange={(e) => setSiteDataProfileId(e.target.value)}><option value="representative-model">Representative model</option>{siteDataProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.label}</option>)}</select></label>
              <button onClick={runSimulation} disabled={cannotRun} className="run-button"><span className="run-icon">{isRunning ? <i /> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" /></svg>}</span><div><small>{isFoundingWorld ? "FOUNDING WORLD" : isRevealingEvidence ? "COMMITTING EVIDENCE" : isRunning ? "ANALYSIS IN PROGRESS" : "RUN SIMULATION"}</small>{isFoundingWorld ? "Assembling your field lab…" : isRevealingEvidence ? "Planting verified result…" : isRunning ? "Working on your analysis…" : !connected ? "Starting engine…" : !dataReady ? "Loading data source…" : `Explore ${scenarioCount.toLocaleString()} futures`}</div></button>
            </fieldset>
          </div>
          <nav className="proof-path" aria-label="Judge proof path">
            <span><strong>Analysis path</strong></span>
            <button onClick={() => setActiveView("overview")} className={baseline ? "done" : activeView === "overview" ? "active" : ""}><b>1</b><span>Stress</span></button>
            <button onClick={() => setActiveView("risk")} disabled={!baseline} className={baseline ? "done" : ""}><b>2</b><span>Diagnose</span></button>
            <button onClick={() => setActiveView("optimizer")} disabled={!baseline} className={optimized ? "done" : baseline && activeView === "optimizer" ? "active" : ""}><b>3</b><span>Optimize</span></button>
            <button onClick={() => setActiveView("compare")} disabled={!optimized} className={optimized ? "done" : ""}><b>4</b><span>Prove</span></button>
            <button onClick={() => setActiveView("method")} className={activeSiteData?.validation?.status === "PASS" ? "done" : activeView === "method" ? "active" : ""}><b>5</b><span>Audit</span></button>
          </nav>
          {engineError && <div className="studio-snapshot-notice" role="alert"><div><strong>Simulation engine needs attention</strong><p>{engineError}</p><p>Saved evidence will be checked on reload. Export any report that could not be saved before closing this tab.</p></div><button onClick={() => window.location.reload()}>Reload workspace</button></div>}
          {engineNotice && <div className="studio-snapshot-notice" role="status"><div><strong>Saved world notice</strong><p>{engineNotice}</p></div></div>}
          {configIssues.length > 0 && <div className="studio-input-errors" role="alert"><strong>Check these inputs before running</strong><ul>{configIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div>}
          {baseline && !baselineIsCurrent && <div className="studio-snapshot-notice" role="status"><div><strong>Your inputs have changed.</strong><p>The report below is preserved from the earlier run. Changed: {inputChanges.join(", ")}. Run again before evaluating a strategy for these inputs.</p></div><button disabled={isRunning} onClick={restoreRunInputs}>Restore run inputs</button></div>}
          {activeView === "matrix" && climateSweep && !matrixIsCurrent && <div className="studio-snapshot-notice" role="status"><div><strong>This matrix belongs to earlier inputs.</strong><p>Rebuild it to compare the current system across all five hazards.</p></div><button disabled={cannotRun} onClick={runAllHazards}>Rebuild matrix</button></div>}
          {operationError && <div className="operation-error" role="alert"><span>!</span><div><strong>Analysis interrupted</strong><p>{operationError} Your last completed report has been preserved. Check the inputs and retry; if the engine stopped, reload the workspace.</p></div><button onClick={() => setOperationError(null)} aria-label="Dismiss error">×</button></div>}
          {isAnalysisRunning && <div className="analysis-progress" role="status"><i /><span><strong>{isFoundingWorld ? `Founding ${identity?.worldName ?? "your resilience world"}` : isRevealingEvidence ? "Committing verified growth" : isOptimizing ? "Validating strategy" : isSweeping ? "Stress-testing every hazard" : "Exploring calibrated futures"}</strong><small>{isFoundingWorld ? "Surveying plots · raising the operations lab · opening the evidence ledger" : isRevealingEvidence ? "The completed run is becoming an inspectable tree" : isOptimizing ? "245 strategies · 3 holdouts · 4 assumption shocks" : "Deterministic 72-hour dispatch is running"}</small></span><em>{runElapsed.toFixed(1)}s</em></div>}

          {activeView === "overview" && (
            <>
            <DecisionWorkspace baseline={baseline} optimized={optimized} stale={!!baseline && !baselineIsCurrent} busy={cannotRun} targetPct={riskTargetPct} onTargetChange={setRiskTargetPct} onRun={runSimulation} onRisk={() => setActiveView("risk")} onStrategy={() => setActiveView("optimizer")} onProof={() => setActiveView("compare")} onMethod={() => setActiveView("method")} />
            <div className="overview-grid">
              <section className="world-card">
                <div className="card-heading"><div><h3>{identity?.worldName ?? "Jaipur resilience district"}</h3></div></div>
                <div className="light-world">
                  <Suspense fallback={<WorkspaceFallback />}><GameCanvas world={world} pendingGrowth={growthLog} activity={forestActivity} onInspect={inspectForest} onReady={() => setWorldSceneReady(true)} buildPlan={cityBusy ? null : buildPlan} onPlace={constructMilestone} onRotate={rotateConstruction} onCancel={cancelConstruction} /></Suspense>
                  {forestInspection && <aside className="world-inspector" aria-live="polite">
                    <button onClick={() => setForestInspection(null)} aria-label="Close evidence inspector">×</button>
                    <small>{forestInspection.status}</small>
                    <h4>{forestInspection.title}</h4>
                    <p>{forestInspection.evidence}</p>
                    {forestInspection.runId !== "system-context" && <div><span>RUN <code>{forestInspection.runId.slice(0, 12)}</code></span><span>{new Date(forestInspection.occurredAt).toLocaleString()}</span></div>}
                  </aside>}
                </div>
                <div className="world-caption"><p>Drag to pan · scroll to zoom · select a structure to inspect.</p></div>
              </section>
              <aside className="hazard-column">
                <section className="hazard-card"><div className="card-heading"><div><small>CLIMATE PRESSURE</small><h3>Choose a hazard</h3></div></div><fieldset className="panel-surface" disabled={isRunning}><legend className="sr-only">Hazard controls</legend><StressPanel preset={preset} setPreset={setPreset} isSweeping={isSweeping} disabled={cannotRun} runClimateSweep={runAllHazards} /></fieldset></section>
                <section className="canopy-card" style={{ backgroundImage: `url(${canopyUrl})` }}><div><p>Completed simulations grow inspectable evidence trees. The surrounding landscape is illustrative.</p></div></section>
              </aside>
            </div>
            <EvidenceCityPanel world={world} busy={isRunning} buildPlan={buildPlan} error={cityError} availablePlotIds={availablePlotIds} onChoose={chooseArchitecture} onPlanChange={setBuildPlan} onPlace={constructMilestone} onInspect={inspectMilestone} />
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
            {activeView === "risk" && baseline && <section className="analysis-card"><div className="analysis-heading"><div><small>FAILURE FORENSICS</small><h3>Where the system breaks</h3></div><button className="next-step" onClick={() => setActiveView("optimizer")}>Find a resilient strategy →</button></div><div className="panel-surface analysis-body"><RiskPanel baseline={baseline} selectedFailureSeed={selectedFailureSeed} setSelectedFailureSeed={setSelectedFailureSeed} /></div></section>}
            {activeView === "optimizer" && baseline && <section className="analysis-card"><div className="analysis-heading"><div><small>DECISION INTELLIGENCE</small><h3>Smallest effective intervention</h3></div><p>245 strategies searched across five hazards, then validated on three disjoint holdouts and four assumption shocks.</p></div><div className="panel-surface analysis-body"><OptimizerPanel baseline={baseline} optimized={optimized} isOptimizing={isOptimizing} disabled={isRunning || !baselineIsCurrent || !connected} runOptimizer={runOptimizer} /></div></section>}
            {activeView === "compare" && baseline && optimized && <section className="analysis-card"><div className="analysis-heading"><div><small>COUNTERFACTUAL PROOF</small><h3>Same future. Two strategies.</h3></div><p>Only the intervention changes between these two calibrated worlds.</p></div><div className="panel-surface analysis-body"><ComparePanel baseline={baseline} optimized={optimized} /></div></section>}
            {activeView === "method" && <section className="analysis-card"><div className="analysis-heading"><div><small>SCIENTIFIC TRANSPARENCY</small><h3>Evidence &amp; methodology</h3></div><p>Sources, uncertainty, validation design and model boundaries—open for inspection.</p></div><div className="panel-surface analysis-body"><MethodologyPanel calibration={baseline ? baseline.calibration ?? null : calibration} siteData={baseline ? baseline.siteData ?? null : activeSiteData} locationLabel={LOCATIONS[baseline?.location ?? locationId].label} latestRun={optimized?.result ?? baseline} onCommission={handleCommission} commissioningAvailable={executionMode === "Server engine"} /></div></section>}
          </Suspense>
          {(activeView === "compare" || activeView === "method") && baseline && <EvidenceReplayPanel key={`${identity?.id ?? "guest"}:${optimized?.result.runId ?? baseline.runId}`} ownerScope={worldStorageKey(identity?.id)} baseline={baseline} optimization={optimized} targetPct={optimized?.analysis?.riskTargetPct ?? riskTargetPct} busy={isAnalysisRunning || cityBusy} onBusyChange={setProofBusy} />}
        </section>
      </main>

      <footer className="evidence-bar"><span className="evidence-label"><i /> EVIDENCE LEDGER</span>{world ? <div className="evidence-values"><span><b>{world.totalFuturesSimulated.toLocaleString()}</b> futures simulated</span><span><b>{world.trees.length}</b> trees earned</span><span><b>{world.buildings.length}</b> buildings grown</span></div> : <span>Connecting to the persistent forest…</span>}</footer>
      {toast && <div className="light-toast"><span>✓</span><div><small>VERIFIED GROWTH</small>{toast}</div></div>}
      <IdentityDialog open={identityOpen} profile={identity} cloudConfigured={cloudConfigured} authReady={identityReady} authError={identityError} onGitHubSignIn={signIn} onSignOut={signOut} onClose={() => setIdentityOpen(false)} />
      {certificate && <EvidenceCertificate key={`${identity?.id ?? "guest"}:${certificate.milestone.id}`} milestone={certificate.milestone} title={certificate.title} loadProof={getMilestoneEvidence} onClose={closeCertificate} onCompare={compareCertificate} onBusyChange={setProofBusy} />}
    </div>
  );
}
