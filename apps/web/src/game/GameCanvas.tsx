import { useEffect, useRef } from "react";
import Phaser from "phaser";
import { ForestScene, FOREST_READY_EVENT } from "./ForestScene";
import type { GrowthEvent, WorldState } from "@verdant/protocol";

export function GameCanvas({ world, pendingGrowth }: { world: WorldState | null; pendingGrowth: GrowthEvent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const sceneRef = useRef<ForestScene | null>(null);
  const processedCount = useRef(0);
  const worldAppliedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: containerRef.current.clientWidth,
      height: containerRef.current.clientHeight,
      backgroundColor: "#e7ede0",
      scene: [ForestScene],
      scale: { mode: Phaser.Scale.RESIZE },
      render: { antialias: true },
    });
    gameRef.current = game;

    const onReady = (scene: ForestScene) => {
      sceneRef.current = scene;
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

  return <div ref={containerRef} style={{ width: "100%", height: "100%" }} />;
}
