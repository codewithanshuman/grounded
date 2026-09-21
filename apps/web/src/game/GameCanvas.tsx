import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { GroundedCityScene } from "./GroundedCityScene";
import type { GrowthEvent, WorldState } from "@verdant/protocol";

export type ForestActivity = "simulation" | "optimization" | "climate" | null;

export type ForestInspection = {
  kind: "tree" | "building";
  title: string;
  status: string;
  evidence: string;
  runId: string;
  occurredAt: number;
};

export function GameCanvas({ world, pendingGrowth, activity, onInspect }: {
  world: WorldState | null;
  pendingGrowth: GrowthEvent[];
  activity: ForestActivity;
  onInspect?: (inspection: ForestInspection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<GroundedCityScene | null>(null);
  const inspectRef = useRef(onInspect);
  const activityRef = useRef(activity);
  const worldRef = useRef(world);
  inspectRef.current = onInspect;
  activityRef.current = activity;
  worldRef.current = world;

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = new GroundedCityScene();
    scene.setInspectHandler((inspection) => inspectRef.current?.(inspection));
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
