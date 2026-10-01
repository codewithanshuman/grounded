import Phaser from "phaser";
import type { Building } from "@verdant/protocol";
import { ConstructionSites, type ConstructionTarget } from "../../reference-city/systems/construction";
import { prefersReducedMotion } from "../../reference-city/systems/ambient";
import { TILE_ANCHOR_Y } from "../../reference-city/textures/core";
import { constructionReceipt, evidenceVariant } from "./placementModel";

export interface EvidenceConstructionStatus {
  milestoneId: string;
  label: string;
  phase: "Foundation" | "Frame" | "Complete";
}
interface ActiveConstruction {
  sprite: Phaser.GameObjects.Sprite;
  target: ConstructionTarget;
  foundation: Phaser.GameObjects.Graphics;
  timers: Phaser.Time.TimerEvent[];
  status: EvidenceConstructionStatus;
}

/** Authored archive crane/hook/scaffold/crew; timings are presentation only. */
export class EvidenceConstruction {
  private readonly sites: ConstructionSites;
  private readonly active = new Map<string, ActiveConstruction>();
  private readonly receipts = new Set<string>();
  private statusHandler?: (status: EvidenceConstructionStatus[]) => void;

  constructor(private readonly scene: Phaser.Scene, private readonly crewTexture: string) {
    this.sites = new ConstructionSites(scene, prefersReducedMotion());
  }
  setStatusHandler(handler?: (status: EvidenceConstructionStatus[]) => void): void { this.statusHandler = handler; }
  hydrate(buildings: Building[]): void { buildings.forEach((building) => { const receipt = constructionReceipt(building); if (receipt) this.receipts.add(receipt); }); }

  start(building: Building, sprite: Phaser.GameObjects.Sprite): void {
    const receipt = constructionReceipt(building);
    if (!receipt || this.receipts.has(receipt) || !building.milestoneId) return;
    this.receipts.add(receipt);
    this.stop(building.id);
    this.scene.tweens.killTweensOf(sprite);
    sprite.setScale(1).setAlpha(1).setCrop();
    if (prefersReducedMotion()) return;
    const foundation = this.scene.add.graphics().setDepth(sprite.depth - 1);
    foundation.fillStyle(0xdad7c8, .9).lineStyle(2, 0x788778, .9)
      .fillPoints([{ x: sprite.x, y: sprite.y - TILE_ANCHOR_Y - 23 }, { x: sprite.x + 46, y: sprite.y - TILE_ANCHOR_Y },
        { x: sprite.x, y: sprite.y - TILE_ANCHOR_Y + 23 }, { x: sprite.x - 46, y: sprite.y - TILE_ANCHOR_Y }], true)
      .strokePoints([{ x: sprite.x, y: sprite.y - TILE_ANCHOR_Y - 23 }, { x: sprite.x + 46, y: sprite.y - TILE_ANCHOR_Y },
        { x: sprite.x, y: sprite.y - TILE_ANCHOR_Y + 23 }, { x: sprite.x - 46, y: sprite.y - TILE_ANCHOR_Y }], true);
    const active: ActiveConstruction = {
      sprite, foundation, timers: [],
      target: { sessionId: `evidence-construction/${building.milestoneId}`, path: `evidence/${building.id}`,
        x: sprite.x, y: sprite.y, depth: sprite.depth, height: sprite.displayHeight,
        crewTexture: this.scene.textures.exists(this.crewTexture) ? this.crewTexture : undefined },
      status: { milestoneId: building.milestoneId, label: evidenceVariant(building.variantId!)?.label ?? "Evidence building", phase: "Foundation" },
    };
    this.active.set(building.id, active);
    sprite.setAlpha(0);
    this.sync();
    active.timers.push(this.scene.time.delayedCall(900, () => {
      if (!sprite.active) { this.stop(building.id); return; }
      active.status.phase = "Frame";
      sprite.setAlpha(.85).setCrop(0, sprite.height * .48, sprite.width, sprite.height * .52);
      this.sync();
    }));
    active.timers.push(this.scene.time.delayedCall(2_700, () => {
      if (!sprite.active) { this.stop(building.id); return; }
      active.status.phase = "Complete";
      sprite.setAlpha(1).setCrop();
      foundation.destroy();
      this.sites.sync([...this.active.values()].filter((site) => site.status.phase !== "Complete").map((site) => site.target));
      this.publish();
    }));
    active.timers.push(this.scene.time.delayedCall(3_400, () => this.stop(building.id)));
  }

  private sync(): void {
    this.sites.sync([...this.active.values()].filter((active) => active.status.phase !== "Complete").map((active) => active.target));
    this.publish();
  }
  private publish(): void { this.statusHandler?.([...this.active.values()].map((active) => ({ ...active.status }))); }
  private stop(id: string): void {
    const active = this.active.get(id);
    if (!active) return;
    active.timers.forEach((timer) => timer.remove(false));
    if (active.sprite.active) active.sprite.setCrop().setAlpha(1).setScale(1);
    if (active.foundation.active) active.foundation.destroy();
    this.active.delete(id);
    this.sync();
  }
  destroy(): void {
    [...this.active.keys()].forEach((id) => this.stop(id));
    this.sites.clear();
    this.statusHandler?.([]);
  }
}
