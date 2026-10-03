import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { GroundedCityScene, type CityView } from "./GroundedCityScene";
import type { GrowthEvent, WorldState } from "@verdant/protocol";
import type { RailStatus } from "./rail/RailSystem";
import { RAIL_STATIONS } from "./rail/railModel";
import "./rail/rail-controls.css";
import "./game-canvas.css";
import type { EvidenceBuildPlan, EvidencePlacement } from "./evidenceCity/placementModel";
import type { EvidencePlacementStatus } from "./evidenceCity/EvidenceCityPlacement";
import type { EvidenceConstructionStatus } from "./evidenceCity/EvidenceConstruction";
import "./evidenceCity/evidence-city.css";
import { detectWorldPerformanceProfile } from "./performanceProfile";
export type { EvidenceBuildPlan, EvidencePlacement } from "./evidenceCity/placementModel";

const DISTRICTS: ReadonlyArray<{ id: CityView; label: string; detail: string }> = [
  { id: "city", label: "Central city", detail: "Resilience district" },
  { id: "north", label: "North city", detail: "Campus and housing" },
  { id: "forest", label: "Forest reserve", detail: "Ecology island" },
  { id: "bridge", label: "Water bridge", detail: "City–reserve link" },
  { id: "landmarks", label: "Civic quarter", detail: "Public institutions" },
  { id: "energy", label: "Energy corridor", detail: "Generation and grid" },
  { id: "rail", label: "Northern metro", detail: "Animated transit" },
  { id: "world", label: "Whole world", detail: "Optional overview" },
];

export type ForestActivity = "founding" | "simulation" | "optimization" | "climate" | null;

export type ForestInspection = {
  kind: "tree" | "building";
  title: string;
  status: string;
  evidence: string;
  runId: string;
  occurredAt: number;
  milestoneId?: string;
};

export function GameCanvas({ world, pendingGrowth, activity, onInspect, onReady, buildPlan = null, onPlace, onRotate, onCancel }: {
  world: WorldState | null;
  pendingGrowth: GrowthEvent[];
  activity: ForestActivity;
  onInspect?: (inspection: ForestInspection) => void;
  onReady?: () => void;
  buildPlan?: EvidenceBuildPlan | null;
  onPlace?: (placement: EvidencePlacement) => void;
  onRotate?: () => void;
  onCancel?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [district, setDistrict] = useState<CityView>("city");
  const [districtMenuOpen, setDistrictMenuOpen] = useState(false);
  const [railStatus, setRailStatus] = useState<RailStatus | null>(null);
  const [placementStatus, setPlacementStatus] = useState<EvidencePlacementStatus | null>(null);
  const [constructionStatus, setConstructionStatus] = useState<EvidenceConstructionStatus[]>([]);
  const performanceProfile = detectWorldPerformanceProfile();
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<GroundedCityScene | null>(null);
  const inspectRef = useRef(onInspect);
  const readyRef = useRef(onReady);
  const activityRef = useRef(activity);
  const worldRef = useRef(world);
  const planRef = useRef(buildPlan);
  const placementCallbacksRef = useRef({ onPlace, onRotate, onCancel });
  inspectRef.current = onInspect;
  readyRef.current = onReady;
  activityRef.current = activity;
  worldRef.current = world;
  planRef.current = buildPlan;
  placementCallbacksRef.current = { onPlace, onRotate, onCancel };

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new GroundedCityScene();
    scene.setInspectHandler((inspection) => inspectRef.current?.(inspection));
    scene.setRailStatusHandler(setRailStatus);
    scene.setPlacementHandlers({ onPlace: (placement) => placementCallbacksRef.current.onPlace?.(placement),
      onRotate: () => placementCallbacksRef.current.onRotate?.(), onCancel: () => placementCallbacksRef.current.onCancel?.(),
      onStatus: setPlacementStatus });
    scene.setConstructionStatusHandler(setConstructionStatus);
    sceneRef.current = scene;
    const game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "#2e9fe0",
      scene,
      scale: { mode: Phaser.Scale.RESIZE },
      fps: { target: performanceProfile.targetFps },
      render: { antialias: false, pixelArt: true, roundPixels: true, clearBeforeRender: true, powerPreference: performanceProfile.powerPreference },
    });
    gameRef.current = game;
    let disposed = false;
    const initializeScene = () => {
      if (disposed || sceneRef.current !== scene) return;
      if (worldRef.current) scene.setGroundedWorld(worldRef.current);
      scene.setActivity(activityRef.current);
      scene.setBuildPlan(planRef.current);
      readyRef.current?.();
    };
    const onGameReady = () => {
      if (disposed) return;
      // Game READY precedes image preloading. Hydrate only after scene create()
      // has baked the terrain atlas and the extra Grounded architecture.
      if (scene.scene.isActive()) initializeScene();
      else scene.events.once(Phaser.Scenes.Events.CREATE, initializeScene);
    };
    game.events.once(Phaser.Core.Events.READY, onGameReady);

    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      game.scale.resize(entry.contentRect.width, entry.contentRect.height);
      scene.resizeViewport(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(containerRef.current);

    return () => {
      disposed = true;
      game.events.off(Phaser.Core.Events.READY, onGameReady);
      scene.events?.off(Phaser.Scenes.Events.CREATE, initializeScene);
      observer.disconnect();
      scene.setPlacementHandlers({}); scene.setConstructionStatusHandler(undefined);
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // mount once; updates are pushed imperatively below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (world && sceneRef.current?.scene?.isActive()) sceneRef.current.setGroundedWorld(world, pendingGrowth);
  }, [world, pendingGrowth]);

  useEffect(() => {
    sceneRef.current?.setActivity(activity);
  }, [activity]);
  useEffect(() => { sceneRef.current?.setBuildPlan(buildPlan); }, [buildPlan]);

  const activeDistrict = DISTRICTS.find((item) => item.id === district) ?? DISTRICTS[0]!;
  const chooseDistrict = (view: CityView) => {
    setDistrict(view);
    setDistrictMenuOpen(false);
    sceneRef.current?.showDistrict(view);
  };

  return <div className="world-viewport" data-render-quality={performanceProfile.mode.toLowerCase()}>
    <div ref={containerRef} className="world-renderer" />
    <div className="world-atmosphere" aria-hidden="true" />
    <nav className={`world-navigation${districtMenuOpen ? " is-open" : ""}`} aria-label="Explore city districts">
      <button className="world-navigation-trigger" type="button" aria-expanded={districtMenuOpen} onClick={() => setDistrictMenuOpen((open) => !open)}>
        <span><small>VIEWING</small><strong>{activeDistrict.label}</strong></span>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m6 8 4 4 4-4" /></svg>
      </button>
      {districtMenuOpen && <div className="world-navigation-menu">
        {DISTRICTS.map((item, index) => <button key={item.id} type="button" aria-pressed={district === item.id}
          onClick={() => chooseDistrict(item.id)}>
          <b>{String(index + 1).padStart(2, "0")}</b><span><strong>{item.label}</strong><small>{item.detail}</small></span>
        </button>)}
      </div>}
      {!districtMenuOpen && district !== "world" && <button className="world-overview-action" type="button" onClick={() => chooseDistrict("world")}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3.5 4.5h5v5h-5zm8 0h5v5h-5zm-8 7h5v5h-5zm8 0h5v5h-5z" /></svg>
        <span>Overview</span>
      </button>}
    </nav>
    {district === "rail" && railStatus && <details className="rail-operations" aria-label="Railway operations">
      <summary className="rail-control-summary">Northern metro <span>{railStatus.paused ? "Paused" : "2 services"} · controls</span></summary>
      <div className="rail-operations-body">
      <div className="rail-operations-heading"><div><strong>Train playback</strong></div><button onClick={() => sceneRef.current?.setRailPaused(!railStatus.paused)}>{railStatus.paused ? "Resume trains" : "Pause trains"}</button></div>
      <div className="rail-station-list">{RAIL_STATIONS.map((station,index)=><span key={station.id}>{index>0&&<i />}{station.name}</span>)}</div>
      {railStatus.trains.map((train, index) => <div className="rail-service" key={index}><b className={index === 1 ? "amber" : ""}>0{index + 1}</b><div><strong>{railStatus.paused ? "Paused" : train.phase === "DWELL" ? `At ${train.station}` : `To ${train.nextStation}`}</strong><span>{train.phase === "DWELL" ? "Departure" : "Arrival"} in {train.secondsRemaining}s · simulated time</span></div><i className={railStatus.paused ? "paused" : ""} /></div>)}
      <div className="rail-speed"><label>Playback <select aria-label="Rail playback speed" value={railStatus.speed} onChange={(event)=>sceneRef.current?.setRailSpeed(Number(event.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label><span>2 trains · 4 stops · separate tracks</span></div>
      <p>Timetable demonstration. Not a live service or an input to the energy model.</p>
      </div>
    </details>}
    {buildPlan && <section className="evidence-placement-control" aria-label="Evidence building placement">
      <div className="evidence-placement-copy"><strong>{placementStatus?.plotLabel ?? "Choose an evidence plot"}</strong>
        <span role="status">{placementStatus?.message ?? "Green tiles are available; red tiles are reserved or occupied."}</span>
        <small><i className="available" /> Available <i className="unavailable" /> Reserved / occupied · {placementStatus?.available ?? 0} available</small>
      </div>
      <div className="evidence-placement-actions"><button type="button" onClick={onRotate}>Rotate front <kbd>R</kbd></button>
        <span className="evidence-orientation">{buildPlan.rotation}° front</span>
        <button type="button" onClick={onCancel}>Cancel <kbd>Esc</kbd></button></div>
      <p>Click a green land tile to place. Drag to pan. Front orientation uses authored isometric faces, not 3D rotation.</p>
    </section>}
    {constructionStatus.length > 0 && <section className="evidence-construction-control" aria-label="Evidence construction animation" aria-live="polite">
      {constructionStatus.map((status) => <div key={status.milestoneId}><strong>{status.label}</strong><ol>
        {(["Foundation", "Frame", "Complete"] as const).map((phase) => <li key={phase} aria-current={phase === status.phase ? "step" : undefined}>{phase}</li>)}
      </ol></div>)}<small>Presentation of an already recorded model milestone.</small>
    </section>}
  </div>;
}
