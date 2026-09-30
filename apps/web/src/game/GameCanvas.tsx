import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import { GroundedCityScene, type CityView } from "./GroundedCityScene";
import type { GrowthEvent, WorldState } from "@verdant/protocol";
import type { RailStatus } from "./rail/RailSystem";
import "./rail/rail-controls.css";

export type ForestActivity = "founding" | "simulation" | "optimization" | "climate" | null;

export type ForestInspection = {
  kind: "tree" | "building";
  title: string;
  status: string;
  evidence: string;
  runId: string;
  occurredAt: number;
};

export function GameCanvas({ world, pendingGrowth, activity, onInspect, onReady }: {
  world: WorldState | null;
  pendingGrowth: GrowthEvent[];
  activity: ForestActivity;
  onInspect?: (inspection: ForestInspection) => void;
  onReady?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [district, setDistrict] = useState<CityView>("city");
  const [railStatus, setRailStatus] = useState<RailStatus | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<GroundedCityScene | null>(null);
  const inspectRef = useRef(onInspect);
  const readyRef = useRef(onReady);
  const activityRef = useRef(activity);
  const worldRef = useRef(world);
  inspectRef.current = onInspect;
  readyRef.current = onReady;
  activityRef.current = activity;
  worldRef.current = world;

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new GroundedCityScene();
    scene.setInspectHandler((inspection) => inspectRef.current?.(inspection));
    scene.setRailStatusHandler(setRailStatus);
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
    game.events.once(Phaser.Core.Events.READY, () => {
      if (worldRef.current) scene.setGroundedWorld(worldRef.current);
      scene.setActivity(activityRef.current);
      readyRef.current?.();
    });

    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width <= 0 || entry.contentRect.height <= 0) return;
      game.scale.resize(entry.contentRect.width, entry.contentRect.height);
      scene.resizeViewport(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
    };
    // mount once; updates are pushed imperatively below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (world && sceneRef.current?.scene?.isActive()) sceneRef.current.setGroundedWorld(world);
  }, [world, pendingGrowth.length]);

  useEffect(() => {
    sceneRef.current?.setActivity(activity);
  }, [activity]);

  return <div style={{ width: "100%", height: "100%", position: "relative" }}>
    <div ref={containerRef} style={{ width: "100%", height: "100%" }} />
    <nav aria-label="Explore city districts" style={{position:"absolute",left:16,top:80,zIndex:4,display:"flex",flexWrap:"wrap",gap:4,maxWidth:"calc(100% - 32px)",padding:5,borderRadius:14,background:"rgba(255,255,255,.94)",boxShadow:"0 4px 20px #14362720",border:"1px solid #ffffffaa"}}>
      {([['city','City'],['forest','Forest'],['bridge','Bridge'],['landmarks','Civic quarter'],['energy','Energy'],['rail','Railway'],['world','Whole world']] as const).map(([id,label])=>
        <button key={id} type="button" aria-pressed={district===id} onClick={()=>{setDistrict(id);sceneRef.current?.showDistrict(id);}}
          style={{font:"600 13px Manrope, sans-serif",padding:"9px 13px",border:0,borderRadius:9,cursor:"pointer",background:district===id?"#e0edce":"transparent",color:district===id?"#244633":"#50615c"}}>{label}</button>)}
    </nav>
    {district === "rail" && railStatus && <section className="rail-operations" aria-label="Railway operations">
      <div className="rail-operations-heading"><div><small>SIMULATED TRANSIT</small><strong>Coastal line</strong></div><button onClick={() => sceneRef.current?.setRailPaused(!railStatus.paused)}>{railStatus.paused ? "Resume trains" : "Pause trains"}</button></div>
      <div className="rail-station-list"><span>Research Park</span><i /><span>City Gate</span><i /><span>Reserve Link</span><i /><span>Airport</span></div>
      {railStatus.trains.map((train, index) => <div className="rail-service" key={index}><b className={index === 1 ? "amber" : ""}>0{index + 1}</b><div><strong>{railStatus.paused ? "Paused" : train.phase === "DWELL" ? `At ${train.station}` : `To ${train.nextStation}`}</strong><span>{train.phase === "DWELL" ? "Departure" : "Arrival"} in {train.secondsRemaining}s · simulated time</span></div><i className={railStatus.paused ? "paused" : ""} /></div>)}
      <div className="rail-speed"><label>Playback <select aria-label="Rail playback speed" value={railStatus.speed} onChange={(event)=>sceneRef.current?.setRailSpeed(Number(event.target.value))}><option value={.5}>0.5×</option><option value={1}>1×</option><option value={2}>2×</option></select></label><span>2 trains · 4 stops · separate tracks</span></div>
      <p>Timetable demonstration. Not a live service or an input to the energy model.</p>
    </section>}
  </div>;
}
