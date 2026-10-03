import { describe, expect, it } from "vitest";
import { capitolDistrict, inCapitolDistrict, isRoadLane, type WorldSnapshot } from "@sudo-city/protocol";
import { buildTerrain } from "../src/reference-city/layouts/terrain";
import { CITY_SIZE, FOREST_PLOTS, LANDMARK_SITES, RESERVE, RESERVE_STRUCTURES, insideLandmark, insideReserveStructure, reserveDistance, reserveTrail } from "../src/game/landmarks/worldLayout";
import { CITY_PLOTS, CITY_VARIANTS, LEGACY_EVIDENCE_PLOTS, type CityProofSummary } from "@verdant/protocol/city";
import type { Building, WorldState } from "@verdant/protocol";
import { constructionReceipt, evidencePlotPresentation, inspectionClickIsValid, nextEvidenceOrientation, placementClickIsValid, placementVerdict, plotAtGrid, renderedBuildingPlot } from "../src/game/evidenceCity/placementModel";
import { evidenceVisualStyle, orientationFront } from "../src/game/evidenceCity/visualVariants";
import { createIsoProjection, TILE_WIDTH, TILE_HEIGHT } from "../src/reference-city/math/iso";

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

describe("Evidence city placement renderer contract", () => {
  const proof: CityProofSummary = { proofIdentity: "model-proof", sourceContextKey: "reference/context", baselineRunId: "before", resultRunId: "after",
    modelVersion: "2.7.0", calibrationFingerprint: "CLIMATE", siteDataFingerprint: "SITE", targetPct: 5,
    baselineSampleSize: 500, resultSampleSize: 500, beforeCritical: 20, afterCritical: 0,
    holdouts: [0, 1, 2].map((index) => ({ label: `Holdout ${index + 1}`, seedOffset: 10_000 + index * 1000, clusterCount: 60,
      upperCriticalRiskPct: 4.9, pairedPValue: .03125, preventedFailureClusters: 6, introducedFailureClusters: 0 })),
    compoundStressCells: 81, compoundPassingCells: 81 };
  const world = (): WorldState => ({ trees: [], buildings: [], totalRuns: 1, totalFuturesSimulated: 500, bestImprovementPct: 0,
    pendingMilestones: [{ id: "storage-milestone", family: "storage", level: 1, earnedAt: 1, proof }] });
  const plan = { milestoneId: "storage-milestone", variantId: "storage-battery-pavilion", rotation: 0 as const };
  const legacyBuilding: Building = { id: "legacy", gx: 12, gy: 12, kind: "resilienceHall", runId: "old-run", grownAt: 0, milestone: "Old record" };

  it("freezes the nine authored seats on dry ground off roads and landmarks", () => {
    expect(CITY_PLOTS).toHaveLength(9);
    const mall = capitolDistrict(CITY_SIZE);
    for (const plot of CITY_PLOTS) {
      expect(terrain.cellAt(plot.gx, plot.gy)?.kind, plot.id).not.toBe("water");
      expect(isRoadLane(plot.gx, plot.gy), plot.id).toBe(false);
      expect(inCapitolDistrict(mall, plot.gx, plot.gy), plot.id).toBe(false);
      expect(insideLandmark(plot.gx, plot.gy), plot.id).toBe(false);
      expect(plotAtGrid(plot.gx, plot.gy)?.id).toBe(plot.id);
    }
  });

  it("uses the exact original filtered legacy plot ordering", () => {
    const staticSites = [[9,15],[1,19],[31,19],[31,7],[7,7],[21,27],[1,13],[13,7],[15,9],[33,15],[33,21],[15,27],
      ...LANDMARK_SITES.filter((site) => site.kind !== "hospital").map((site) => [site.gx, site.gy])];
    const mall = capitolDistrict(CITY_SIZE);
    const candidates = [...[1,5,23,29].flatMap((y) => [1,5,7,11,13,17,19,23,25,29,31,35].map((x) => [x,y])),
      ...Array.from({ length: 16 }, (_, index) => [1 + Math.floor(index / 2) * 6, index % 2 ? 35 : 31])];
    const expected = candidates.filter(([x,y]) => !insideLandmark(x!,y!) && !inCapitolDistrict(mall,x!,y!)
      && !staticSites.some(([gx,gy]) => Math.abs(gx!-x!) < 1.3 && Math.abs(gy!-y!) < 1.3));
    expect(LEGACY_EVIDENCE_PLOTS).toEqual(expected);
    expect(renderedBuildingPlot(legacyBuilding, 0)).toEqual({ gx: 1, gy: 1 });
  });

  it("rejects water, gaps, bounding-box corners and a pan gesture", () => {
    expect(plotAtGrid(-12, 12)).toBeUndefined();
    expect(plotAtGrid(1.6, 1)).toBeUndefined();
    expect(plotAtGrid(Number.NaN, 1)).toBeUndefined();
    expect(placementClickIsValid({ x: 10, y: 10, plotId: "storage-1" }, { x: 10, y: 10, plotId: "storage-1" })).toBe(true);
    expect(placementClickIsValid({ x: 10, y: 10, plotId: "storage-1" }, { x: 16, y: 10, plotId: "storage-1" })).toBe(false);
    expect(placementClickIsValid({ x: 10, y: 10, plotId: "storage-1" }, { x: 10, y: 10, plotId: "storage-2" })).toBe(false);
    expect(placementClickIsValid(undefined, { x: 10, y: 10, plotId: "storage-1" })).toBe(false);
    expect(placementClickIsValid({ x: 10, y: 10, plotId: "storage-1", dragged: true }, { x: 10, y: 10, plotId: "storage-1" })).toBe(false);
    expect(inspectionClickIsValid({ x: 10, y: 10, dragged: true }, { x: 10, y: 10 })).toBe(false);
    expect(inspectionClickIsValid({ x: 10, y: 10 }, { x: 10, y: 10 })).toBe(true);
  });

  it("inverse-projects diamond boundaries precisely rather than accepting their screen bounding boxes", () => {
    const iso = createIsoProjection(TILE_WIDTH, TILE_HEIGHT);
    for (const plot of CITY_PLOTS) {
      const center = iso.project(plot.gx, plot.gy);
      const inside = iso.unproject(center.x + 20, center.y + 5);
      expect(plotAtGrid(inside.x, inside.y)?.id).toBe(plot.id);
      // Within the 92×46 rectangle but outside the isometric land diamond.
      const corner = iso.unproject(center.x + 44, center.y + 21);
      expect(plotAtGrid(corner.x, corner.y)).toBeUndefined();
    }
  });

  it("marks occupied legacy seats, wrong families and spent milestones unavailable", () => {
    expect(placementVerdict(world(), plan, CITY_PLOTS[0]).eligible).toBe(true);
    expect(placementVerdict({ ...world(), buildings: [legacyBuilding] }, plan, CITY_PLOTS[0]).eligible).toBe(false);
    expect(placementVerdict(world(), plan, CITY_PLOTS[3]).eligible).toBe(false);
    expect(placementVerdict({ ...world(), pendingMilestones: [] }, plan, CITY_PLOTS[0]).eligible).toBe(false);
    expect(placementVerdict(world(), { ...plan, variantId: "not-a-design" }, CITY_PLOTS[0]).eligible).toBe(false);
  });

  it("keeps unrelated plots landscaped and clears only the selected eligible plot", () => {
    const current = world();
    expect(evidencePlotPresentation(current, plan, CITY_PLOTS[0], CITY_PLOTS[0].id)).toBe("SELECTED");
    expect(evidencePlotPresentation(current, plan, CITY_PLOTS[1], CITY_PLOTS[0].id)).toBe("ELIGIBLE");
    expect(evidencePlotPresentation(current, plan, CITY_PLOTS[3], CITY_PLOTS[0].id)).toBe("UNRELATED");
    expect(evidencePlotPresentation(current, null, CITY_PLOTS[0])).toBe("UNRELATED");
    const occupied: Building = { ...legacyBuilding, kind: "reservoir", family: "storage", milestoneId: "old-milestone",
      variantId: plan.variantId, plotId: CITY_PLOTS[0].id, level: 1, rotation: 0, proof };
    expect(evidencePlotPresentation({ ...current, buildings: [occupied] }, plan, CITY_PLOTS[0], CITY_PLOTS[0].id)).toBe("OCCUPIED");
  });

  it("upgrades a registered family building only in its retained seat", () => {
    const placed: Building = { ...legacyBuilding, kind: "reservoir", family: "storage", milestoneId: "old-milestone",
      variantId: plan.variantId, plotId: "storage-2", level: 1, rotation: 0, proof };
    const current = { ...world(), buildings: [placed], pendingMilestones: world().pendingMilestones!.map((milestone) => ({ ...milestone, level: 2 })) };
    expect(placementVerdict(current, plan, CITY_PLOTS[1]).eligible).toBe(true);
    expect(placementVerdict(current, plan, CITY_PLOTS[0]).eligible).toBe(false);
    expect(renderedBuildingPlot(placed, 0)).toEqual({ gx: 5, gy: 1 });
    // The same-level record cannot be previewed as an eligible upgrade.
    expect(placementVerdict({ ...world(), buildings: [placed] }, plan, CITY_PLOTS[1]).eligible).toBe(false);
  });

  it("has nine archive-backed designs and four front orientations without tipping a bitmap", () => {
    for (const variant of CITY_VARIANTS) {
      expect(evidenceVisualStyle(variant.id, 1)?.tier).toBe(1);
      expect(evidenceVisualStyle(variant.id, 3)?.tier).toBe(3);
    }
    expect(evidenceVisualStyle("unregistered")).toBeUndefined();
    expect([0,90,180,270].map((rotation) => orientationFront(rotation as 0|90|180|270))).toHaveLength(4);
    expect(nextEvidenceOrientation(270)).toBe(0);
    expect(evidenceVisualStyle(plan.variantId, 1, 90)?.facing).toBe("u");
    expect(evidenceVisualStyle(plan.variantId, 1, 180)?.flipX).toBe(true);
  });

  it("does not create construction receipts for legacy history and versions each upgrade", () => {
    expect(constructionReceipt(legacyBuilding)).toBeUndefined();
    const building = { ...legacyBuilding, milestoneId: plan.milestoneId, variantId: plan.variantId, plotId: "storage-2", level: 1 };
    expect(constructionReceipt(building)).not.toBe(constructionReceipt({ ...building, milestoneId: "next-milestone", level: 2 }));
  });
});
