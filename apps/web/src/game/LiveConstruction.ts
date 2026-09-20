import Phaser from "phaser";
import { WORLD_TEXTURES } from "./textures";

export type ForestActivity = "simulation" | "optimization" | "climate" | null;

const ACTIVITY_COPY: Record<Exclude<ForestActivity, null>, { eyebrow: string; title: string }> = {
  simulation: { eyebrow: "MODEL WORKSITE", title: "Exploring futures" },
  optimization: { eyebrow: "VALIDATION WORKSITE", title: "Testing intervention" },
  climate: { eyebrow: "STRESS WORKSITE", title: "Sweeping hazards" },
};

type Site = {
  container: Phaser.GameObjects.Container;
  label: Phaser.GameObjects.Text;
  detail: Phaser.GameObjects.Text;
  bar: Phaser.GameObjects.Rectangle;
  loops: Phaser.Tweens.Tween[];
};

/**
 * Visualises analysis as temporary work and completed evidence as construction.
 * Temporary sites are explicitly labelled as unverified so the scene never
 * presents an in-progress model result as measured evidence.
 */
export class LiveConstruction {
  private activitySite: Site | null = null;
  private activity: ForestActivity = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setActivity(activity: ForestActivity, x: number, y: number, depth: number): void {
    if (activity === this.activity) return;
    this.activity = activity;
    if (this.activitySite) this.removeSite(this.activitySite, true);
    this.activitySite = null;
    if (!activity) return;

    const copy = ACTIVITY_COPY[activity];
    const site = this.createSite(x, y, depth, copy.eyebrow, copy.title, true);
    this.activitySite = site;
    site.container.setAlpha(0).setScale(0.96);
    this.scene.tweens.add({ targets: site.container, alpha: 1, scale: 1.12, duration: 420, ease: "Back.Out" });
  }

  completeBuilding(
    x: number,
    y: number,
    depth: number,
    building: Phaser.GameObjects.Image,
    milestone: string,
  ): void {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) {
      building.setAlpha(1).setScale(1);
      return;
    }

    const site = this.createSite(x, y, depth + 0.65, "VERIFIED BUILD", "Assembling resilience", false);
    const scaffold = site.container.getByName("scaffold") as Phaser.GameObjects.Container;
    const crane = site.container.getByName("crane") as Phaser.GameObjects.Container;
    scaffold.setScale(1, 0.04).setAlpha(0.25);
    crane.setScale(1, 0.08).setAlpha(0);
    building.setScale(0.12, 0.05).setAlpha(0);

    this.scene.tweens.add({ targets: scaffold, scaleY: 1, alpha: 1, duration: 480, ease: "Cubic.Out" });
    this.scene.tweens.add({ targets: crane, scaleY: 1, alpha: 1, duration: 520, ease: "Back.Out" });

    this.scene.time.delayedCall(460, () => {
      site.label.setText("STRUCTURE VERIFIED");
      site.detail.setText(shorten(milestone, 31));
      site.bar.setFillStyle(0xb7df72).setScale(0.68, 1);
      this.makeDust(x, y - 8, depth + 0.8);
      this.scene.tweens.add({
        targets: building,
        scaleX: 1,
        scaleY: 1,
        alpha: 1,
        duration: 980,
        ease: "Cubic.Out",
      });
    });

    this.scene.time.delayedCall(1550, () => {
      site.bar.setScale(1, 1);
      site.detail.setText("Committed to evidence ledger");
    });
    this.scene.time.delayedCall(2150, () => this.removeSite(site, true));
  }

  plantTree(x: number, y: number, depth: number, tree: Phaser.GameObjects.Image): void {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reducedMotion) {
      tree.setAlpha(1).setScale(1);
      return;
    }

    const ring = this.scene.add.ellipse(x, y - 3, 20, 8, 0x9cc465, 0.55).setDepth(depth - 0.1);
    const pulse = this.scene.add.ellipse(x, y - 3, 14, 6).setStrokeStyle(2, 0x5d873e, 0.8).setDepth(depth + 0.1);
    tree.setAlpha(0).setScale(0.05).setAngle(-4);
    this.scene.tweens.add({ targets: ring, scaleX: 2.4, scaleY: 2.1, alpha: 0, duration: 850, ease: "Cubic.Out", onComplete: () => ring.destroy() });
    this.scene.tweens.add({ targets: pulse, scaleX: 2.8, scaleY: 2.8, alpha: 0, duration: 900, ease: "Cubic.Out", onComplete: () => pulse.destroy() });
    this.scene.tweens.add({ targets: tree, alpha: 1, scale: 1, angle: 0, duration: 820, ease: "Back.Out" });
    this.makeLeafBurst(x, y - 32, depth + 0.2);
  }

  destroy(): void {
    if (this.activitySite) this.removeSite(this.activitySite, false);
    this.activitySite = null;
  }

  private createSite(x: number, y: number, depth: number, eyebrow: string, title: string, looping: boolean): Site {
    const footprint = this.scene.add.graphics();
    footprint.lineStyle(1, 0x496d3e, 0.72);
    footprint.fillStyle(0xe6efcf, 0.28);
    footprint.fillPoints([
      new Phaser.Geom.Point(-47, -1), new Phaser.Geom.Point(0, 19),
      new Phaser.Geom.Point(47, -1), new Phaser.Geom.Point(0, -21),
    ], true);
    footprint.strokePoints([
      new Phaser.Geom.Point(-47, -1), new Phaser.Geom.Point(0, 19),
      new Phaser.Geom.Point(47, -1), new Phaser.Geom.Point(0, -21),
    ], true);

    const scaffoldImage = this.scene.add.image(0, 8, WORLD_TEXTURES.scaffold).setOrigin(0.5, 1).setScale(0.86);
    const scaffold = this.scene.add.container(0, 0, [scaffoldImage]).setName("scaffold");
    const craneImage = this.scene.add.image(12, 10, WORLD_TEXTURES.crane).setOrigin(0.5, 1).setScale(0.78);
    const crane = this.scene.add.container(0, 0, [craneImage]).setName("crane");

    const workerA = this.scene.add.image(-31, 8, "crew-worker").setOrigin(0.5, 1).setScale(0.21);
    const workerB = this.scene.add.image(29, 7, "crew-architect").setOrigin(0.5, 1).setScale(0.2).setFlipX(true);
    const runner = this.scene.add.image(4, 12, "crew-runner").setOrigin(0.5, 1).setScale(0.14);

    const plate = this.scene.add.graphics();
    plate.fillStyle(0x173d29, 0.94);
    plate.fillRoundedRect(-78, -230, 156, 37, 7);
    plate.lineStyle(1, 0xc6dd9a, 0.42);
    plate.strokeRoundedRect(-78, -230, 156, 37, 7);
    const label = this.scene.add.text(-67, -224, eyebrow, {
      fontFamily: "IBM Plex Mono, monospace", fontSize: "7px", color: "#b7df72", fontStyle: "bold",
    });
    const detail = this.scene.add.text(-67, -212, title, {
      fontFamily: "Manrope, sans-serif", fontSize: "9px", color: "#f6f7ec", fontStyle: "bold",
    });
    const barTrack = this.scene.add.rectangle(-67, -198, 134, 2, 0xffffff, 0.17).setOrigin(0, 0.5);
    const bar = this.scene.add.rectangle(-67, -198, 134, 2, 0xb7df72, 0.9).setOrigin(0, 0.5).setScale(0.18, 1);

    const container = this.scene.add.container(x, y, [footprint, scaffold, crane, workerA, workerB, runner, plate, label, detail, barTrack, bar]);
    container.setDepth(depth);

    const loops = [
      this.scene.tweens.add({ targets: workerA, y: "-=3", duration: 540, yoyo: true, repeat: -1, ease: "Sine.InOut" }),
      this.scene.tweens.add({ targets: workerB, y: "-=2", duration: 670, yoyo: true, repeat: -1, ease: "Sine.InOut", delay: 140 }),
      this.scene.tweens.add({ targets: runner, x: "+=18", duration: 980, yoyo: true, repeat: -1, ease: "Sine.InOut" }),
      this.scene.tweens.add({ targets: craneImage, y: "+=2", duration: 1100, yoyo: true, repeat: -1, ease: "Sine.InOut" }),
    ];
    if (looping) {
      loops.push(this.scene.tweens.add({ targets: bar, scaleX: 0.92, duration: 1700, yoyo: true, repeat: -1, ease: "Sine.InOut" }));
    }
    return { container, label, detail, bar, loops };
  }

  private makeDust(x: number, y: number, depth: number): void {
    for (let i = 0; i < 9; i++) {
      const speck = this.scene.add.circle(x + Phaser.Math.Between(-28, 28), y + Phaser.Math.Between(-4, 5), Phaser.Math.Between(2, 5), 0xb6a178, 0.42).setDepth(depth);
      this.scene.tweens.add({
        targets: speck,
        x: speck.x + Phaser.Math.Between(-18, 18),
        y: speck.y - Phaser.Math.Between(15, 36),
        alpha: 0,
        scale: 1.8,
        duration: Phaser.Math.Between(650, 1050),
        delay: Phaser.Math.Between(0, 230),
        onComplete: () => speck.destroy(),
      });
    }
  }

  private makeLeafBurst(x: number, y: number, depth: number): void {
    for (let i = 0; i < 7; i++) {
      const leaf = this.scene.add.ellipse(x, y, 4, 2.3, 0x6d9a4d, 0.8).setDepth(depth).setAngle(Phaser.Math.Between(0, 160));
      this.scene.tweens.add({
        targets: leaf,
        x: x + Phaser.Math.Between(-34, 34),
        y: y + Phaser.Math.Between(-28, 10),
        angle: leaf.angle + Phaser.Math.Between(80, 240),
        alpha: 0,
        duration: Phaser.Math.Between(620, 980),
        onComplete: () => leaf.destroy(),
      });
    }
  }

  private removeSite(site: Site, animate: boolean): void {
    site.loops.forEach((tween) => tween.stop());
    if (!animate) {
      site.container.destroy(true);
      return;
    }
    this.scene.tweens.add({
      targets: site.container,
      alpha: 0,
      y: site.container.y - 7,
      duration: 360,
      ease: "Cubic.In",
      onComplete: () => site.container.destroy(true),
    });
  }
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}
