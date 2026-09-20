import Phaser from "phaser";
import { FOREST_GRID_SIZE, HALF_H, HALF_W, toScreen, depthOf } from "./iso";
import { bakeTextures, WORLD_TEXTURES } from "./textures";
import { LiveConstruction, type ForestActivity } from "./LiveConstruction";
import type { Building, GrowthEvent, Tree, WorldState } from "@verdant/protocol";
import workerUrl from "../../../../assets/world-worker.png";
import architectUrl from "../../../../assets/world-architect.png";
import runnerUrl from "../../../../assets/world-runner.png";

export const FOREST_READY_EVENT = "forest-ready";

export type ForestInspection = {
  kind: "tree" | "building";
  title: string;
  status: string;
  evidence: string;
  runId: string;
  occurredAt: number;
};

export class ForestScene extends Phaser.Scene {
  private placed = new Set<string>();
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private camStart = { x: 0, y: 0 };
  private construction: LiveConstruction | null = null;
  private inspectHandler: ((inspection: ForestInspection) => void) | null = null;

  constructor() {
    super("ForestScene");
  }

  preload(): void {
    this.load.image("crew-worker", workerUrl);
    this.load.image("crew-architect", architectUrl);
    this.load.image("crew-runner", runnerUrl);
  }

  create(): void {
    bakeTextures(this);
    this.construction = new LiveConstruction(this);
    this.drawGround();
    this.spawnAmbientWorld();

    const cam = this.cameras.main;
    cam.setBackgroundColor(0x217fb5);
    this.fitCamera();
    this.scale.on(Phaser.Scale.Events.RESIZE, () => this.fitCamera());

    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => {
      this.isDragging = true;
      this.dragStart = { x: p.x, y: p.y };
      this.camStart = { x: cam.scrollX, y: cam.scrollY };
    });
    this.input.on("pointerup", () => (this.isDragging = false));
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.isDragging) return;
      cam.scrollX = this.camStart.x - (p.x - this.dragStart.x) / cam.zoom;
      cam.scrollY = this.camStart.y - (p.y - this.dragStart.y) / cam.zoom;
    });
    this.input.on("wheel", (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      cam.zoom = Phaser.Math.Clamp(cam.zoom - dy * 0.0006, 0.25, 1.6);
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.construction?.destroy());

    this.game.events.emit(FOREST_READY_EVENT, this);
  }

  setInspectHandler(handler: ((inspection: ForestInspection) => void) | null): void {
    this.inspectHandler = handler;
  }

  setActivity(activity: ForestActivity): void {
    const { x, y } = toScreen(10, 10);
    this.construction?.setActivity(activity, x, y, depthOf(10, 10) + 0.8);
  }

  private drawGround(): void {
    const margin = 4;
    for (let gx = -margin; gx < FOREST_GRID_SIZE + margin; gx++) {
      for (let gy = -margin; gy < FOREST_GRID_SIZE + margin; gy++) {
        const inside = gx >= 0 && gy >= 0 && gx < FOREST_GRID_SIZE && gy < FOREST_GRID_SIZE;
        const edge = inside ? Math.min(gx, gy, FOREST_GRID_SIZE - 1 - gx, FOREST_GRID_SIZE - 1 - gy) : -1;
        const seed = hashCell(gx, gy);
        const inlet = inside && edge === 0 && seed % 5 === 0;
        const isWater = !inside || inlet;
        const isSand = inside && !inlet && (edge <= 1 || (edge === 2 && seed % 7 === 0));
        const isRoad = inside && edge > 2 && (gx === 7 || gx === 16 || gy === 7 || gy === 16);
        const isPlaza = inside && gx >= 10 && gx <= 14 && gy >= 10 && gy <= 14;
        const key = isWater
          ? WORLD_TEXTURES.water[seed % WORLD_TEXTURES.water.length]!
          : isSand
            ? WORLD_TEXTURES.sand[seed % WORLD_TEXTURES.sand.length]!
            : isPlaza
              ? WORLD_TEXTURES.plaza
              : isRoad
                ? WORLD_TEXTURES.road
                : WORLD_TEXTURES.grass[seed % WORLD_TEXTURES.grass.length]!;
        const { x, y } = toScreen(gx, gy);
        const img = this.add.image(x, y, key).setOrigin(0.5, 0.5);
        img.setDepth(-2000 + (gx + gy) * 0.01);

        if (!isWater && !isSand && !isRoad && !isPlaza && edge > 2 && seed % 11 === 0) {
          const propKeys = [WORLD_TEXTURES.pine, WORLD_TEXTURES.bush, WORLD_TEXTURES.rock] as const;
          this.add.image(x, y + HALF_H, propKeys[(seed >>> 5) % propKeys.length]!).setOrigin(0.5, 1).setDepth(depthOf(gx, gy) - 0.5).setScale(0.82);
        }
        if (isRoad && seed % 9 === 0) {
          this.add.image(x, y + HALF_H, WORLD_TEXTURES.lamp).setOrigin(0.5, 1).setDepth(depthOf(gx, gy) + 0.2).setScale(0.72);
        }
      }
    }
    const centre = toScreen(12, 12);
    this.add.image(centre.x, centre.y + HALF_H, WORLD_TEXTURES.fountain).setOrigin(0.5, 1).setDepth(depthOf(12, 12) - 1).setScale(0.9);
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    const worldWidth = FOREST_GRID_SIZE * HALF_W * 2;
    const worldHeight = FOREST_GRID_SIZE * HALF_H * 2;
    const zoom = Math.min((cam.width * 0.92) / worldWidth, (cam.height * 0.9) / worldHeight);
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.28, 0.72));
    cam.centerOn(0, FOREST_GRID_SIZE * HALF_H);
  }

  private spawnAmbientWorld(): void {
    const sparkleCells: Array<[number, number]> = [
      [-3, 3], [-1, 8], [2, -2], [8, -3], [17, -2], [25, 4], [27, 10], [26, 19], [20, 26], [11, 27], [3, 25], [-3, 18],
    ];
    sparkleCells.forEach(([gx, gy], index) => {
      const p = toScreen(gx, gy);
      const sparkle = this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.sparkle).setDepth(-1000).setAlpha(0.08);
      this.tweens.add({ targets: sparkle, alpha: 0.88, duration: 850 + index * 90, delay: index * 130, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    });

    const boats: Array<{ from: [number, number]; to: [number, number]; duration: number; flip: boolean }> = [
      { from: [-3, 5], to: [7, -3], duration: 27000, flip: false },
      { from: [19, -3], to: [27, 7], duration: 32000, flip: true },
      { from: [27, 20], to: [17, 27], duration: 35000, flip: false },
    ];
    boats.forEach(({ from, to, duration, flip }, index) => {
      const start = toScreen(...from); const end = toScreen(...to);
      const boat = this.add.image(start.x, start.y + HALF_H, WORLD_TEXTURES.boat).setOrigin(0.5, 1).setDepth(-850 + index).setScale(0.72).setFlipX(flip);
      this.tweens.add({ targets: boat, x: end.x, y: end.y + HALF_H, duration, yoyo: true, repeat: -1, delay: index * 1200, ease: "Sine.InOut" });
    });

    for (let index = 0; index < 3; index++) {
      const cloud = this.add.image(-1100 + index * 560, 250 + index * 170, WORLD_TEXTURES.cloud).setDepth(8000).setScale(1.5 + index * 0.18).setAlpha(0.13);
      this.tweens.add({ targets: cloud, x: 1200, duration: 62000 + index * 9000, repeat: -1, ease: "Linear" });
    }

    const crew = [
      { key: "crew-worker", from: [9, 8] as const, to: [14, 8] as const, duration: 8200 },
      { key: "crew-architect", from: [15, 15] as const, to: [15, 10] as const, duration: 9600 },
      { key: "crew-runner", from: [8, 15] as const, to: [11, 17] as const, duration: 6900 },
    ];
    crew.forEach(({ key, from, to, duration }, index) => {
      const a = toScreen(from[0], from[1]); const b = toScreen(to[0], to[1]);
      const person = this.add.image(a.x, a.y + HALF_H, key).setOrigin(0.5, 1).setScale(key === "crew-runner" ? 0.115 : 0.17).setDepth(depthOf(from[0], from[1]) + 2);
      this.tweens.add({
        targets: person, x: b.x, y: b.y + HALF_H, duration, yoyo: true, repeat: -1, delay: index * 700, ease: "Linear",
        onYoyo: () => person.setFlipX(!person.flipX), onRepeat: () => person.setFlipX(!person.flipX),
        onUpdate: () => person.setDepth(person.y * 0.42),
      });
    });
  }

  /** Full resync from server state — used on first connect / reconnect. */
  setWorld(state: WorldState): void {
    for (const t of state.trees) this.placeTree(t, false);
    for (const b of state.buildings) this.placeBuilding(b, false);
  }

  /** Incremental update from a live growth broadcast — animates the new
   * addition instead of redrawing everything. */
  addGrowth(event: GrowthEvent): void {
    if (event.tree) this.placeTree(event.tree, true);
    if (event.building) this.placeBuilding(event.building, true);
  }

  private placeTree(tree: Tree, animate: boolean): void {
    if (this.placed.has(tree.id)) return;
    this.placed.add(tree.id);
    const { x, y } = toScreen(tree.gx, tree.gy);
    const img = this.add.image(x, y, `tree-${tree.species}`).setOrigin(0.5, 1);
    img.setDepth(depthOf(tree.gx, tree.gy));
    this.makeInspectable(img, {
      kind: "tree",
      title: `${titleCase(tree.species)} evidence tree`,
      status: "Verified simulation",
      evidence: "Planted only after a completed, reproducible resilience run.",
      runId: tree.runId,
      occurredAt: tree.plantedAt,
    });
    if (animate) {
      this.construction?.plantTree(x, y, depthOf(tree.gx, tree.gy), img);
    }
  }

  private placeBuilding(building: Building, animate: boolean): void {
    if (this.placed.has(building.id)) return;
    this.placed.add(building.id);
    const { x, y } = toScreen(building.gx, building.gy);
    const img = this.add.image(x, y, `bld-${building.kind}`).setOrigin(0.5, 1);
    img.setDepth(depthOf(building.gx, building.gy) + 0.5);
    this.makeInspectable(img, {
      kind: "building",
      title: buildingName(building.kind),
      status: "Verified resilience milestone",
      evidence: building.milestone,
      runId: building.runId,
      occurredAt: building.grownAt,
    });
    if (animate) {
      this.construction?.completeBuilding(x, y, depthOf(building.gx, building.gy), img, building.milestone);
    }
  }

  private makeInspectable(image: Phaser.GameObjects.Image, inspection: ForestInspection): void {
    image.setInteractive({ cursor: "pointer" });
    image.on("pointerover", () => {
      image.setTint(0xf1ffd2);
      this.tweens.add({ targets: image, scaleX: 1.06, scaleY: 1.06, duration: 130, ease: "Sine.Out" });
    });
    image.on("pointerout", () => {
      image.clearTint();
      this.tweens.add({ targets: image, scaleX: 1, scaleY: 1, duration: 150, ease: "Sine.Out" });
    });
    image.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const moved = Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.x, pointer.y);
      if (moved < 8) this.inspectHandler?.(inspection);
    });
  }
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function buildingName(kind: Building["kind"]): string {
  const labels: Record<Building["kind"], string> = {
    watchtower: "Reliability watchtower",
    reservoir: "Resilience reservoir",
    solarHall: "Solar operations hall",
    resilienceHall: "Community resilience hall",
  };
  return labels[kind];
}

function hashCell(gx: number, gy: number): number {
  let value = Math.imul(gx + 37, 73856093) ^ Math.imul(gy + 71, 19349663);
  value ^= value >>> 13;
  return value >>> 0;
}
