import Phaser from "phaser";
import type { WorldState } from "@verdant/protocol";
import { CITY_PLOTS } from "@verdant/protocol/city";
import { bakeBuilding } from "../../reference-city/textures/buildings";
import { TILE_ANCHOR_Y } from "../../reference-city/textures/core";
import { projection, HIGHLIGHT_DEPTH, CLICK_SLOP } from "../../reference-city/world/core/worldConstants";
import { isCanvasPointer } from "../../reference-city/world/utils/pointerUtils";
import type { TerrainGrid } from "../../reference-city/layouts/terrain";
import { evidenceVisualStyle, orientationFront } from "./visualVariants";
import { evidenceVariant, isTypingTarget, placementClickIsValid, placementVerdict, plotAtGrid,
  type EvidenceBuildPlan, type EvidencePlacement, type EvidencePlot } from "./placementModel";

export interface EvidencePlacementStatus {
  available: number;
  plotLabel?: string;
  message: string;
  canPlace: boolean;
}
export interface EvidencePlacementHandlers {
  onPlace?: (placement: EvidencePlacement) => void;
  onRotate?: () => void;
  onCancel?: () => void;
  onStatus?: (status: EvidencePlacementStatus | null) => void;
}

/** Placement overlays never mutate evidence or the world; the shared gate does. */
export class EvidenceCityPlacement {
  private plan: EvidenceBuildPlan | null = null;
  private graphics: Phaser.GameObjects.Graphics;
  private ghost?: Phaser.GameObjects.Sprite;
  private press?: { x: number; y: number; plotId?: string; dragged?: boolean; pointerId: number };
  private hovered?: EvidencePlot;
  private handlers: EvidencePlacementHandlers = {};

  constructor(private readonly scene: Phaser.Scene, private readonly world: () => WorldState | null,
    private readonly terrain: () => TerrainGrid | undefined,
    private readonly onVisualFocus?: (plotId?: string) => void) {
    this.graphics = scene.add.graphics().setDepth(HIGHLIGHT_DEPTH + 30);
    scene.input.on("pointerdown", this.pointerDown);
    scene.input.on("pointermove", this.pointerMove);
    scene.input.on("pointerup", this.pointerUp);
    scene.input.on("pointerupoutside", this.clearPress);
    window.addEventListener("keydown", this.keyDown);
  }

  setHandlers(handlers: EvidencePlacementHandlers): void { this.handlers = handlers; }
  setPlan(plan: EvidenceBuildPlan | null): void {
    const changedVariant = plan?.variantId !== this.plan?.variantId || plan?.rotation !== this.plan?.rotation;
    this.plan = plan;
    this.press = undefined;
    if (changedVariant) { this.ghost?.destroy(); this.ghost = undefined; }
    if (!plan) {
      this.hovered = undefined; this.onVisualFocus?.(); this.ghost?.setVisible(false);
      this.graphics.clear(); this.handlers.onStatus?.(null); return;
    }
    this.refresh();
  }

  refresh(): void {
    this.graphics.clear();
    const world = this.world(), plan = this.plan;
    if (!plan || !world) {
      this.ghost?.setVisible(false);
      if (plan) this.handlers.onStatus?.({ available: 0, canPlace: false, message: "Loading the current world before placement." });
      return;
    }
    let available = 0;
    for (const plot of CITY_PLOTS) {
      const verdict = placementVerdict(world, plan, plot);
      const eligible = verdict.eligible && this.onDryLand(plot);
      if (eligible) available += 1;
      const points = [[-.48, -.48], [.48, -.48], [.48, .48], [-.48, .48]]
        .map(([dx, dy]) => projection.project(plot.gx + dx!, plot.gy + dy!));
      this.graphics.fillStyle(eligible ? 0x66c782 : 0xe29087, this.hovered?.id === plot.id ? .72 : .38)
        .lineStyle(this.hovered?.id === plot.id ? 3 : 2, eligible ? 0xf3fff3 : 0xffe7e3, .9)
        .fillPoints(points, true).strokePoints(points, true);
    }
    const verdict = this.hovered ? placementVerdict(world, plan, this.hovered) : undefined;
    const canPlace = !!verdict?.eligible && !!this.hovered && this.onDryLand(this.hovered);
    this.drawGhost(world, canPlace);
    this.handlers.onStatus?.({ available, plotLabel: this.hovered?.label, canPlace,
      message: verdict ? !this.onDryLand(verdict.plot) ? "This tile is not dry buildable ground." : verdict.reason
        : available ? "Choose a green land tile. Drag to pan; a drag never builds." : "No available plot for this milestone." });
  }

  private onDryLand(plot: EvidencePlot): boolean {
    const cell = this.terrain()?.cellAt(plot.gx, plot.gy);
    return !!cell && cell.kind !== "water" && cell.kind !== "road" && cell.kind !== "sand";
  }

  private plotAt(pointer: Phaser.Input.Pointer): EvidencePlot | undefined {
    const point = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    const grid = projection.unproject(point.x, point.y);
    return plotAtGrid(grid.x, grid.y);
  }

  private pointerDown = (pointer: Phaser.Input.Pointer): void => {
    if (!this.plan || !isCanvasPointer(pointer) || pointer.rightButtonDown()) return;
    // A second finger is a navigation gesture, never an independent build.
    if (this.press && this.press.pointerId !== pointer.id) { this.press.dragged = true; return; }
    this.press = { x: pointer.x, y: pointer.y, plotId: this.plotAt(pointer)?.id, pointerId: pointer.id };
  };
  private pointerMove = (pointer: Phaser.Input.Pointer): void => {
    if (!this.plan || !isCanvasPointer(pointer)) return;
    // A pan that returns to its starting tile is still a pan, never a build.
    if (this.press?.pointerId === pointer.id
      && Math.hypot(pointer.x - this.press.x, pointer.y - this.press.y) > CLICK_SLOP) this.press.dragged = true;
    const hovered = this.plotAt(pointer);
    if (hovered?.id !== this.hovered?.id) this.onVisualFocus?.(hovered?.id);
    this.hovered = hovered;
    this.refresh();
  };
  private pointerUp = (pointer: Phaser.Input.Pointer): void => {
    const press = this.press;
    if (press && press.pointerId !== pointer.id) return;
    this.press = undefined;
    const world = this.world(), plan = this.plan;
    if (!plan || !world || !isCanvasPointer(pointer) || press?.pointerId !== pointer.id) return;
    const plot = this.plotAt(pointer);
    if (!plot || !placementClickIsValid(press, { x: pointer.x, y: pointer.y, plotId: plot.id }, CLICK_SLOP)
      || !this.onDryLand(plot) || !placementVerdict(world, plan, plot).eligible) return;
    this.handlers.onPlace?.({ ...plan, plotId: plot.id });
  };
  private clearPress = (): void => { this.press = undefined; };
  private keyDown = (event: KeyboardEvent): void => {
    if (!this.plan || !this.scene.scene.isActive() || event.defaultPrevented || event.repeat || event.ctrlKey || event.metaKey || event.altKey
      || isTypingTarget(event.target)) return;
    if (event.key.toLowerCase() === "r") { event.preventDefault(); this.handlers.onRotate?.(); }
    else if (event.key === "Escape") { event.preventDefault(); this.setPlan(null); this.handlers.onCancel?.(); }
  };

  private drawGhost(world: WorldState, canPlace: boolean): void {
    const plan = this.plan, plot = this.hovered;
    if (!plan || !plot) { this.ghost?.setVisible(false); return; }
    const variant = evidenceVariant(plan.variantId);
    const level = world.pendingMilestones?.find((milestone) => milestone.id === plan.milestoneId)?.level ?? 1;
    const style = variant && evidenceVisualStyle(variant.id, level, plan.rotation);
    if (!style) { this.ghost?.setVisible(false); return; }
    const baked = bakeBuilding(this.scene, style.archetype, style.tier, style.language, style.facing);
    const point = projection.project(plot.gx, plot.gy);
    if (!this.ghost) this.ghost = this.scene.add.sprite(0, 0, baked.key).setOrigin(.5, 1);
    this.ghost.setTexture(baked.key).setPosition(point.x, point.y + TILE_ANCHOR_Y)
      .setDepth(projection.depth(plot.gx, plot.gy) + 12).setFlipX(style.flipX)
      .setAlpha(canPlace ? .62 : .36).setTint(canPlace ? 0xb9f5ce : 0xf3b3ad).setVisible(true);
    // The ground arrow distinguishes all four front choices, including archive
    // utility/tower textures whose authored facades are rotationally symmetric.
    const front = orientationFront(plan.rotation);
    const edge = projection.project(plot.gx + front.gx, plot.gy + front.gy);
    const tangent = front.gx ? { x: -10, y: 5 } : { x: 10, y: 5 };
    const tip = projection.project(plot.gx + front.gx * 1.55, plot.gy + front.gy * 1.55);
    this.graphics.fillStyle(canPlace ? 0xffffff : 0xffd9d3, .95).fillPoints([
      { x: edge.x - tangent.x, y: edge.y - tangent.y },
      { x: edge.x + tangent.x, y: edge.y + tangent.y }, tip,
    ], true);
  }

  destroy(): void {
    this.scene.input.off("pointerdown", this.pointerDown);
    this.scene.input.off("pointermove", this.pointerMove);
    this.scene.input.off("pointerup", this.pointerUp);
    this.scene.input.off("pointerupoutside", this.clearPress);
    window.removeEventListener("keydown", this.keyDown);
    this.graphics.destroy(); this.ghost?.destroy();
    this.handlers.onStatus?.(null);
  }
}
