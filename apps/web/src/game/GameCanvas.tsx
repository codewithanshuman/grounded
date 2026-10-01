import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { GroundedCityScene, type CityView } from "./GroundedCityScene";
import type { GrowthEvent, WorldState } from "@verdant/protocol";
import type { RailStatus } from "./rail/RailSystem";
import { RAIL_STATIONS } from "./rail/railModel";
import "./rail/rail-controls.css";
import type { EvidenceBuildPlan, EvidencePlacement } from "./evidenceCity/placementModel";
import type { EvidencePlacementStatus } from "./evidenceCity/EvidenceCityPlacement";
import type { EvidenceConstructionStatus } from "./evidenceCity/EvidenceConstruction";
import "./evidenceCity/evidence-city.css";
export type { EvidenceBuildPlan, EvidencePlacement } from "./evidenceCity/placementModel";

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
  const [railStatus, setRailStatus] = useState<RailStatus | null>(null);
  const [placementStatus, setPlacementStatus] = useState<EvidencePlacementStatus | null>(null);
  const [constructionStatus, setConstructionStatus] = useState<EvidenceConstructionStatus[]>([]);
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
      fps: { target: 30 },
      render: { antialias: false, pixelArt: true, roundPixels: true, clearBeforeRender: false, powerPreference: "low-power" },
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

  return <div style={{ width: "100%", height: "100%", position: "relative" }}>
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    <nav aria-label="Explore city districts" style={{position:"absolute",left:16,top:16,zIndex:4,display:"flex",flexWrap:"wrap",gap:4,maxWidth:"calc(100% - 32px)",padding:5,borderRadius:14,background:"rgba(255,255,255,.94)",boxShadow:"0 4px 20px #14362720",border:"1px solid #ffffffaa"}}>
      {([['city','City'],['north','North city'],['forest','Forest'],['bridge','Bridge'],['landmarks','Civic quarter'],['energy','Energy'],['rail','Railway'],['world','Whole world']] as const).map(([id,label])=>
        <button key={id} type="button" aria-pressed={district===id} onClick={()=>{setDistrict(id);sceneRef.current?.showDistrict(id);}}
          style={{font:"600 13px Manrope, sans-serif",padding:"9px 13px",border:0,borderRadius:9,cursor:"pointer",background:district===id?"#e0edce":"transparent",color:district===id?"#244633":"#50615c"}}>{label}</button>)}
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
