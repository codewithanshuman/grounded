import { capitolDistrict, inCapitolDistrict, type Building as CityBuilding, type WorldSnapshot } from "@sudo-city/protocol";
import type { Building, Tree, WorldState } from "@verdant/protocol";
import Phaser from "phaser";
import { WorldScene } from "../reference-city/WorldScene";
import { FOCUS_ZOOM, MIN_ZOOM, projection } from "../reference-city/world/core/worldConstants";
import { TILE_ANCHOR_Y } from "../reference-city/textures/core";
import { propTextureKey } from "../reference-city/textures/props";
import { prefersReducedMotion } from "../reference-city/systems/ambient";
import { ARCHITECTURE, bakeArchitecture } from "./landmarks/architecture";
import { addPylonLine, addWindTurbine, bakeEnergy } from "./landmarks/energy";
import { addReserve } from "./landmarks/reserve";
import { CITY_SIZE, FOREST_PLOTS, LANDMARK_SITES, RESERVE, RESERVE_STRUCTURES, insideLandmark } from "./landmarks/worldLayout";
import type { ForestActivity, ForestInspection } from "./GameCanvas";
import { bakeTextures, WORLD_TEXTURES } from "./textures";
import workerUrl from "../../../../assets/world-worker.png";
import architectUrl from "../../../../assets/world-architect.png";
import runnerUrl from "../../../../assets/world-runner.png";
import { RailSystem, type RailStatus } from "./rail/RailSystem";
import { inRailCorridor } from "./rail/railModel";
import { addNorthernDistrict } from "./districts/NorthernDistrict";
import { NORTHERN_MAINLAND, northernShoreline } from "./districts/expansionLayout";
import { addNorthCityBridge } from "./districts/NorthCityBridge";
import { onNorthCityApproach } from "./districts/northBridgeModel";

const CITY_WIDTH = CITY_SIZE.width;
const CITY_HEIGHT = CITY_SIZE.height;

const FACILITY_PATHS = {
  founding: "facility/resilience-lab",
  simulation: "facility/critical-care",
  optimization: "facility/storage-control",
  climate: "facility/solar-field",
} as const;

const STATIC_BUILDINGS: CityBuilding[] = [
  cityBuilding("facility/critical-care", "critical-care", "Python", 4200, 9, 15),
  cityBuilding("facility/solar-field", "generation", "JavaScript", 2600, 1, 19),
  cityBuilding("facility/storage-control", "storage", "Rust", 3300, 31, 19),
  cityBuilding("facility/grid-intertie", "grid", "TypeScript", 3000, 31, 7),
  cityBuilding("facility/resilience-lab", "operations", "SQL", 3800, 7, 7),
  cityBuilding("facility/community-hub", "community", "HTML", 1700, 21, 27),
  cityBuilding("facility/water-security", "critical-care", "Python", 2500, 1, 13),
  cityBuilding("facility/emergency-comms", "operations", "TypeScript", 3100, 13, 7),
  cityBuilding("facility/heat-shelter", "operations", "JavaScript", 2300, 15, 9),
  cityBuilding("facility/microgrid-command", "operations", "Rust", 3900, 33, 15),
  cityBuilding("facility/forecast-tower", "storage", "TypeScript", 3600, 33, 21),
  cityBuilding("facility/recovery-depot", "generation", "SQL", 2100, 15, 27),
  ...LANDMARK_SITES.filter(site => site.kind !== "hospital").map(site => cityBuilding(site.path, "community", "HTML", 2000, site.gx, site.gy)),
];

const STATIC_INSPECTIONS: Record<string, ForestInspection> = {
  "facility/critical-care": contextInspection("Critical-care load", "Priority demand protected by the dispatch model."),
  "facility/solar-field": contextInspection("Solar generation field", "Calibrated solar production supplies the resilience district."),
  "facility/storage-control": contextInspection("Storage control centre", "Reserve policy and battery dispatch are tested here."),
  "facility/grid-intertie": contextInspection("Grid intertie", "Import limits and restoration uncertainty enter through this asset."),
  "facility/resilience-lab": contextInspection("Resilience operations", "Scenario, optimization and validation runs are coordinated here."),
  "facility/community-hub": contextInspection("Community resilience hub", "The model translates infrastructure performance into continuity of service."),
  "facility/water-security": contextInspection("Water security centre", "Illustrative water infrastructure; water-network continuity is not independently simulated."),
  "facility/emergency-comms": contextInspection("Emergency communications", "Keeps incident coordination visible across the resilience district."),
  "facility/heat-shelter": contextInspection("Heat refuge", "Illustrative cooling shelter representing the community served by resilient energy infrastructure."),
  "facility/microgrid-command": contextInspection("Microgrid command", "Coordinates solar, storage and critical-load dispatch policies."),
  "facility/forecast-tower": contextInspection("Forecast tower", "Illustrative weather observatory; climate inputs are supplied through the scenario data pipeline."),
  "facility/recovery-depot": contextInspection("Recovery depot", "Represents crews, spares and restoration logistics after disruption."),
};

const FACILITY_LABELS: Record<string, string> = {
  "facility/critical-care": "CRITICAL CARE",
  "facility/solar-field": "SOLAR FIELD",
  "facility/storage-control": "STORAGE CONTROL",
  "facility/grid-intertie": "GRID INTERTIE",
};

const LEGACY_EVIDENCE_PLOTS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [5, 1], [7, 1], [11, 1], [13, 1], [17, 1], [19, 1], [23, 1], [25, 1], [29, 1], [31, 1], [35, 1],
  [1, 5], [5, 5], [7, 5], [11, 5], [13, 5], [17, 5], [19, 5], [23, 5], [25, 5], [29, 5], [31, 5], [35, 5],
  [1, 23], [5, 23], [7, 23], [11, 23], [13, 23], [17, 23], [19, 23], [23, 23], [25, 23], [29, 23], [31, 23], [35, 23],
  [1, 29], [5, 29], [7, 29], [11, 29], [13, 29], [17, 29], [19, 29], [23, 29], [25, 29], [29, 29], [31, 29], [35, 29],
];

const mall = capitolDistrict(CITY_SIZE);
const occupied = (x: number, y: number) => insideLandmark(x,y) || inCapitolDistrict(mall,x,y)
  || STATIC_BUILDINGS.some(b => Math.abs(b.plot.x-x) < 1.3 && Math.abs(b.plot.y-y) < 1.3);
const EVIDENCE_PLOTS = [...LEGACY_EVIDENCE_PLOTS, ...Array.from({length: 16}, (_,i) => [1+Math.floor(i/2)*6, i%2 ? 35 : 31] as const)]
  .filter(([x,y]) => !occupied(x,y));
const NEIGHBOURHOODS: CityBuilding[] = [];
for (const y of [1,5,7,11,25,29,31]) for (const x of [1,5,13,17,19,23,25,29,31,35,43,47]) {
  if (occupied(x,y) || EVIDENCE_PLOTS.some(([a,b])=>a===x&&b===y) || (x>=43&&y<19)) continue;
  const index=NEIGHBOURHOODS.length;
  NEIGHBOURHOODS.push(cityBuilding(`neighbourhood/${x}/${y}`, "community", ["HTML","CSS","TypeScript","JavaScript"][index%4]!, index%5===0 ? 4100 : 600+index%3*650,x,y));
}

export type CityView = "city" | "north" | "forest" | "bridge" | "landmarks" | "energy" | "rail" | "world";

export class GroundedCityScene extends WorldScene {
  private inspectHandler: ((inspection: ForestInspection) => void) | undefined;
  private evidenceTrees = new Map<string, Phaser.GameObjects.Sprite>();
  private facilityLabels = new Map<string, Phaser.GameObjects.Text>();
  private signatureFacilities = new Map<string, Phaser.GameObjects.Image>();
  private forestReserveObjects: Phaser.GameObjects.GameObject[] = [];
  private latestWorld: WorldState | null = null;
  private activity: ForestActivity = null;
  private hasHydratedWorld = false;
  private reserveBuilt = false;
  private northBuilt = false;
  private northernObjects: Phaser.GameObjects.GameObject[] = [];
  private currentView: CityView = "city";
  private railway?: RailSystem;
  private railStatusHandler?: (status: RailStatus) => void;

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
    bakeArchitecture(this);
    bakeEnergy(this);
    this.events.once("shutdown", () => {
      this.forestReserveObjects.forEach(object => this.tweens.killTweensOf(object));
      this.forestReserveObjects = [];
      this.reserveBuilt = false;
      this.northernObjects.forEach(object => this.tweens.killTweensOf(object));
      this.northernObjects = [];
      this.northBuilt = false;
      this.railway = undefined;
    });
  }

  setInspectHandler(handler: ((inspection: ForestInspection) => void) | undefined): void {
    this.inspectHandler = handler;
  }

  setRailStatusHandler(handler?: (status: RailStatus) => void): void { this.railStatusHandler = handler; this.railway?.setStatusHandler(handler); }
  setRailPaused(paused: boolean): void { this.railway?.setPaused(paused); }
  setRailSpeed(speed: number): void { this.railway?.setSpeed(speed); }

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
    if (!this.northBuilt) {
      this.northBuilt = true;
      this.northernObjects.push(...addNorthernDistrict(this, (title, evidence) => this.inspectHandler?.(contextInspection(title, evidence))), ...addNorthCityBridge(this));
    }
    if (!this.railway) {
      this.railway = new RailSystem(this, (title, evidence) => this.inspectHandler?.(contextInspection(title, evidence)));
      this.railway.setStatusHandler(this.railStatusHandler);
    }
    this.drawSignatureFacilities();
    this.clearLandmarkProps();
    this.expandCameraBounds();
    this.syncEvidenceTrees(world.trees, this.hasHydratedWorld);
    this.syncFacilityLabels();
    this.applyActivity();
    this.hasHydratedWorld = true;
  }

  private drawForestReserve(): void {
    if (this.reserveBuilt) return;
    this.reserveBuilt = true;
    this.forestReserveObjects.push(...addReserve(this));
    const { fieldStation, watchtower, rangerLodge, sensor } = RESERVE_STRUCTURES;
    this.addReserveStructure(fieldStation.gx, fieldStation.gy, "bld-resilienceHall", 1.1, "Forest field station", "Illustrative reserve infrastructure, not independently validated ecology telemetry.");
    this.addReserveStructure(watchtower.gx, watchtower.gy, "bld-watchtower", 1, "Canopy watchtower", "Illustrative observation station. Evidence trees elsewhere link to completed resilience runs.");
    this.addReserveStructure(rangerLodge.gx, rangerLodge.gy, WORLD_TEXTURES.forestCabin, 1.1, "Ranger lodge", "Illustrative conservation workspace; not a claimed real Jaipur facility.");
    this.addReserveStructure(sensor.gx, sensor.gy, WORLD_TEXTURES.forestSensor, 1, "Environmental sensor", "Illustrative sensor; no live field feed is connected.");
    for (const [i,gy] of [3,9,15].entries()) {
      this.forestReserveObjects.push(...addWindTurbine(this,45,gy,{phase:i*65}).objects);
    }
    this.forestReserveObjects.push(...addPylonLine(this,[{gx:45,gy:21},{gx:45,gy:27},{gx:45,gy:33},{gx:39,gy:33}]).objects);
  }

  private clearLandmarkProps(): void {
    for (const prop of this.terrainManager.propSprites) {
      if (prop.texture.key.includes("capitol")) continue;
      const {x,y}=projection.unproject(prop.x,prop.y-TILE_ANCHOR_Y);
      const approach=x>=-6.5&&x<=0.5&&Math.abs(y-12)<1;
      const energy=x>=43.5&&x<=46.5&&y>=1&&y<=34;
      if (insideLandmark(x,y)||approach||energy||inRailCorridor(x,y)||onNorthCityApproach(x,y,.5)) prop.setVisible(false);
    }
  }

  private expandCameraBounds(): void {
    // Include the new coastline in pan bounds instead of clipping it to the old city.
    const north=NORTHERN_MAINLAND;
    const corners=[[-48,-8],[-48,49],[78,49],[north.centerX-north.radiusX,north.centerY-north.radiusY],
      [north.centerX+north.radiusX,north.centerY-north.radiusY],[north.centerX+north.radiusX,north.southShore]];
    const points=corners.map(([x,y])=>projection.project(x!,y!));
    const left=Math.min(...points.map(p=>p.x))-1200, right=Math.max(...points.map(p=>p.x))+1200;
    const top=Math.min(...points.map(p=>p.y))-1200, bottom=Math.max(...points.map(p=>p.y))+1200;
    this.cameras.main.setBounds(left,top,right-left,bottom-top);
  }

  override fitCamera(): void {
    if (!this.cameraController) return;
    this.showDistrict(this.currentView, false);
  }

  override resizeViewport(width: number, height: number): void {
    super.resizeViewport(width, height);
    if (this.latestWorld && this.scene?.isActive()) this.showDistrict(this.currentView, false);
  }

  showDistrict(view: CityView, animate = true): void {
    this.currentView=view;
    this.expandCameraBounds();
    const camera=this.cameras.main;
    let corners: Array<readonly [number,number]>;
    if(view==="forest") corners=[[-45,-3],[-21,-3],[-21,27],[-45,27]];
    else if(view==="north") corners=northernShoreline().map(point=>[point.x,point.y] as const);
    else if(view==="bridge") corners=[[RESERVE.bridgeStart-3,7],[0,7],[0,17],[RESERVE.bridgeStart-3,17]];
    else if(view==="landmarks") corners=[[28,17],[43,17],[43,32],[28,32]];
    else if(view==="energy") corners=[[37,-1],[49,-1],[49,35],[37,35]];
    else if(view==="rail") corners=[[11,-94],[33,-94],[33,-27],[11,-27]];
    else if(view==="world") corners=[...northernShoreline().map(point=>[point.x,point.y] as const),[-45,-3],[74,43],[-15,49],[-45,27]];
    else corners=[[-6,-4],[50,-4],[50,40],[-8,45]];
    const points=corners.map(([x,y])=>projection.project(x,y));
    const left=Math.min(...points.map(p=>p.x))-100, right=Math.max(...points.map(p=>p.x))+100;
    const top=Math.min(...points.map(p=>p.y))-300, bottom=Math.max(...points.map(p=>p.y))+70;
    // Fit below the actual navigation height, not behind it on narrow displays.
    const topInset=camera.width<420?155:camera.width<760?112:72;
    const bottomInset=view==="rail"?78:20;
    const zoom=Phaser.Math.Clamp(Math.min((camera.width-40)/(right-left),(camera.height-topInset-bottomInset)/(bottom-top)),MIN_ZOOM,1);
    const centerY=(top+bottom)/2-(topInset-bottomInset)/(2*zoom);
    if(animate && !prefersReducedMotion()){
      this.cameraController.noteCameraInput();
      this.cameraController.moveCameraTo((left+right)/2,centerY,zoom);
    } else {
      this.cameraController.focusTween?.stop();
      this.cameraController.zoomTarget=zoom;
      camera.setZoom(zoom).centerOn((left+right)/2,centerY);
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
    if (!prefersReducedMotion()) this.tweens.add({ targets: pulse, y: pulse.y - 10, alpha: .95, duration: 1_150, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.forestReserveObjects.push(structure, label, pulse);
  }

  private drawSignatureFacilities(): void {
    // Keep the archive building view: its click, construction crew and crane
    // continue to operate on the real visible sprite, not a hidden placeholder.
    const facilities = [
      {path:"facility/solar-field",texture:WORLD_TEXTURES.solarArray,scale:1.2,anchor:18},
      {path:"facility/storage-control",texture:WORLD_TEXTURES.battery,scale:1.2,anchor:14},
      {path:"facility/grid-intertie",texture:WORLD_TEXTURES.substation,scale:1.2,anchor:18},
      {path:"facility/water-security",texture:"bld-reservoir",scale:1,anchor:16},
      ...LANDMARK_SITES.map(site=>({path:site.path,texture:ARCHITECTURE[site.kind].key,scale:1,anchor:ARCHITECTURE[site.kind].anchorY})),
    ];
    for(const facility of facilities) {
      const view=this.buildingManager.getViews().get(facility.path);
      if(!view) continue;
      const {x,y}=view.building.plot, p=projection.project(x,y);
      const sprite=view.sprite;
      sprite.setTexture(facility.texture).setOrigin(.5,1).setScale(facility.scale)
        .setPosition(p.x,p.y+facility.anchor*facility.scale)
        .setDepth(projection.depth(x,y)+5);
      // Texture padding scales with the sprite; the grid's ground anchor does not.
      sprite.setData("constructionAnchorOffset", facility.anchor*facility.scale-TILE_ANCHOR_Y);
      sprite.setInteractive({ pixelPerfect: true, useHandCursor: true });
      this.signatureFacilities.set(facility.path,sprite);
    }
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
    else {
      const landmark=LANDMARK_SITES.find(site=>site.path===building.path);
      this.inspectHandler?.(contextInspection(landmark?.title ?? "City neighbourhood", "Illustrative city architecture. It is not a surveyed Jaipur building and does not add an independently simulated service."));
    }
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
      const px = gx + (cycle % 3) * .18;
      const py = gy + (Math.floor(cycle / 3) % 3) * .18;
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
    if (prefersReducedMotion()) return;
    const targetScale = tree.species === "ancient" ? 1.34 : tree.species === "sapling" ? 0.78 : 1.08;
    sprite.setAlpha(0).setScale(0.08).setAngle(-4);
    this.cameraController.moveCameraTo(sprite.x, sprite.y - 34, FOCUS_ZOOM);

    const soil = this.add.ellipse(sprite.x, sprite.y - 2, 28, 10, 0x6f4d2d, 0.72).setDepth(sprite.depth - 1);
    const proofRing = this.add.ellipse(sprite.x, sprite.y - 3, 20, 8)
      .setStrokeStyle(2, 0xb7df72, 0.9)
      .setDepth(sprite.depth + 2);
    const label = this.add.text(sprite.x, sprite.y - 92, "Simulation recorded", {
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
      { path: "operations", x: 12, y: 0, width: 36, height: 18, weight: 35 },
      { path: "generation", x: 0, y: 18, width: 18, height: 18, weight: 18 },
      { path: "storage", x: 18, y: 18, width: 30, height: 18, weight: 19 },
    ],
    buildings: [...STATIC_BUILDINGS, ...NEIGHBOURHOODS, ...evidenceBuildings],
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
  return { kind: "building", title, status: "Illustrative system context", evidence, runId: "system-context", occurredAt: 0 };
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
