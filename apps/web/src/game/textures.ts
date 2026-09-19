import Phaser from "phaser";
import { HALF_W, HALF_H } from "./iso";
import type { BuildingKind, TreeSpecies } from "@verdant/protocol";

const TREE_COLORS: Record<TreeSpecies, { canopy: number; trunk: number; scale: number; accent?: number }> = {
  sapling: { canopy: 0x6ba86b, trunk: 0x6b4a34, scale: 0.55 },
  oak: { canopy: 0x3f8f57, trunk: 0x5a3d28, scale: 0.85 },
  flowering: { canopy: 0x4a9d63, trunk: 0x5a3d28, scale: 0.85, accent: 0xf6a6c1 },
  ancient: { canopy: 0x2c6b45, trunk: 0x4a3320, scale: 1.15, accent: 0xd8c27a },
};

const BUILDING_COLORS: Record<BuildingKind, { roof: number; wallA: number; wallB: number; height: number }> = {
  watchtower: { roof: 0x9aa5ad, wallA: 0x6f7a82, wallB: 0x545e64, height: 70 },
  reservoir: { roof: 0x5fb3d9, wallA: 0x3d84a3, wallB: 0x2c6178, height: 40 },
  solarHall: { roof: 0xf6c453, wallA: 0xc99a2e, wallB: 0x9c771f, height: 44 },
  resilienceHall: { roof: 0xb28cf0, wallA: 0x8560c4, wallB: 0x63469a, height: 56 },
};

function diamondPoints(w: number, h: number) {
  return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2];
}

export function bakeTextures(scene: Phaser.Scene): void {
  if (!scene.textures.exists("tile-a")) {
    for (const [key, shade] of [["tile-a", 0xdfe8d7], ["tile-b", 0xd6e2cf]] as const) {
      const g = scene.make.graphics({ x: 0, y: 0 }, false);
      g.fillStyle(shade, 1);
      g.fillPoints(toPointArray(diamondPoints(HALF_W * 2, HALF_H * 2)), true);
      g.lineStyle(1, 0xb8c8ae, 0.72);
      g.strokePoints(toPointArray(diamondPoints(HALF_W * 2, HALF_H * 2)), true);
      g.generateTexture(key, HALF_W * 2, HALF_H * 2);
      g.destroy();
    }
  }

  for (const species of Object.keys(TREE_COLORS) as TreeSpecies[]) {
    const key = `tree-${species}`;
    if (scene.textures.exists(key)) continue;
    const c = TREE_COLORS[species];
    const w = 64, h = 96;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x000000, 0.25);
    g.fillEllipse(w / 2, h - 6, 26 * c.scale, 10 * c.scale);
    g.fillStyle(c.trunk, 1);
    g.fillRect(w / 2 - 4 * c.scale, h - 34 * c.scale, 8 * c.scale, 30 * c.scale);
    g.fillStyle(c.canopy, 1);
    g.fillCircle(w / 2, h - 46 * c.scale, 20 * c.scale);
    g.fillCircle(w / 2 - 14 * c.scale, h - 36 * c.scale, 14 * c.scale);
    g.fillCircle(w / 2 + 14 * c.scale, h - 36 * c.scale, 14 * c.scale);
    if (c.accent) {
      g.fillStyle(c.accent, 1);
      for (let i = 0; i < 6; i++) {
        const ang = (i / 6) * Math.PI * 2;
        g.fillCircle(w / 2 + Math.cos(ang) * 16 * c.scale, h - 46 * c.scale + Math.sin(ang) * 12 * c.scale, 2.5);
      }
    }
    g.generateTexture(key, w, h);
    g.destroy();
  }

  for (const kind of Object.keys(BUILDING_COLORS) as BuildingKind[]) {
    const key = `bld-${kind}`;
    if (scene.textures.exists(key)) continue;
    const c = BUILDING_COLORS[kind];
    const w = HALF_W * 2, roofH = HALF_H * 2, bodyH = c.height;
    const totalH = roofH + bodyH;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    g.fillStyle(0x000000, 0.28);
    g.fillEllipse(w / 2, totalH - 4, w * 0.4, 12);
    // left wall
    g.fillStyle(c.wallB, 1);
    g.fillPoints(toPointArray([0, roofH / 2, w / 2, roofH, w / 2, roofH + bodyH, 0, roofH / 2 + bodyH]), true);
    // right wall
    g.fillStyle(c.wallA, 1);
    g.fillPoints(toPointArray([w, roofH / 2, w / 2, roofH, w / 2, roofH + bodyH, w, roofH / 2 + bodyH]), true);
    // roof
    g.fillStyle(c.roof, 1);
    g.fillPoints(toPointArray(diamondPoints(w, roofH)), true);
    g.lineStyle(1, 0x0d1a14, 0.5);
    g.strokePoints(toPointArray(diamondPoints(w, roofH)), true);
    g.generateTexture(key, w, totalH);
    g.destroy();
  }
}

function toPointArray(flat: number[]): Phaser.Geom.Point[] {
  const pts: Phaser.Geom.Point[] = [];
  for (let i = 0; i < flat.length; i += 2) pts.push(new Phaser.Geom.Point(flat[i], flat[i + 1]));
  return pts;
}
