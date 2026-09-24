import type { Building as CityBuilding, WorldSnapshot } from "@sudo-city/protocol";
import type { Building, Tree, WorldState } from "@verdant/protocol";
import Phaser from "phaser";
import { WorldScene } from "../reference-city/WorldScene";
import { FOCUS_ZOOM, GROUND_DEPTH, projection } from "../reference-city/world/core/worldConstants";
import { TILE_ANCHOR_Y } from "../reference-city/textures/core";
import { propTextureKey } from "../reference-city/textures/props";
import { TERRAIN_ATLAS_KEY, terrainTextureKey } from "../reference-city/textures/terrain";
import type { ForestActivity, ForestInspection } from "./GameCanvas";
import { bakeTextures, WORLD_TEXTURES } from "./textures";
import workerUrl from "../../../../assets/world-worker.png";
import architectUrl from "../../../../assets/world-architect.png";
import runnerUrl from "../../../../assets/world-runner.png";

const CITY_WIDTH = 36;
const CITY_HEIGHT = 30;

const FACILITY_PATHS = {
  founding: "facility/resilience-lab",
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
  cityBuilding("facility/water-security", "critical-care", "Python", 2500, 1, 13),
  cityBuilding("facility/emergency-comms", "operations", "TypeScript", 3100, 13, 7),
  cityBuilding("facility/heat-shelter", "operations", "JavaScript", 2300, 19, 13),
  cityBuilding("facility/microgrid-command", "operations", "Rust", 3900, 25, 13),
  cityBuilding("facility/forecast-tower", "storage", "TypeScript", 3600, 25, 19),
  cityBuilding("facility/recovery-depot", "generation", "SQL", 2100, 13, 25),
];

const STATIC_INSPECTIONS: Record<string, ForestInspection> = {
  "facility/critical-care": contextInspection("Critical-care load", "Priority demand protected by the dispatch model."),
  "facility/solar-field": contextInspection("Solar generation field", "Calibrated solar production supplies the resilience district."),
  "facility/storage-control": contextInspection("Storage control centre", "Reserve policy and battery dispatch are tested here."),
  "facility/grid-intertie": contextInspection("Grid intertie", "Import limits and restoration uncertainty enter through this asset."),
  "facility/resilience-lab": contextInspection("Resilience operations", "Scenario, optimization and validation runs are coordinated here."),
  "facility/community-hub": contextInspection("Community resilience hub", "The model translates infrastructure performance into continuity of service."),
  "facility/water-security": contextInspection("Water security centre", "Models water continuity during heat, outage and restoration scenarios."),
  "facility/emergency-comms": contextInspection("Emergency communications", "Keeps incident coordination visible across the resilience district."),
  "facility/heat-shelter": contextInspection("Heat refuge", "Tests continuity for a community cooling and shelter facility."),
  "facility/microgrid-command": contextInspection("Microgrid command", "Coordinates solar, storage and critical-load dispatch policies."),
  "facility/forecast-tower": contextInspection("Forecast tower", "Monitors the climate and grid signals used by the scenario engine."),
  "facility/recovery-depot": contextInspection("Recovery depot", "Represents crews, spares and restoration logistics after disruption."),
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
  [-14, 7], [-12, 7], [-9, 7], [-13, 9], [-10, 9], [-14, 11], [-12, 11], [-9, 11],
  [-8, 12], [-14, 14], [-12, 14], [-9, 14], [-13, 16], [-10, 16], [-15, 10], [-8, 15],
];

export class GroundedCityScene extends WorldScene {
  private inspectHandler: ((inspection: ForestInspection) => void) | undefined;
  private evidenceTrees = new Map<string, Phaser.GameObjects.Sprite>();
  private facilityLabels = new Map<string, Phaser.GameObjects.Text>();
  private signatureFacilities = new Map<string, Phaser.GameObjects.Image>();
  private forestReserveObjects: Phaser.GameObjects.GameObject[] = [];
  private latestWorld: WorldState | null = null;
  private activity: ForestActivity = null;
  private hasHydratedWorld = false;

  constructor() {
    super();
    this.setSelectionListener((building) => this.inspectBuilding(building));
  }

  override create(): void {
    super.create();
    // The reference city supplies the authored airport, harbour, capitol and
    // road system. Grounded's extra reserve and infrastructure textures extend
    // that same world rather than replacing it with a decorative overlay.
    bakeTextures(this);
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
    this.signatureFacilities.clear();

    // Paint an explicit tiled channel before any land. The old scene relied on
    // the camera background for this gap, which made the crossing read as a
    // bridge laid across grass. These animated blue tiles establish a real
    // water body between two independent shorelines.
    for (let gx = -8; gx <= -1; gx += 1) {
      for (let gy = 7; gy <= 15; gy += 1) {
        const point = projection.project(gx, gy);
        const water = this.add.sprite(
          point.x,
          point.y + TILE_ANCHOR_Y,
          WORLD_TEXTURES.water[Math.abs(gx * 7 + gy * 5) % WORLD_TEXTURES.water.length]!,
        ).setOrigin(0.5, 1).setDepth(GROUND_DEPTH + 1);
        this.forestReserveObjects.push(water);
      }
    }

    // Authored reserve island: sand shoreline, planted interior and a pair of
    // connected trails. Its east shore stops at x=-7; the mainland begins at
    // x=0, leaving six complete water cells under the bridge.
    for (let gx = -16; gx <= -7; gx += 1) {
      for (let gy = 4; gy <= 18; gy += 1) {
        const dx = (gx + 11.5) / 5.2;
        const dy = (gy - 11) / 7.65;
        const distance = dx * dx + dy * dy;
        if (distance > 1.08) continue;
        const edge = distance > 0.71;
        const trail = !edge && ((gy === 11 && gx >= -14) || (gx === -11 && gy >= 7 && gy <= 16));
        const point = projection.project(gx, gy);
        const sprite = this.add.sprite(
          point.x,
          point.y + TILE_ANCHOR_Y,
          TERRAIN_ATLAS_KEY,
          terrainTextureKey(edge || trail ? "sand" : "park", Math.abs(gx * 11 + gy * 7) % 2),
        ).setOrigin(0.5, 1).setDepth(GROUND_DEPTH + 5);
        this.forestReserveObjects.push(sprite);
      }
    }

    const wetlandPoint = projection.project(-14, 10);
    const wetland = this.add.image(wetlandPoint.x, wetlandPoint.y + TILE_ANCHOR_Y, WORLD_TEXTURES.wetland)
      .setOrigin(0.5, 1).setDepth(GROUND_DEPTH + 7).setScale(1.12);
    this.forestReserveObjects.push(wetland);

    this.drawForestBridge();

    // Deliberate groves use the fuller vegetation library from the supplied
    // city reference: broadleaf, flowering, ancient, pine, palm and understory.
    const contextTrees: ReadonlyArray<readonly [number, number, string, number]> = [
      [-15, 7, "tree-ancient", .82], [-13, 6, "tree-oak", .74], [-9, 6, WORLD_TEXTURES.pine, .96],
      [-15, 13, "tree-flowering", .78], [-13, 15, "tree-oak", .84], [-8, 14, WORLD_TEXTURES.palm, .88],
      [-15, 11, WORLD_TEXTURES.bush, .76], [-12, 8, "tree-flowering", .72], [-8, 7, "tree-ancient", .78],
      [-14, 17, WORLD_TEXTURES.pine, .92], [-8, 16, "tree-oak", .78], [-12, 17, WORLD_TEXTURES.bush, .74],
      [-10, 13, "tree-ancient", .76], [-13, 12, WORLD_TEXTURES.palm, .78], [-9, 17, "tree-flowering", .72],
    ];
    contextTrees.forEach(([gx, gy, key, scale], index) => {
      const point = projection.project(gx, gy);
      const tree = this.add.image(point.x, point.y + TILE_ANCHOR_Y, key)
        .setOrigin(0.5, 1)
        .setDepth(projection.depth(gx, gy) + 1)
        .setScale(scale);
      if (key !== WORLD_TEXTURES.bush && index % 3 === 0) {
        this.tweens.add({ targets: tree, angle: index % 2 === 0 ? 1.1 : -1.1, duration: 2_700 + index * 65, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      }
      this.forestReserveObjects.push(tree);
    });

    this.addReserveStructure(-11, 6, "bld-resilienceHall", .69, "Forest operations pavilion", "Coordinates canopy, heat and habitat monitoring for the reserve.");
    this.addReserveStructure(-8, 9, "bld-watchtower", .66, "Canopy watchtower", "A modelled observation point for heat, wind and fire-risk sensing.");
    this.addReserveStructure(-14, 15, WORLD_TEXTURES.forestCabin, .78, "Field ecology lab", "A modelled workspace for ground-truth sampling and restoration crews.");
    this.addReserveStructure(-10, 16, WORLD_TEXTURES.forestSensor, .78, "Biodiversity sensor", "Represents non-personal environmental sensing inside the reserve.");

    // Waterline glints make the separation legible even at the default camera
    // zoom without adding labels or interface chrome.
    for (const [gx, gy, delay] of [[-7.2, 8.2, 0], [-6.2, 10.2, 360], [-5.2, 12.4, 720], [-3.2, 14.1, 1_080]] as const) {
      const point = projection.project(gx, gy);
      const glint = this.add.image(point.x, point.y + 4, WORLD_TEXTURES.sparkle)
        .setDepth(GROUND_DEPTH + 10).setScale(1.5, .8).setAlpha(.28);
      this.tweens.add({ targets: glint, x: glint.x + 18, alpha: .76, duration: 1_500, delay, yoyo: true, repeat: -1, ease: "Sine.InOut" });
      this.forestReserveObjects.push(glint);
    }

    this.drawSignatureFacilities();
  }

  private drawForestBridge(): void {
    const bridge = this.add.graphics().setDepth(GROUND_DEPTH + 14);
    const centers = Array.from({ length: 8 }, (_, index) => projection.project(-7 + index, 11));

    // Reflections, masonry piers and their waterline shadows sit below the
    // deck. Drawing these explicitly is what makes the span feel supported.
    for (const index of [2, 4, 6]) {
      const point = centers[index]!;
      bridge.fillStyle(0x1b779e, 0.34);
      bridge.fillEllipse(point.x, point.y + 42, 50, 13);
      bridge.fillStyle(0x706653, 1);
      bridge.fillPoints([
        new Phaser.Geom.Point(point.x - 8, point.y + 4),
        new Phaser.Geom.Point(point.x + 8, point.y + 11),
        new Phaser.Geom.Point(point.x + 8, point.y + 43),
        new Phaser.Geom.Point(point.x - 8, point.y + 36),
      ], true);
      bridge.fillStyle(0x9a8f75, 1);
      bridge.fillRect(point.x - 11, point.y + 6, 22, 7);
    }

    centers.forEach((point, index) => {
      const top = new Phaser.Geom.Point(point.x, point.y - 18);
      const right = new Phaser.Geom.Point(point.x + 39, point.y);
      const bottom = new Phaser.Geom.Point(point.x, point.y + 18);
      const left = new Phaser.Geom.Point(point.x - 39, point.y);
      bridge.fillStyle(index % 2 === 0 ? 0xc8a66e : 0xb9905b, 1);
      bridge.fillPoints([top, right, bottom, left], true);
      bridge.lineStyle(1, 0x6d4b2d, 0.72);
      bridge.strokePoints([top, right, bottom, left], true);
      bridge.lineBetween(left.x + 13, left.y + 6, right.x - 13, right.y - 6);
    });

    const first = centers[0]!;
    const last = centers[centers.length - 1]!;
    const sideAStart = { x: first.x - 18, y: first.y + 9 };
    const sideAEnd = { x: last.x - 18, y: last.y + 9 };
    const sideBStart = { x: first.x + 18, y: first.y - 9 };
    const sideBEnd = { x: last.x + 18, y: last.y - 9 };
    bridge.lineStyle(3, 0x285a43, 1);
    bridge.lineBetween(sideAStart.x, sideAStart.y - 18, sideAEnd.x, sideAEnd.y - 18);
    bridge.lineBetween(sideBStart.x, sideBStart.y - 18, sideBEnd.x, sideBEnd.y - 18);
    bridge.lineStyle(2, 0x6f9d75, 1);
    bridge.lineBetween(sideAStart.x, sideAStart.y - 9, sideAEnd.x, sideAEnd.y - 9);
    bridge.lineBetween(sideBStart.x, sideBStart.y - 9, sideBEnd.x, sideBEnd.y - 9);

    centers.forEach((point, index) => {
      if (index % 2 !== 0 && index !== centers.length - 1) return;
      for (const side of [-1, 1]) {
        const x = point.x + side * 18;
        const y = point.y - side * 9;
        bridge.lineStyle(3, 0x285a43, 1);
        bridge.lineBetween(x, y + 3, x, y - 22);
        bridge.fillStyle(0xf2cf70, 0.95);
        bridge.fillCircle(x, y - 24, 3.5);
        bridge.fillStyle(0xf4df8d, 0.18);
        bridge.fillCircle(x, y - 24, 9);
      }
    });
    this.forestReserveObjects.push(bridge);

    // Stone abutments visually lock both ends into land instead of letting
    // the timber deck terminate over open water.
    for (const gx of [-7.45, 0.45]) {
      const point = projection.project(gx, 11);
      const abutment = this.add.graphics().setDepth(GROUND_DEPTH + 13);
      abutment.fillStyle(0x8d856f, 1);
      abutment.fillPoints([
        new Phaser.Geom.Point(point.x - 29, point.y - 2),
        new Phaser.Geom.Point(point.x, point.y - 16),
        new Phaser.Geom.Point(point.x + 29, point.y - 2),
        new Phaser.Geom.Point(point.x, point.y + 13),
      ], true);
      abutment.lineStyle(2, 0xb5aa90, 1);
      abutment.strokePoints([
        new Phaser.Geom.Point(point.x - 29, point.y - 2),
        new Phaser.Geom.Point(point.x, point.y - 16),
        new Phaser.Geom.Point(point.x + 29, point.y - 2),
        new Phaser.Geom.Point(point.x, point.y + 13),
      ], true);
      this.forestReserveObjects.push(abutment);
    }
  }

  private addReserveStructure(
    gx: number,
    gy: number,
    texture: string,
    scale: number,
    title: string,
    evidence: string,
  ): void {
    const point = projection.project(gx, gy);
    const structure = this.add.image(point.x, point.y + TILE_ANCHOR_Y, texture)
      .setOrigin(0.5, 1)
      .setDepth(projection.depth(gx, gy) + 3)
      .setScale(scale)
      .setInteractive({ useHandCursor: true });
    const label = this.add.text(structure.x, structure.getTopCenter().y - 5, title.toUpperCase(), {
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: "7px",
      color: "#f4f8dd",
      backgroundColor: "#173f2de8",
      padding: { x: 6, y: 4 },
    }).setOrigin(.5, 1).setDepth(structure.depth + 8).setVisible(false);
    const pulse = this.add.image(structure.x + 18, structure.y - 18, WORLD_TEXTURES.energyPulse)
      .setDepth(structure.depth + 5).setScale(.42).setAlpha(.35);

    structure.on("pointerover", () => {
      structure.setScale(scale * 1.045);
      label.setVisible(true);
    });
    structure.on("pointerout", () => {
      structure.setScale(scale);
      label.setVisible(false);
    });
    structure.on("pointerup", () => this.inspectHandler?.(contextInspection(title, evidence)));
    this.tweens.add({ targets: pulse, y: pulse.y - 10, alpha: .95, duration: 1_150, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.forestReserveObjects.push(structure, label, pulse);
  }

  private drawSignatureFacilities(): void {
    const facilities: ReadonlyArray<{
      path: string;
      gx: number;
      gy: number;
      texture: string;
      scale: number;
    }> = [
      { path: "facility/critical-care", gx: 7, gy: 13, texture: WORLD_TEXTURES.hospital, scale: .66 },
      { path: "facility/solar-field", gx: 1, gy: 19, texture: WORLD_TEXTURES.solarArray, scale: .76 },
      { path: "facility/storage-control", gx: 31, gy: 19, texture: WORLD_TEXTURES.battery, scale: .79 },
      { path: "facility/grid-intertie", gx: 31, gy: 7, texture: WORLD_TEXTURES.substation, scale: .78 },
      { path: "facility/water-security", gx: 1, gy: 13, texture: "bld-reservoir", scale: .69 },
      { path: "facility/emergency-comms", gx: 13, gy: 7, texture: "bld-watchtower", scale: .67 },
      { path: "facility/heat-shelter", gx: 19, gy: 13, texture: "bld-resilienceHall", scale: .68 },
      { path: "facility/microgrid-command", gx: 25, gy: 13, texture: WORLD_TEXTURES.cityOffice, scale: .62 },
      { path: "facility/forecast-tower", gx: 25, gy: 19, texture: WORLD_TEXTURES.cityTower, scale: .59 },
      { path: "facility/recovery-depot", gx: 13, gy: 25, texture: WORLD_TEXTURES.portWarehouse, scale: .68 },
    ];

    facilities.forEach(({ path, gx, gy, texture, scale }) => {
      const point = projection.project(gx, gy);
      const underlying = this.buildingManager.getViews().get(path)?.sprite;
      underlying?.setVisible(false);
      const image = this.add.image(point.x, point.y + TILE_ANCHOR_Y, texture)
        .setOrigin(.5, 1)
        .setDepth(projection.depth(gx, gy) + 5)
        .setScale(scale)
        .setInteractive({ useHandCursor: true });
      image.on("pointerover", () => image.setScale(scale * 1.04));
      image.on("pointerout", () => image.setScale(scale));
      image.on("pointerup", () => {
        const inspection = STATIC_INSPECTIONS[path];
        if (inspection) this.inspectHandler?.(inspection);
      });
      this.signatureFacilities.set(path, image);
      this.forestReserveObjects.push(image);
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
    const sprite = this.activity === "optimization" || this.activity === "founding" ? architectUrl : this.activity === "climate" ? runnerUrl : workerUrl;
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
      const signature = this.signatureFacilities.get(path);
      const x = signature?.x ?? view.sprite.x;
      const y = signature ? signature.getTopCenter().y - 7 : view.sprite.y - view.sprite.displayHeight - 7;
      const depth = (signature?.depth ?? view.sprite.depth) + 8;
      const existing = this.facilityLabels.get(path);
      if (existing) {
        existing.setPosition(x, y).setDepth(depth);
        continue;
      }
      const text = this.add.text(x, y, label, {
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: "7px",
        color: "#f4f8dd",
        backgroundColor: "#163e2ce8",
        padding: { x: 5, y: 3 },
      }).setOrigin(0.5, 1).setDepth(depth);
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
