import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { ForestScene, FOREST_READY_EVENT } from "./ForestScene";
import type { ForestInspection } from "./ForestScene";
import type { ForestActivity } from "./LiveConstruction";
import type { GrowthEvent, WorldState } from "@verdant/protocol";

export type { ForestInspection, ForestActivity };

export function GameCanvas({ world, pendingGrowth, activity, onInspect }: {
  world: WorldState | null;
  pendingGrowth: GrowthEvent[];
  activity: ForestActivity;
  onInspect?: (inspection: ForestInspection) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<ForestScene | null>(null);
  const processedCount = useRef(0);
  const worldAppliedRef = useRef(false);
  const inspectRef = useRef(onInspect);
  const activityRef = useRef(activity);
  inspectRef.current = onInspect;
  activityRef.current = activity;

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "#217fb5",
      scene: [ForestScene],
      scale: { mode: Phaser.Scale.RESIZE },
      render: { antialias: false, pixelArt: true, roundPixels: true },
    });
    gameRef.current = game;

    const onReady = (scene: ForestScene) => {
      sceneRef.current = scene;
      scene.setInspectHandler((inspection) => inspectRef.current?.(inspection));
      scene.setActivity(activityRef.current);
      if (world && !worldAppliedRef.current) {
        scene.setWorld(world);
        worldAppliedRef.current = true;
        processedCount.current = pendingGrowth.length;
      }
    };
    game.events.on(FOREST_READY_EVENT, onReady);

    return () => {
      game.events.off(FOREST_READY_EVENT, onReady);
      game.destroy(true);
      gameRef.current = null;
      sceneRef.current = null;
      worldAppliedRef.current = false;
    };
    // mount once; updates are pushed imperatively below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // apply the initial/refreshed world snapshot once the scene exists
  useEffect(() => {
    if (world && sceneRef.current && !worldAppliedRef.current) {
      sceneRef.current.setWorld(world);
      worldAppliedRef.current = true;
      processedCount.current = pendingGrowth.length;
    }
  }, [world, pendingGrowth.length]);

  // animate only newly-arrived growth events
  useEffect(() => {
    if (!sceneRef.current || !worldAppliedRef.current) return;
    for (let i = processedCount.current; i < pendingGrowth.length; i++) {
      sceneRef.current.addGrowth(pendingGrowth[i]);
    }
    processedCount.current = pendingGrowth.length;
  }, [pendingGrowth]);

  useEffect(() => {
    sceneRef.current?.setActivity(activity);
  }, [activity]);

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
