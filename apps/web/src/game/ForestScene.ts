import Phaser from "phaser";
import { FOREST_GRID_SIZE, HALF_H, HALF_W, toScreen, depthOf } from "./iso";
import { bakeTextures, roadTextureKey, trailTextureKey, WORLD_TEXTURES, type WorldRoadClass } from "./textures";
import { LiveConstruction, type ForestActivity } from "./LiveConstruction";
import type { Building, GrowthEvent, Tree, WorldState } from "@verdant/protocol";
import workerUrl from "../../../../assets/world-worker.png";
import architectUrl from "../../../../assets/world-architect.png";
import runnerUrl from "../../../../assets/world-runner.png";

export const FOREST_READY_EVENT = "forest-ready";

/* The evidence protocol intentionally stores growth in a compact 24×24 field,
   but the visible operating district is larger.  This mirrors the reference
   city's authored island: verified objects stay on their stable coordinates
   while contextual neighbourhoods, the airport and the port complete the
   world around them. */
const CITY_GRID_SIZE = 30;
const WORLD_MIN_X = -13;
const WORLD_MIN_Y = -6;
const WORLD_MAX_X = 37;
const WORLD_MAX_Y = 35;

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
  private contextStructures = new Map<string, Phaser.GameObjects.Image>();

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
    this.drawForestReserve();
    this.drawCityContext();
    this.drawInfrastructure();
    this.drawStrategicFacilities();
    this.spawnEnergyNetwork();
    this.spawnAmbientWorld();
    this.spawnTraffic();

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
    const { x, y } = toScreen(17, 12);
    this.construction?.setActivity(activity, x, y, depthOf(17, 12) + 0.8);
  }

  private drawGround(): void {
    for (let gx = WORLD_MIN_X; gx <= WORLD_MAX_X; gx++) {
      for (let gy = WORLD_MIN_Y; gy <= WORLD_MAX_Y; gy++) {
        const inside = gx >= 0 && gy >= 0 && gx < CITY_GRID_SIZE && gy < CITY_GRID_SIZE;
        const reserve = isForestReserveCell(gx, gy);
        const bridge = isForestBridgeCell(gx, gy);
        const edge = inside ? Math.min(gx, gy, CITY_GRID_SIZE - 1 - gx, CITY_GRID_SIZE - 1 - gy) : reserve ? (isForestReserveEdge(gx, gy) ? 0 : 3) : -1;
        const seed = hashCell(gx, gy);
        const inlet = inside && edge === 0 && seed % 5 === 0;
        const runway = isAirportRunwayCell(gx, gy);
        const airportApron = isAirportApronCell(gx, gy);
        const quay = isPortApronCell(gx, gy);
        const isWater = ((!inside && !reserve && !bridge) || inlet) && !runway && !airportApron && !quay;
        const isSand = (inside || reserve) && !inlet && !bridge && !runway && !airportApron && !quay && (edge <= 1 || (edge === 2 && seed % 7 === 0));
        const isRoad = inside && edge > 1 && isRoadCell(gx, gy);
        const isPlaza = inside && isCivicPlazaCell(gx, gy);
        const isTrail = reserve && !isSand && isForestTrailCell(gx, gy);
        const key = runway
          ? WORLD_TEXTURES.runway
          : airportApron
            ? WORLD_TEXTURES.quay
          : quay
            ? WORLD_TEXTURES.quay
        : isWater
          ? WORLD_TEXTURES.water[seed % WORLD_TEXTURES.water.length]!
          : bridge
            ? WORLD_TEXTURES.bridge
          : isSand
            ? WORLD_TEXTURES.sand[seed % WORLD_TEXTURES.sand.length]!
            : isTrail
              ? trailTextureKey(forestTrailMaskAt(gx, gy))
            : isPlaza
              ? WORLD_TEXTURES.plaza
              : isRoad
                ? roadTextureKey(roadMaskAt(gx, gy), roadClassAt(gx, gy))
                : WORLD_TEXTURES.grass[seed % WORLD_TEXTURES.grass.length]!;
        const { x, y } = toScreen(gx, gy);
        const img = this.add.image(x, y, key).setOrigin(0.5, 0.5);
        img.setDepth(-2000 + (gx + gy) * 0.01);

        if (inside && !isWater && !isSand && !isRoad && !isPlaza && !runway && !airportApron && !quay && edge > 2 && seed % 7 === 0) {
          const propKeys = [WORLD_TEXTURES.pine, WORLD_TEXTURES.bush, WORLD_TEXTURES.rock] as const;
          this.add.image(x, y + HALF_H, propKeys[(seed >>> 5) % propKeys.length]!).setOrigin(0.5, 1).setDepth(depthOf(gx, gy) - 0.5).setScale(0.82);
        }
        if (isRoad && roadClassAt(gx, gy) === "boulevard" && roadMaskAt(gx, gy) === 15) {
          this.add.image(x, y + HALF_H, WORLD_TEXTURES.lamp).setOrigin(0.5, 1).setDepth(depthOf(gx, gy) + 0.2).setScale(0.72);
        }
      }
    }
    const centre = toScreen(17, 15);
    this.add.image(centre.x, centre.y + HALF_H, WORLD_TEXTURES.fountain).setOrigin(0.5, 1).setDepth(depthOf(17, 15) - 1).setScale(0.9);
  }

  private drawForestReserve(): void {
    const wetland = toScreen(-7, 12);
    this.add.image(wetland.x, wetland.y, WORLD_TEXTURES.wetland).setOrigin(0.5).setDepth(-2000 + (-7 + 12) * .01 + .01);

    const reserved = new Set(["-7:12", "-7:14", "-4:10"]);
    for (let gx = FOREST_RESERVE.minX; gx <= FOREST_RESERVE.maxX; gx++) {
      for (let gy = FOREST_RESERVE.minY; gy <= FOREST_RESERVE.maxY; gy++) {
        if (!isForestReserveCell(gx, gy) || isForestReserveEdge(gx, gy) || isForestTrailCell(gx, gy) || reserved.has(`${gx}:${gy}`)) continue;
        const seed = hashCell(gx, gy);
        /* Deliberate groves and clearings, not a tree on nearly every tile. */
        if (seed % 10 < 5) continue;
        const species = (["tree-oak", "tree-flowering", "tree-ancient", WORLD_TEXTURES.pine] as const)[(seed >>> 5) % 4]!;
        const point = toScreen(gx, gy);
        this.add.image(point.x, point.y + HALF_H, species).setOrigin(0.5, 1).setScale(.58 + ((seed >>> 9) % 22) / 100).setDepth(depthOf(gx, gy) + .35);
        if (seed % 13 === 0) {
          this.add.image(point.x + 18, point.y + HALF_H + 2, WORLD_TEXTURES.bush).setOrigin(0.5, 1).setScale(.62).setDepth(depthOf(gx, gy) + .4);
        }
      }
    }

    const cabin = toScreen(-7, 14);
    const cabinImage = this.add.image(cabin.x, cabin.y + HALF_H, WORLD_TEXTURES.forestCabin).setOrigin(0.5, 1).setScale(.92).setDepth(depthOf(-7, 14) + .7);
    this.addWorldLabel(cabinImage.x, cabinImage.getTopCenter().y - 5, "FOREST FIELD LAB", depthOf(-7, 14) + 3);

    const sensor = toScreen(-4, 10);
    const sensorImage = this.add.image(sensor.x, sensor.y + HALF_H, WORLD_TEXTURES.forestSensor).setOrigin(0.5, 1).setScale(.88).setDepth(depthOf(-4, 10) + .8);
    this.addWorldLabel(sensorImage.x, sensorImage.getTopCenter().y - 4, "CANOPY SENSOR", depthOf(-4, 10) + 3);

    const bridge = toScreen(-1, 10);
    const bridgeLabel = this.add.text(bridge.x, bridge.y - 9, "CANOPY LINK  ·  PEDESTRIAN + EV", {
      fontFamily: "IBM Plex Mono, monospace", fontSize: "7px", color: "#f3f7de", backgroundColor: "#153e2edb", padding: { x: 6, y: 3 },
    }).setOrigin(.5, 1).setDepth(depthOf(-1, 9) + 4);
    bridgeLabel.setShadow(0, 3, "#082b20", 6, true, true);

    for (const [gx, gy, delay] of [[-9, 7, 0], [-8, 13, 370], [-5, 16, 740], [-9, 18, 1110]] as const) {
      const point = toScreen(gx, gy);
      const light = this.add.image(point.x, point.y, WORLD_TEXTURES.energyPulse).setScale(.42).setAlpha(.25).setDepth(depthOf(gx, gy) + 3);
      this.tweens.add({ targets: light, y: light.y - 11, alpha: .94, duration: 1150, delay, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    }
  }

  private addWorldLabel(x: number, y: number, label: string, depth: number): void {
    const plate = this.add.text(x, y, label, {
      fontFamily: "IBM Plex Mono, monospace", fontSize: "7px", color: "#eaffc8", backgroundColor: "#153e2ee6", padding: { x: 6, y: 4 },
    }).setOrigin(.5, 1).setDepth(depth);
    plate.setShadow(0, 4, "#082b20", 8, true, true);
  }

  private drawInfrastructure(): void {
    const sites = [
      { cell: [7, 7] as const, key: WORLD_TEXTURES.hospital, scale: 0.94, label: "CRITICAL CARE" },
      { cell: [2, 17] as const, key: WORLD_TEXTURES.solarArray, scale: 0.98, label: "1.8 MW SOLAR" },
      { cell: [19, 25] as const, key: WORLD_TEXTURES.battery, scale: 1.02, label: "12 MWh STORAGE" },
      { cell: [26, 19] as const, key: WORLD_TEXTURES.substation, scale: 0.98, label: "GRID INTERTIE" },
    ];
    sites.forEach(({ cell: [gx, gy], key, scale, label }) => {
      const p = toScreen(gx, gy);
      const asset = this.add.image(p.x, p.y + HALF_H, key).setOrigin(0.5, 1).setScale(scale).setDepth(depthOf(gx, gy) + 0.4);
      const plate = this.add.text(p.x, asset.getTopCenter().y - 8, label, {
        fontFamily: "IBM Plex Mono, monospace", fontSize: "8px", color: "#eaffc8", backgroundColor: "#153e2ee6",
        padding: { x: 6, y: 4 },
      }).setOrigin(0.5, 1).setDepth(depthOf(gx, gy) + 3);
      plate.setShadow(0, 4, "#082b20", 8, true, true);
    });

    for (const [gx, gy, scale] of [[1, 16, 0.7], [3, 16, 0.7], [2, 18, 0.62]] as const) {
      const p = toScreen(gx, gy);
      this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.solarArray).setOrigin(0.5, 1).setScale(scale).setDepth(depthOf(gx, gy) + 0.25);
    }
    for (const [gx, gy] of [[18, 26], [20, 26]] as const) {
      const p = toScreen(gx, gy);
      this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.battery).setOrigin(0.5, 1).setScale(0.68).setDepth(depthOf(gx, gy) + 0.26);
    }

    for (const [gx, gy] of [[2, 3], [2, 27], [27, 4], [27, 26], [14, 3], [15, 27]] as const) {
      const p = toScreen(gx, gy);
      this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.palm).setOrigin(0.5, 1).setScale(1.05).setDepth(depthOf(gx, gy) + 0.25);
    }
    for (const [gx, gy] of [[12, 12], [17, 12], [12, 17], [17, 17]] as const) {
      const p = toScreen(gx, gy);
      this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.bench).setOrigin(0.5, 1).setScale(0.72).setDepth(depthOf(gx, gy) + 0.2);
    }

    const dock = toScreen(32, 12);
    this.add.image(dock.x + 22, dock.y + HALF_H + 5, WORLD_TEXTURES.dock).setOrigin(0.5, 0.5).setScale(0.82).setAngle(-27).setDepth(depthOf(32, 12) + 0.1);
    const lighthouse = toScreen(32, 9);
    this.add.image(lighthouse.x, lighthouse.y + HALF_H, WORLD_TEXTURES.lighthouse).setOrigin(0.5, 1).setScale(0.78).setDepth(depthOf(32, 9) + 0.35);
    for (const [gx, gy] of [[-2, 8], [-2, 20], [34, 8], [34, 24]] as const) {
      const p = toScreen(gx, gy);
      const buoy = this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.buoy).setOrigin(0.5, 1).setDepth(-700 + gy);
      this.tweens.add({ targets: buoy, y: buoy.y - 4, duration: 1100 + gy * 17, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    }
  }

  private drawCityContext(): void {
    for (let gx = 2; gx < CITY_GRID_SIZE - 2; gx++) {
      for (let gy = 2; gy < CITY_GRID_SIZE - 2; gy++) {
        if (isRoadCell(gx, gy) || !isContextPlotCell(gx, gy) || isCivicPlazaCell(gx, gy) || CITY_CONTEXT_RESERVED.has(`${gx}:${gy}`)) continue;
        const seed = hashCell(gx, gy);
        if (seed % 100 >= 78) continue;

        const coreDistance = Math.abs(gx - 15) + Math.abs(gy - 14);
        const central = gx >= 8 && gx <= 22 && gy >= 7 && gy <= 21;
        const industrial = gx >= 20 && gy >= 20;
        const key = industrial && seed % 3 === 0
          ? WORLD_TEXTURES.cityUtility
          : coreDistance < 6
            ? (seed % 3 === 0 ? WORLD_TEXTURES.cityTower : WORLD_TEXTURES.cityOffice)
            : central && coreDistance < 13
              ? (seed % 3 === 0 ? WORLD_TEXTURES.cityOffice : WORLD_TEXTURES.cityTownhouse)
              : seed % 4 === 0
                ? WORLD_TEXTURES.cityTownhouse
                : WORLD_TEXTURES.cityHouse;
        const scale = key === WORLD_TEXTURES.cityTower ? 0.72 : key === WORLD_TEXTURES.cityOffice ? 0.76 : 0.8;
        const p = toScreen(gx, gy);
        const image = this.add.image(p.x, p.y + HALF_H, key)
          .setOrigin(0.5, 1)
          .setScale(scale)
          .setFlipX(seed % 3 === 1)
          .setDepth(depthOf(gx, gy) + 0.35);
        this.contextStructures.set(`${gx}:${gy}`, image);
      }
    }
  }

  private drawStrategicFacilities(): void {
    const civic = toScreen(14, 14);
    const civicHall = this.add.image(civic.x, civic.y + HALF_H, WORLD_TEXTURES.civicHall)
      .setOrigin(0.5, 1).setScale(0.9).setDepth(depthOf(14, 14) + 0.7);
    this.addWorldLabel(civicHall.x, civicHall.getTopCenter().y - 5, "RESILIENCE OPERATIONS", depthOf(14, 14) + 4);

    const terminal = toScreen(-2, 29);
    const terminalImage = this.add.image(terminal.x, terminal.y + HALF_H, WORLD_TEXTURES.airportTerminal)
      .setOrigin(0.5, 1).setScale(1.72).setDepth(depthOf(-2, 29) + 0.55);
    const tower = toScreen(4, 30);
    this.add.image(tower.x, tower.y + HALF_H, WORLD_TEXTURES.airportTower)
      .setOrigin(0.5, 1).setScale(1.02).setDepth(depthOf(4, 30) + 0.65);
    for (const [gx, gy, scale, flip] of [[8, 31.4, .72, false], [1.5, 29.1, .62, true]] as const) {
      const plane = toScreen(gx, gy);
      this.add.image(plane.x, plane.y + HALF_H, WORLD_TEXTURES.aircraft)
        .setOrigin(.5, .5).setScale(scale).setFlipX(flip).setDepth(depthOf(gx, gy) + .8);
    }
    this.addWorldLabel(terminalImage.x - 12, terminalImage.getTopCenter().y - 2, "EMERGENCY AIRLINK", depthOf(-2, 29) + 4);

    const warehouse = toScreen(31, 14);
    const warehouseImage = this.add.image(warehouse.x, warehouse.y + HALF_H, WORLD_TEXTURES.portWarehouse)
      .setOrigin(0.5, 1).setScale(1).setDepth(depthOf(31, 14) + 0.55);
    for (const [gx, gy, flip] of [[33, 16, false], [33, 19, true], [33, 22, false]] as const) {
      const point = toScreen(gx, gy);
      this.add.image(point.x, point.y + HALF_H, WORLD_TEXTURES.cargoCrane)
        .setOrigin(0.5, 1).setScale(0.8).setFlipX(flip).setDepth(depthOf(gx, gy) + 0.7);
    }
    const ship = toScreen(36, 19);
    const cargo = this.add.image(ship.x, ship.y + HALF_H, WORLD_TEXTURES.cargoShip)
      .setOrigin(0.5, 1).setScale(1.24).setDepth(depthOf(36, 19) + 0.6);
    this.tweens.add({ targets: cargo, y: cargo.y - 3, duration: 1750, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    this.addWorldLabel(warehouseImage.x + 30, warehouseImage.getTopCenter().y - 4, "RESILIENCE LOGISTICS", depthOf(31, 14) + 4);
  }

  private spawnEnergyNetwork(): void {
    const routes: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
      [[2, 17], [3, 17], [3, 9], [7, 7]],
      [[19, 25], [21, 25], [21, 15], [3, 15], [3, 17]],
      [[26, 19], [27, 19], [27, 15], [21, 15]],
    ];
    const lines = this.add.graphics().setDepth(-250);
    routes.forEach((route, routeIndex) => {
      const points = route.map(([gx, gy]) => { const p = toScreen(gx, gy); return new Phaser.Math.Vector2(p.x, p.y + HALF_H); });
      lines.lineStyle(routeIndex === 0 ? 2 : 1, routeIndex === 0 ? 0xd8ff81 : 0xa7e7ff, 0.24);
      lines.strokePoints(points, false);
      const path = new Phaser.Curves.Path(points[0]!.x, points[0]!.y);
      points.slice(1).forEach((point) => path.lineTo(point.x, point.y));
      for (let pulseIndex = 0; pulseIndex < 3; pulseIndex++) {
        const pulse = this.add.image(points[0]!.x, points[0]!.y, WORLD_TEXTURES.energyPulse).setScale(routeIndex === 0 ? 0.48 : 0.38).setDepth(500);
        const tracker = { t: 0 };
        this.tweens.add({
          targets: tracker, t: 1, duration: 5200 + routeIndex * 900, delay: pulseIndex * 1600 + routeIndex * 500, repeat: -1, ease: "Linear",
          onUpdate: () => { const point = path.getPoint(tracker.t); pulse.setPosition(point.x, point.y - 2).setDepth(point.y * 0.42 + 1); },
        });
      }
    });
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    /* Frame the authored island rather than the entire generated ocean tile
       buffer.  The reference world feels substantial because the operating
       landmass—not empty water—owns the viewport. */
    const left = toScreen(-8, 34).x;
    const right = toScreen(32, -2).x;
    const top = toScreen(-6, -6).y - 180;
    const bottom = toScreen(36, 24).y + 80;
    const worldWidth = right - left;
    const worldHeight = bottom - top;
    const zoom = Math.min((cam.width * 0.96) / worldWidth, (cam.height * 0.94) / worldHeight);
    cam.setZoom(Phaser.Math.Clamp(zoom, 0.2, 0.72));
    cam.centerOn((left + right) / 2, (top + bottom) / 2);
  }

  private spawnAmbientWorld(): void {
    const sparkleCells: Array<[number, number]> = [
      [-7, 1], [-3, 8], [3, -3], [12, -4], [23, -2], [33, 4], [36, 11], [36, 25], [27, 34], [14, 35], [2, 33], [-8, 22],
    ];
    sparkleCells.forEach(([gx, gy], index) => {
      const p = toScreen(gx, gy);
      const sparkle = this.add.image(p.x, p.y + HALF_H, WORLD_TEXTURES.sparkle).setDepth(-1000).setAlpha(0.08);
      this.tweens.add({ targets: sparkle, alpha: 0.88, duration: 850 + index * 90, delay: index * 130, yoyo: true, repeat: -1, ease: "Sine.InOut" });
    });

    const boats: Array<{ from: [number, number]; to: [number, number]; duration: number; flip: boolean }> = [
      { from: [-8, 1], to: [-9, 25], duration: 30000, flip: false },
      { from: [2, -5], to: [25, -5], duration: 33000, flip: true },
      { from: [36, 4], to: [36, 27], duration: 36000, flip: false },
    ];
    boats.forEach(({ from, to, duration, flip }, index) => {
      const start = toScreen(...from); const end = toScreen(...to);
      const boat = this.add.image(start.x, start.y + HALF_H, WORLD_TEXTURES.boat).setOrigin(0.5, 1).setDepth(-850 + index).setScale(0.7).setFlipX(flip);
      const wake = this.add.image(start.x, start.y + HALF_H + 2, WORLD_TEXTURES.sparkle).setDepth(-851 + index).setScale(1.5, 0.7).setAlpha(0.52);
      this.tweens.add({ targets: [boat, wake], x: end.x, y: end.y + HALF_H, duration, yoyo: true, repeat: -1, delay: index * 1200, ease: "Sine.InOut", onYoyo: () => boat.setFlipX(!boat.flipX), onRepeat: () => boat.setFlipX(!boat.flipX) });
    });

    for (let index = 0; index < 3; index++) {
      const cloud = this.add.image(-1100 + index * 560, 250 + index * 170, WORLD_TEXTURES.cloud).setDepth(8000).setScale(1.5 + index * 0.18).setAlpha(0.13);
      this.tweens.add({ targets: cloud, x: 1200, duration: 62000 + index * 9000, repeat: -1, ease: "Linear" });
    }

    const crew = [
      { key: "crew-worker", from: [9, 5] as const, to: [9, 18] as const, duration: 8200 },
      { key: "crew-architect", from: [5, 14] as const, to: [18, 14] as const, duration: 9600 },
      { key: "crew-runner", from: [14, 5] as const, to: [14, 18] as const, duration: 6900 },
    ];
    crew.forEach(({ key, from, to, duration }, index) => {
      const a = toScreen(from[0], from[1]); const b = toScreen(to[0], to[1]);
      const person = this.add.image(a.x, a.y + HALF_H, key).setOrigin(0.5, 1).setScale(key === "crew-runner" ? 0.15 : 0.22).setDepth(depthOf(from[0], from[1]) + 2);
      this.tweens.add({
        targets: person, x: b.x, y: b.y + HALF_H, duration, yoyo: true, repeat: -1, delay: index * 700, ease: "Linear",
        onYoyo: () => person.setFlipX(!person.flipX), onRepeat: () => person.setFlipX(!person.flipX),
        onUpdate: () => person.setDepth(person.y * 0.42),
      });
    });

    const vanStart = toScreen(4, 3); const vanEnd = toScreen(4, 20);
    const van = this.add.image(vanStart.x, vanStart.y + HALF_H, WORLD_TEXTURES.serviceVan).setOrigin(0.5, 1).setScale(0.55).setDepth(depthOf(4, 3) + 2);
    this.tweens.add({
      targets: van, x: vanEnd.x, y: vanEnd.y + HALF_H, duration: 15000, yoyo: true, repeat: -1, ease: "Linear",
      onYoyo: () => van.setFlipX(true), onRepeat: () => van.setFlipX(false), onUpdate: () => van.setDepth(van.y * 0.42 + 2),
    });

    const rangerStart = toScreen(6, 9); const rangerEnd = toScreen(-6, 9);
    const ranger = this.add.image(rangerStart.x, rangerStart.y + HALF_H, WORLD_TEXTURES.serviceVan).setOrigin(.5, 1).setScale(.46).setTint(0xdff2b0).setDepth(depthOf(6, 9) + 2);
    this.tweens.add({
      targets: ranger, x: rangerEnd.x, y: rangerEnd.y + HALF_H, duration: 9200, yoyo: true, repeat: -1, delay: 1200, ease: "Sine.InOut",
      onYoyo: () => ranger.setFlipX(true), onRepeat: () => ranger.setFlipX(false), onUpdate: () => ranger.setDepth(ranger.y * .42 + 3),
    });
  }

  private spawnTraffic(): void {
    const routes: ReadonlyArray<ReadonlyArray<readonly [number, number]>> = [
      [[3, 3], [3, 27], [27, 27]],
      [[9, 27], [9, 3], [27, 3]],
      [[27, 9], [3, 9], [3, 27]],
      [[15, 3], [15, 27], [3, 27]],
      [[3, 3], [27, 3], [27, 15]],
      [[3, 21], [27, 21], [27, 3]],
      [[9, 3], [9, 27], [3, 27]],
      [[21, 3], [21, 27], [9, 27]],
      [[3, 15], [27, 15], [27, 3]],
      [[15, 3], [15, 27], [27, 27]],
    ];
    routes.forEach((route, index) => {
      const points = route.map(([gx, gy]) => { const p = toScreen(gx, gy); return new Phaser.Math.Vector2(p.x, p.y + HALF_H); });
      const path = new Phaser.Curves.Path(points[0]!.x, points[0]!.y);
      points.slice(1).forEach((point) => path.lineTo(point.x, point.y));
      const car = this.add.image(points[0]!.x, points[0]!.y, WORLD_TEXTURES.trafficCars[index % WORLD_TEXTURES.trafficCars.length]!).setOrigin(.5, 1).setScale(.56).setDepth(points[0]!.y * .42 + 1);
      const tracker = { t: index * .08 }; let previousX = car.x;
      this.tweens.add({
        targets: tracker, t: 1, duration: 15000 + index * 2100, delay: index * 850, yoyo: true, repeat: -1, ease: "Linear",
        onUpdate: () => {
          const point = path.getPoint(tracker.t); car.setPosition(point.x, point.y).setDepth(point.y * .42 + 1);
          if (Math.abs(point.x - previousX) > .5) car.setFlipX(point.x < previousX);
          previousX = point.x;
        },
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
    this.clearContextAt(tree.gx, tree.gy);
    const { x, y } = toScreen(tree.gx, tree.gy);
    const img = this.add.image(x, y, `tree-${tree.species}`).setOrigin(0.5, 1).setScale(.72);
    img.setDepth(depthOf(tree.gx, tree.gy));
    this.makeInspectable(img, {
      kind: "tree",
      title: `${titleCase(tree.species)} evidence tree`,
      status: "Verified simulation",
      evidence: "Planted only after a completed, reproducible resilience run.",
      runId: tree.runId,
      occurredAt: tree.plantedAt,
    }, .72);
    if (animate) {
      this.construction?.plantTree(x, y, depthOf(tree.gx, tree.gy), img);
    }
  }

  private placeBuilding(building: Building, animate: boolean): void {
    if (this.placed.has(building.id)) return;
    this.placed.add(building.id);
    this.clearContextAt(building.gx, building.gy);
    const { x, y } = toScreen(building.gx, building.gy);
    const img = this.add.image(x, y, `bld-${building.kind}`).setOrigin(0.5, 1).setScale(.82);
    img.setDepth(depthOf(building.gx, building.gy) + 0.5);
    this.makeInspectable(img, {
      kind: "building",
      title: buildingName(building.kind),
      status: "Verified resilience milestone",
      evidence: building.milestone,
      runId: building.runId,
      occurredAt: building.grownAt,
    }, .82);
    if (animate) {
      this.construction?.completeBuilding(x, y, depthOf(building.gx, building.gy), img, building.milestone);
    }
  }

  private makeInspectable(image: Phaser.GameObjects.Image, inspection: ForestInspection, baseScale = 1): void {
    image.setInteractive({ cursor: "pointer" });
    image.on("pointerover", () => {
      image.setTint(0xf1ffd2);
      this.tweens.add({ targets: image, scaleX: baseScale * 1.06, scaleY: baseScale * 1.06, duration: 130, ease: "Sine.Out" });
    });
    image.on("pointerout", () => {
      image.clearTint();
      this.tweens.add({ targets: image, scaleX: baseScale, scaleY: baseScale, duration: 150, ease: "Sine.Out" });
    });
    image.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      const moved = Phaser.Math.Distance.Between(pointer.downX, pointer.downY, pointer.x, pointer.y);
      if (moved < 8) this.inspectHandler?.(inspection);
    });
  }

  private clearContextAt(gx: number, gy: number): void {
    const key = `${gx}:${gy}`;
    this.contextStructures.get(key)?.destroy();
    this.contextStructures.delete(key);
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

const ROAD_LINES = new Set([3, 9, 15, 21, 27]);

const CITY_CONTEXT_RESERVED = new Set([
  "7:7", "2:17", "19:25", "26:19", "1:16", "3:16", "2:18",
  "18:26", "20:26", "14:14", "17:15",
]);

const FOREST_RESERVE = { minX: -11, maxX: -3, minY: 4, maxY: 20 } as const;

function isForestReserveCell(gx: number, gy: number): boolean {
  /* A stepped, designed island outline like the reference countryside ring.
     The broad centre and clipped ends create a readable reserve rather than
     an amorphous oval of overlapping sprites. */
  if (gx < FOREST_RESERVE.minX || gx > FOREST_RESERVE.maxX || gy < FOREST_RESERVE.minY || gy > FOREST_RESERVE.maxY) return false;
  const rowInset = gy <= 5 || gy >= 19 ? 2 : gy <= 7 || gy >= 17 ? 1 : 0;
  return gx >= FOREST_RESERVE.minX + rowInset && gx <= FOREST_RESERVE.maxX - (rowInset > 1 ? 1 : 0);
}

function isForestReserveEdge(gx: number, gy: number): boolean {
  if (!isForestReserveCell(gx, gy)) return false;
  return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => !isForestReserveCell(gx + dx!, gy + dy!));
}

function isForestBridgeCell(gx: number, gy: number): boolean {
  return gy === 10 && gx >= -3 && gx <= 3;
}

function isForestTrailCell(gx: number, gy: number): boolean {
  if (!isForestReserveCell(gx, gy)) return false;
  return (gx === -7 && gy >= 6 && gy <= 18) || (gy === 10 && gx >= -10 && gx <= -3) || (gy === 15 && gx >= -9 && gx <= -5);
}

function forestTrailMaskAt(gx: number, gy: number): number {
  const trail = (x: number, y: number) => isForestTrailCell(x, y) || isForestBridgeCell(x, y);
  return (trail(gx, gy - 1) ? 1 : 0) | (trail(gx + 1, gy) ? 2 : 0) | (trail(gx, gy + 1) ? 4 : 0) | (trail(gx - 1, gy) ? 8 : 0);
}

function isRoadCell(gx: number, gy: number): boolean {
  return ROAD_LINES.has(gx) || ROAD_LINES.has(gy);
}

function isCivicPlazaCell(gx: number, gy: number): boolean {
  return gx >= 12 && gx <= 17 && gy >= 12 && gy <= 17;
}

function isAirportRunwayCell(gx: number, gy: number): boolean {
  return gy >= 31 && gy <= 32 && gx >= -7 && gx <= 15;
}

function isAirportApronCell(gx: number, gy: number): boolean {
  return gx >= -5 && gx <= 7 && gy >= 27 && gy <= 30;
}

function isPortApronCell(gx: number, gy: number): boolean {
  return gx >= 30 && gx <= 33 && gy >= 12 && gy <= 24;
}

function isContextPlotCell(gx: number, gy: number): boolean {
  const localX = ((gx - 3) % 6 + 6) % 6;
  const localY = ((gy - 3) % 6 + 6) % 6;
  return (localX === 1 || localX === 3 || localX === 5) && (localY === 1 || localY === 3 || localY === 5);
}

function roadClassAt(gx: number, gy: number): WorldRoadClass {
  if (gx === 15 || gy === 15) return "boulevard";
  if (gx === 3 || gy === 3 || gx === 27 || gy === 27) return "street";
  return "lane";
}

function roadMaskAt(gx: number, gy: number): number {
  const road = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= CITY_GRID_SIZE || y >= CITY_GRID_SIZE) return false;
    const edge = Math.min(x, y, CITY_GRID_SIZE - 1 - x, CITY_GRID_SIZE - 1 - y);
    return edge > 1 && isRoadCell(x, y);
  };
  return (road(gx, gy - 1) ? 1 : 0) | (road(gx + 1, gy) ? 2 : 0) | (road(gx, gy + 1) ? 4 : 0) | (road(gx - 1, gy) ? 8 : 0);
}
