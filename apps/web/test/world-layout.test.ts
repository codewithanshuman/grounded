import { describe, expect, it } from "vitest";
import { capitolDistrict, inCapitolDistrict, isRoadLane, type WorldSnapshot } from "@sudo-city/protocol";
import { buildTerrain } from "../src/reference-city/layouts/terrain";
import { CITY_SIZE, FOREST_PLOTS, LANDMARK_SITES, RESERVE, RESERVE_STRUCTURES, insideLandmark, insideReserveStructure, reserveDistance, reserveTrail } from "../src/game/landmarks/worldLayout";

// These tests exercise the same pure terrain classifier as the reference city.
// No renderer, DOM, canvas, or Phaser mock is required.
const snapshot: WorldSnapshot = {
  id: "grounded-layout-test",
  repoPath: "grounded/jaipur-resilience",
  revision: "layout-test",
  generatedAt: "2026-01-01T00:00:00.000Z",
  size: CITY_SIZE,
  layoutVersion: 2,
  districts: [
    { path: "critical-care", x: 0, y: 0, width: 12, height: 18, weight: 28 },
    { path: "operations", x: 12, y: 0, width: 36, height: 18, weight: 35 },
    { path: "generation", x: 0, y: 18, width: 18, height: 18, weight: 18 },
    { path: "storage", x: 18, y: 18, width: 30, height: 18, weight: 19 },
  ],
  buildings: LANDMARK_SITES.map(site => ({
    path: site.path, district: "community", language: "HTML", loc: 2000,
    plot: { x: site.gx, y: site.gy },
  })),
};

const terrain = buildTerrain(snapshot);

describe("Grounded authored city layout", () => {
  it("keeps each five-tile landmark campus inside a single road block", () => {
    const mall = capitolDistrict(CITY_SIZE);
    for (const site of LANDMARK_SITES) {
      expect(site.gx % 6, site.path).toBe(3);
      expect(site.gy % 6, site.path).toBe(3);
      for (let x = site.gx - 2; x <= site.gx + 2; x++) {
        for (let y = site.gy - 2; y <= site.gy + 2; y++) {
          expect(x >= 0 && x < CITY_SIZE.width && y >= 0 && y < CITY_SIZE.height, site.path).toBe(true);
          expect(isRoadLane(x, y), `${site.path}: road at ${x},${y}`).toBe(false);
          expect(inCapitolDistrict(mall, x, y), `${site.path}: court at ${x},${y}`).toBe(false);
          expect(insideLandmark(x, y), `${site.path}: uncleared prop at ${x},${y}`).toBe(true);
          expect(terrain.cellAt(x, y)?.kind, `${site.path}: water at ${x},${y}`).not.toBe("water");
        }
      }
    }
  });

  it("leaves a full street between the landmark campuses", () => {
    for (let i = 0; i < LANDMARK_SITES.length; i++) {
      for (let j = i + 1; j < LANDMARK_SITES.length; j++) {
        const a = LANDMARK_SITES[i], b = LANDMARK_SITES[j];
        expect(Math.max(Math.abs(a.gx - b.gx), Math.abs(a.gy - b.gy))).toBeGreaterThanOrEqual(6);
      }
    }
  });

  it("preserves the existing mainland while extending the visual world offshore", () => {
    // Adding the five landmark plots must not change any countryside/coast cell.
    const before = buildTerrain({ ...snapshot, buildings: [] });
    for (let x = terrain.bounds.minX; x < 0; x++) {
      for (let y = 0; y < CITY_SIZE.height; y++) {
        expect(terrain.cellAt(x, y)).toEqual(before.cellAt(x, y));
      }
    }
    expect(RESERVE.cx + RESERVE.rx).toBeLessThan(-20);
  });
});

describe("Offshore forest and bridge", () => {
  it("anchors the bridge on the forest shore and intact dry mainland", () => {
    expect(reserveDistance(RESERVE.bridgeStart, RESERVE.bridgeY)).toBeLessThanOrEqual(1);
    expect(reserveTrail(RESERVE.bridgeStart, RESERVE.bridgeY)).toBe(true);
    expect(terrain.cellAt(RESERVE.bridgeEnd, RESERVE.bridgeY)?.kind).not.toBe("water");
    expect(terrain.cellAt(RESERVE.bridgeEnd, RESERVE.bridgeY)).toBeDefined();
    for (let x = RESERVE.bridgeEnd; x <= 0; x++) {
      expect(terrain.cellAt(x, RESERVE.bridgeY)?.kind, `dry approach at ${x}`).not.toBe("water");
    }
    expect(terrain.cellAt(0, RESERVE.bridgeY)?.kind).toBe("road");
  });

  it("crosses a genuine open-water channel rather than a cut into city land", () => {
    const waterCells: number[] = [];
    for (let x = terrain.bounds.minX; x < RESERVE.bridgeEnd; x++) {
      if (terrain.cellAt(x, RESERVE.bridgeY)?.kind === "water" && reserveDistance(x, RESERVE.bridgeY) > 1) waterCells.push(x);
    }
    expect(waterCells.length).toBeGreaterThanOrEqual(10);
    expect(RESERVE.bridgeEnd - RESERVE.bridgeStart).toBeGreaterThanOrEqual(16);
    expect(waterCells.every((x, index) => index === 0 || x === waterCells[index - 1] + 1)).toBe(true);
  });

  it("keeps every evidence-tree plot on forest ground and off its walking trails", () => {
    expect(FOREST_PLOTS.length).toBeGreaterThan(40);
    expect(new Set(FOREST_PLOTS.map(([x, y]) => `${x},${y}`)).size).toBe(FOREST_PLOTS.length);
    for (const [x, y] of FOREST_PLOTS) {
      expect(reserveDistance(x, y)).toBeLessThan(.72);
      expect(reserveTrail(x, y)).toBe(false);
      // Scene's bounded nine-slot jitter must not put later evidence in water.
      for (const offsetX of [0, .18, .36]) for (const offsetY of [0, .18, .36]) {
        expect(reserveDistance(x + offsetX, y + offsetY)).toBeLessThan(1);
        expect(reserveTrail(x + offsetX, y + offsetY)).toBe(false);
      }
    }
  });

  it("leaves building footprints and entrances clear through every tree-growth cycle", () => {
    for (const site of Object.values(RESERVE_STRUCTURES)) {
      expect(insideReserveStructure(site.gx, site.gy)).toBe(true);
      expect(reserveDistance(site.gx, site.gy)).toBeLessThan(1);
    }
    for (const [x, y] of FOREST_PLOTS) {
      for (const dx of [0, .18, .36]) for (const dy of [0, .18, .36]) {
        expect(insideReserveStructure(x + dx, y + dy), `tree at ${x + dx},${y + dy}`).toBe(false);
      }
    }
    // These were real collisions found beside the station and watchtower.
    expect(FOREST_PLOTS).not.toContainEqual([-34, 3]);
    expect(FOREST_PLOTS).not.toContainEqual([-28, 11]);
  });
});
