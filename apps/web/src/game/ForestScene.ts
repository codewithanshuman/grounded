import Phaser from "phaser";
import { FOREST_GRID_SIZE, toScreen, depthOf } from "./iso";
import { bakeTextures } from "./textures";
import type { Building, GrowthEvent, Tree, WorldState } from "@verdant/protocol";

export const FOREST_READY_EVENT = "forest-ready";

export class ForestScene extends Phaser.Scene {
  private world: Phaser.GameObjects.Container | null = null;
  private placed = new Set<string>();
  private isDragging = false;
  private dragStart = { x: 0, y: 0 };
  private camStart = { x: 0, y: 0 };

  constructor() {
    super("ForestScene");
  }

  create(): void {
    bakeTextures(this);
    this.world = this.add.container(0, 0);
    this.drawGround();

    const cam = this.cameras.main;
    cam.setZoom(0.85);
    cam.centerOn(0, (FOREST_GRID_SIZE * 24) / 2);

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
      cam.zoom = Phaser.Math.Clamp(cam.zoom - dy * 0.0006, 0.4, 1.8);
    });

    this.game.events.emit(FOREST_READY_EVENT, this);
  }

  private drawGround(): void {
    const g = this.add.graphics();
    for (let gx = 0; gx < FOREST_GRID_SIZE; gx++) {
      for (let gy = 0; gy < FOREST_GRID_SIZE; gy++) {
        const key = (gx + gy) % 2 === 0 ? "tile-a" : "tile-b";
        const { x, y } = toScreen(gx, gy);
        const img = this.add.image(x, y, key).setOrigin(0.5, 0.5);
        img.setDepth(-1000 + depthOf(gx, gy) * 0.001);
      }
    }
    g.destroy();
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
    if (animate) {
      img.setScale(0.1).setAlpha(0);
      this.tweens.add({ targets: img, scale: 1, alpha: 1, duration: 500, ease: "Back.Out" });
    }
  }

  private placeBuilding(building: Building, animate: boolean): void {
    if (this.placed.has(building.id)) return;
    this.placed.add(building.id);
    const { x, y } = toScreen(building.gx, building.gy);
    const img = this.add.image(x, y, `bld-${building.kind}`).setOrigin(0.5, 1);
    img.setDepth(depthOf(building.gx, building.gy) + 0.5);
    if (animate) {
      img.setScale(0.1, 0.1).setAlpha(0);
      this.tweens.add({ targets: img, scaleX: 1, scaleY: 1, alpha: 1, duration: 650, ease: "Back.Out" });
    }
  }
}
