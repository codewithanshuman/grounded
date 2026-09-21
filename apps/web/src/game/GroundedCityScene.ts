import type { Building as CityBuilding, WorldSnapshot } from "@sudo-city/protocol";
import type { Building, Tree, WorldState } from "@verdant/protocol";
import Phaser from "phaser";
import { WorldScene } from "../reference-city/WorldScene";
import { FOCUS_ZOOM, GROUND_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { TILE_ANCHOR_Y } from "../reference-city/textures/core";
import { propTextureKey } from "../reference-city/textures/props";
import { roadTextureKey, TERRAIN_ATLAS_KEY, terrainTextureKey } from "../reference-city/textures/terrain";
import type { ForestActivity, ForestInspection } from "./GameCanvas";
import workerUrl from "../../../../assets/world-worker.png";
import architectUrl from "../../../../assets/world-architect.png";
import runnerUrl from "../../../../assets/world-runner.png";

const CITY_WIDTH = 36;
const CITY_HEIGHT = 30;

const FACILITY_PATHS = {
  simulation: "facility/critical-care",
  optimization: "facility/storage-control",
  climate: "facility/solar-field",
} as const;

const STATIC_BUILDINGS: CityBuilding[] = [
  cityBuilding("facility/critical-care", "critical-care", "Python", 4200, 7, 13),
  cityBuilding("facility/solar-field", "generation", "JavaScript", 2600, 1, 19),
  cityBuilding("facility/storage-control", "storage", "Rust", 3300, 31, 19),
  cityBuilding("facility/grid-intertie", "grid", "TypeScript", 3000, 31, 7),
  cityBuilding("facility/resilience-lab", "operations", "SQL", 3800, 7, 7),
  cityBuilding("facility/community-hub", "community", "HTML", 1700, 25, 25),
];

const STATIC_INSPECTIONS: Record<string, ForestInspection> = {
  "facility/critical-care": contextInspection("Critical-care load", "Priority demand protected by the dispatch model."),
  "facility/solar-field": contextInspection("Solar generation field", "Calibrated solar production supplies the resilience district."),
  "facility/storage-control": contextInspection("Storage control centre", "Reserve policy and battery dispatch are tested here."),
  "facility/grid-intertie": contextInspection("Grid intertie", "Import limits and restoration uncertainty enter through this asset."),
  "facility/resilience-lab": contextInspection("Resilience operations", "Scenario, optimization and validation runs are coordinated here."),
  "facility/community-hub": contextInspection("Community resilience hub", "The model translates infrastructure performance into continuity of service."),
};

const FACILITY_LABELS: Record<string, string> = {
  "facility/critical-care": "CRITICAL CARE",
  "facility/solar-field": "SOLAR FIELD",
  "facility/storage-control": "STORAGE CONTROL",
  "facility/grid-intertie": "GRID INTERTIE",
};

const EVIDENCE_PLOTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [5, 1], [7, 1], [11, 1], [13, 1], [17, 1], [19, 1], [23, 1], [25, 1], [29, 1], [31, 1], [35, 1],
  [1, 5], [5, 5], [7, 5], [11, 5], [13, 5], [17, 5], [19, 5], [23, 5], [25, 5], [29, 5], [31, 5], [35, 5],
  [1, 23], [5, 23], [7, 23], [11, 23], [13, 23], [17, 23], [19, 23], [23, 23], [25, 23], [29, 23], [31, 23], [35, 23],
  [1, 29], [5, 29], [7, 29], [11, 29], [13, 29], [17, 29], [19, 29], [23, 29], [25, 29], [29, 29], [31, 29], [35, 29],
];

const FOREST_PLOTS: ReadonlyArray<readonly [number, number]> = [
  [-9, 7], [-7, 7], [-5, 8], [-8, 9], [-6, 9], [-10, 11], [-8, 11], [-6, 11],
  [-5, 12], [-9, 13], [-7, 13], [-5, 14], [-8, 15], [-6, 15], [-10, 9], [-4, 10],
];

export class GroundedCityScene extends WorldScene {
  private inspectHandler: ((inspection: ForestInspection) => void) | undefined;
  private evidenceTrees = new Map<string, Phaser.GameObjects.Sprite>();
  private facilityLabels = new Map<string, Phaser.GameObjects.Text>();
  private forestReserveObjects: Phaser.GameObjects.GameObject[] = [];
  private latestWorld: WorldState | null = null;
  private activity: ForestActivity = null;
  private hasHydratedWorld = false;

  constructor() {
    super();
    this.setSelectionListener((building) => this.inspectBuilding(building));
  }

  setInspectHandler(handler: ((inspection: ForestInspection) => void) | undefined): void {
    this.inspectHandler = handler;
  }

  setGroundedWorld(world: WorldState): void {
    this.latestWorld = world;
    const snapshot = snapshotFor(world);
    super.setWorld(snapshot, "main", "grounded-jaipur");
    this.setRepoIdentity({
      owner: "Grounded",
      name: "Jaipur Resilience",
      artwork: "/ads/grounded-airport.jpg",
      background: "#163e2c",
    });
    this.drawForestReserve();
    this.syncEvidenceTrees(world.trees, this.hasHydratedWorld);
    this.syncFacilityLabels();
    this.applyActivity();
    this.hasHydratedWorld = true;
  }

  private drawForestReserve(): void {
    this.forestReserveObjects.forEach((object) => object.destroy());
    this.forestReserveObjects = [];

    for (let gx = -11; gx <= -3; gx += 1) {
      for (let gy = 5; gy <= 17; gy += 1) {
        const dx = (gx + 7) / 4.7;
        const dy = (gy - 11) / 6.7;
        const distance = dx * dx + dy * dy;
        if (distance > 1.12) continue;
        const edge = distance > 0.76;
        const point = projection.project(gx, gy);
        const sprite = this.add.sprite(
          point.x,
          point.y + TILE_ANCHOR_Y,
          TERRAIN_ATLAS_KEY,
          terrainTextureKey(edge ? "sand" : "park", Math.abs(gx * 11 + gy * 7) % 2),
        ).setOrigin(0.5, 1).setDepth(GROUND_DEPTH + 5);
        this.forestReserveObjects.push(sprite);
      }
    }

    for (let gx = -4; gx <= 1; gx += 1) {
      const point = projection.project(gx, 10);
      const deck = this.add.sprite(point.x, point.y + TILE_ANCHOR_Y, TERRAIN_ATLAS_KEY, roadTextureKey(10, "lane"))
        .setOrigin(0.5, 1)
        .setDepth(GROUND_DEPTH + 12);
      this.forestReserveObjects.push(deck);
    }

    const bridgeStart = projection.project(-4.55, 10);
    const bridgeEnd = projection.project(1.55, 10);
    const rails = this.add.graphics().setDepth(GROUND_DEPTH + 14);
    rails.lineStyle(2, 0x775c3a, 0.95);
    rails.lineBetween(bridgeStart.x, bridgeStart.y + 8, bridgeEnd.x, bridgeEnd.y + 8);
    rails.lineBetween(bridgeStart.x, bridgeStart.y + 34, bridgeEnd.x, bridgeEnd.y + 34);
    for (let step = 0; step <= 6; step += 1) {
      const t = step / 6;
      const x = Phaser.Math.Linear(bridgeStart.x, bridgeEnd.x, t);
      const y = Phaser.Math.Linear(bridgeStart.y, bridgeEnd.y, t);
      rails.lineBetween(x, y + 7, x, y + 35);
    }
    this.forestReserveObjects.push(rails);

    const contextTrees: ReadonlyArray<readonly [number, number, "tree" | "pine" | "bush"]> = [
      [-10, 7, "pine"], [-8, 6, "tree"], [-5, 7, "pine"], [-10, 15, "tree"], [-7, 16, "pine"], [-4, 14, "tree"],
      [-11, 11, "bush"], [-6, 6, "bush"], [-4, 16, "bush"], [-9, 16, "tree"], [-5, 16, "pine"],
    ];
    contextTrees.forEach(([gx, gy, kind], index) => {
      const point = projection.project(gx, gy);
      const tree = this.add.sprite(point.x, point.y + TILE_ANCHOR_Y, propTextureKey(kind))
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(gx, gy) + 1)
        .setScale(kind === "bush" ? 0.84 : 1.08 + (index % 3) * 0.08);
      this.forestReserveObjects.push(tree);
    });
  }

  setActivity(activity: ForestActivity): void {
    this.activity = activity;
    this.applyActivity();
  }

  private applyActivity(): void {
    if (!this.latestWorld || !this.activity) {
      this.setCrews([]);
      return;
    }
    const sprite = this.activity === "optimization" ? architectUrl : this.activity === "climate" ? runnerUrl : workerUrl;
    this.setCrews([{ sessionId: "grounded-live-analysis", sprite, paths: [FACILITY_PATHS[this.activity]] }]);
  }

  private inspectBuilding(building?: CityBuilding): void {
    if (!building) return;
    const dynamic = this.latestWorld?.buildings.find((candidate) => evidenceBuildingPath(candidate) === building.path);
    if (dynamic) {
      this.inspectHandler?.({
        kind: "building",
        title: buildingName(dynamic),
        status: "Verified resilience milestone",
        evidence: dynamic.milestone,
        runId: dynamic.runId,
        occurredAt: dynamic.grownAt,
      });
      return;
    }
    const context = STATIC_INSPECTIONS[building.path];
    if (context) this.inspectHandler?.(context);
  }

  private syncEvidenceTrees(trees: Tree[], animateNew: boolean): void {
    const seen = new Set(trees.map((tree) => tree.id));
    for (const [id, sprite] of this.evidenceTrees) {
      if (!seen.has(id)) {
        sprite.destroy();
        this.evidenceTrees.delete(id);
      }
    }

    trees.forEach((tree, index) => {
      if (this.evidenceTrees.has(tree.id)) return;
      const [gx, gy] = FOREST_PLOTS[index % FOREST_PLOTS.length]!;
      const cycle = Math.floor(index / FOREST_PLOTS.length);
      const px = gx - cycle * 0.38;
      const py = gy + (cycle % 3) * 0.46;
      const point = projection.project(px, py);
      const key = tree.species === "sapling" ? propTextureKey("bush") : tree.species === "ancient" ? propTextureKey("pine") : propTextureKey("tree");
      const sprite = this.add.sprite(point.x, point.y + TILE_ANCHOR_Y, key)
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(px, py) + 2)
        .setScale(tree.species === "ancient" ? 1.34 : tree.species === "sapling" ? 0.78 : 1.08)
        .setInteractive({ useHandCursor: true });
      if (tree.species === "flowering") sprite.setTint(0xf0c1cc);
      sprite.setData("evidenceTree", true);
      sprite.on("pointerup", () => this.inspectHandler?.({
        kind: "tree",
        title: `${titleCase(tree.species)} evidence tree`,
        status: "Verified simulation",
        evidence: "Planted only after a completed, reproducible resilience run.",
        runId: tree.runId,
        occurredAt: tree.plantedAt,
      }));
      sprite.on("pointerover", () => sprite.setScale(sprite.scaleX * 1.08, sprite.scaleY * 1.08));
      sprite.on("pointerout", () => sprite.setScale(tree.species === "ancient" ? 1.34 : tree.species === "sapling" ? 0.78 : 1.08));
      this.evidenceTrees.set(tree.id, sprite);

      if (animateNew) {
        this.revealEvidenceTree(tree, sprite);
      }
    });
  }

  /** Turns a completed simulation into an unmistakable, inspectable city event. */
  private revealEvidenceTree(tree: Tree, sprite: Phaser.GameObjects.Sprite): void {
    const targetScale = tree.species === "ancient" ? 1.34 : tree.species === "sapling" ? 0.78 : 1.08;
    sprite.setAlpha(0).setScale(0.08).setAngle(-4);
    this.cameraController.moveCameraTo(sprite.x, sprite.y - 34, FOCUS_ZOOM);

    const soil = this.add.ellipse(sprite.x, sprite.y - 2, 28, 10, 0x6f4d2d, 0.72).setDepth(sprite.depth - 1);
    const proofRing = this.add.ellipse(sprite.x, sprite.y - 3, 20, 8)
      .setStrokeStyle(2, 0xb7df72, 0.9)
      .setDepth(sprite.depth + 2);
    const label = this.add.text(sprite.x, sprite.y - 92, "RUN VERIFIED\nEVIDENCE TREE PLANTED", {
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: "7px",
      color: "#f6f7ec",
      backgroundColor: "#163e2cf2",
      align: "center",
      padding: { x: 7, y: 5 },
    }).setOrigin(0.5, 1).setDepth(sprite.depth + 6).setAlpha(0).setScale(0.92);

    const crewKey = `crew:${workerUrl}`;
    const crew = this.textures.exists(crewKey)
      ? this.add.sprite(sprite.x - 27, sprite.y + 2, crewKey).setOrigin(0.5, 1).setDepth(sprite.depth + 4)
      : undefined;
    if (crew) crew.setScale(46 / crew.height).setAlpha(0);

    this.tweens.add({
      targets: sprite,
      alpha: 1,
      scaleX: targetScale,
      scaleY: targetScale,
      angle: 0,
      duration: 920,
      ease: "Back.Out",
    });
    this.tweens.add({ targets: proofRing, scale: 3, alpha: 0, duration: 1_050, ease: "Cubic.Out", onComplete: () => proofRing.destroy() });
    this.tweens.add({ targets: soil, scaleX: 1.3, alpha: 0.38, duration: 900, ease: "Cubic.Out" });
    this.tweens.add({ targets: label, alpha: 1, scale: 1, y: label.y - 5, duration: 420, delay: 380, ease: "Back.Out" });
    if (crew) {
      this.tweens.add({ targets: crew, alpha: 1, x: crew.x + 5, duration: 320, ease: "Cubic.Out" });
      this.tweens.add({ targets: crew, y: crew.y - 3, duration: 420, yoyo: true, repeat: 2, delay: 320, ease: "Sine.InOut" });
    }

    for (let index = 0; index < 10; index += 1) {
      const leaf = this.add.ellipse(sprite.x, sprite.y - 28, 4, 2, 0x78a94f, 0.9)
        .setDepth(sprite.depth + 3)
        .setAngle(Phaser.Math.Between(0, 180));
      this.tweens.add({
        targets: leaf,
        x: leaf.x + Phaser.Math.Between(-38, 38),
        y: leaf.y + Phaser.Math.Between(-35, 12),
        angle: leaf.angle + Phaser.Math.Between(90, 260),
        alpha: 0,
        duration: Phaser.Math.Between(720, 1_150),
        delay: Phaser.Math.Between(260, 620),
        onComplete: () => leaf.destroy(),
      });
    }

    this.time.delayedCall(2_200, () => {
      this.tweens.add({
        targets: [label, soil, ...(crew ? [crew] : [])],
        alpha: 0,
        duration: 320,
        onComplete: () => {
          label.destroy();
          soil.destroy();
          crew?.destroy();
        },
      });
    });
  }

  private syncFacilityLabels(): void {
    for (const [path, label] of Object.entries(FACILITY_LABELS)) {
      const view = this.buildingManager.getViews().get(path);
      if (!view) continue;
      const existing = this.facilityLabels.get(path);
      if (existing) {
        existing.setPosition(view.sprite.x, view.sprite.y - view.sprite.displayHeight - 7).setDepth(view.sprite.depth + 8);
        continue;
      }
      const text = this.add.text(view.sprite.x, view.sprite.y - view.sprite.displayHeight - 7, label, {
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: "7px",
        color: "#f4f8dd",
        backgroundColor: "#163e2ce8",
        padding: { x: 5, y: 3 },
      }).setOrigin(0.5, 1).setDepth(view.sprite.depth + 8);
      this.facilityLabels.set(path, text);
    }
  }
}

function snapshotFor(world: WorldState): WorldSnapshot {
  const evidenceBuildings = world.buildings.map((building, index) => {
    const [x, y] = EVIDENCE_PLOTS[index % EVIDENCE_PLOTS.length]!;
    return cityBuilding(
      evidenceBuildingPath(building),
      "verified-evidence",
      languageFor(building),
      1100 + index * 280,
      x,
      y,
    );
  });
  return {
    id: "grounded-jaipur",
    repoPath: "grounded/jaipur-resilience",
    revision: `${world.totalRuns}:${world.buildings.length}:${world.trees.length}`,
    generatedAt: new Date().toISOString(),
    size: { width: CITY_WIDTH, height: CITY_HEIGHT },
    layoutVersion: 2,
    districts: [
      { path: "critical-care", x: 0, y: 0, width: 12, height: 18, weight: 28 },
      { path: "operations", x: 12, y: 0, width: 24, height: 18, weight: 35 },
      { path: "generation", x: 0, y: 18, width: 18, height: 12, weight: 18 },
      { path: "storage", x: 18, y: 18, width: 18, height: 12, weight: 19 },
    ],
    buildings: [...STATIC_BUILDINGS, ...evidenceBuildings],
  };
}

function cityBuilding(path: string, district: string, language: string, loc: number, x: number, y: number): CityBuilding {
  return { path, district, language, loc, plot: { x, y } };
}

function evidenceBuildingPath(building: Building): string {
  return `evidence/${building.kind}/${building.id}`;
}

function languageFor(building: Building): string {
  const languages: Record<Building["kind"], string> = {
    watchtower: "TypeScript",
    reservoir: "Python",
    solarHall: "JavaScript",
    resilienceHall: "Rust",
  };
  return languages[building.kind];
}

function buildingName(building: Building): string {
  const labels: Record<Building["kind"], string> = {
    watchtower: "Reliability watchtower",
    reservoir: "Resilience reservoir",
    solarHall: "Solar operations hall",
    resilienceHall: "Community resilience hall",
  };
  return labels[building.kind];
}

function contextInspection(title: string, evidence: string): ForestInspection {
  return { kind: "building", title, status: "Modelled system asset", evidence, runId: "system-context", occurredAt: 0 };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
