import Phaser from "phaser";
import { HALF_W, HALF_H } from "./iso";
import type { BuildingKind, TreeSpecies } from "@verdant/protocol";

export const WORLD_TEXTURES = {
  water: ["world-water-0", "world-water-1", "world-water-2"],
  sand: ["world-sand-0", "world-sand-1"],
  grass: ["world-grass-0", "world-grass-1", "world-grass-2"],
  road: "world-road",
  plaza: "world-plaza",
  bush: "world-bush",
  rock: "world-rock",
  pine: "world-pine",
  palm: "world-palm",
  lamp: "world-lamp",
  bench: "world-bench",
  fountain: "world-fountain",
  sparkle: "world-sparkle",
  energyPulse: "world-energy-pulse",
  cloud: "world-cloud",
  boat: "world-boat",
  buoy: "world-buoy",
  dock: "world-dock",
  hospital: "world-hospital",
  solarArray: "world-solar-array",
  battery: "world-battery",
  substation: "world-substation",
  home: "world-home",
  serviceVan: "world-service-van",
  crane: "world-crane",
  scaffold: "world-scaffold",
} as const;

const TERRAIN = {
  grass: [0x5bbf3e, 0x54b638, 0x63c748],
  sand: [0xe8d9a8, 0xd3c08a],
  water: [0x2e9fe0, 0x2995d5, 0x248bc9],
  waterDeep: 0x1f7fbd,
  waterFoam: 0x9fd8f5,
  road: 0x9aa3ab,
  roadShade: 0x7f8992,
  roadLine: 0xf4f1e4,
  plaza: 0xd8d3c4,
  shadow: 0x1f4d16,
};

const TREE_STYLE: Record<TreeSpecies, { leaf: number; light: number; trunk: number; scale: number; accent?: number }> = {
  sapling: { leaf: 0x46ad4e, light: 0x6dcb55, trunk: 0x7a5230, scale: 0.62 },
  oak: { leaf: 0x2f8f3c, light: 0x4ab74f, trunk: 0x704828, scale: 0.88 },
  flowering: { leaf: 0x38a345, light: 0x62c553, trunk: 0x704828, scale: 0.9, accent: 0xffb5d0 },
  ancient: { leaf: 0x1f7438, light: 0x45a545, trunk: 0x654024, scale: 1.16, accent: 0xffd166 },
};

const BUILDING_STYLE: Record<BuildingKind, { roof: number; roofLight: number; wall: number; shadow: number; accent: number; height: number; floors: number }> = {
  watchtower: { roof: 0x2465a8, roofLight: 0x4c91d7, wall: 0xe8f1f3, shadow: 0xb8ccd2, accent: 0xf2b134, height: 92, floors: 5 },
  reservoir: { roof: 0x2e9fe0, roofLight: 0x78c6ed, wall: 0xdce9e8, shadow: 0x9ab9bc, accent: 0x226b8e, height: 56, floors: 2 },
  solarHall: { roof: 0x17518c, roofLight: 0x3b7fbd, wall: 0xf0ead8, shadow: 0xc8bda2, accent: 0xf2b134, height: 48, floors: 2 },
  resilienceHall: { roof: 0xe7e0c8, roofLight: 0xfff9e8, wall: 0xf4efe0, shadow: 0xcfc7b4, accent: 0x4c91d7, height: 66, floors: 3 },
};

function diamondPoints(w = HALF_W * 2, h = HALF_H * 2): Phaser.Geom.Point[] {
  return [new Phaser.Geom.Point(w / 2, 0), new Phaser.Geom.Point(w, h / 2), new Phaser.Geom.Point(w / 2, h), new Phaser.Geom.Point(0, h / 2)];
}

function shade(color: number, amount: number): number {
  const value = Phaser.Display.Color.IntegerToColor(color);
  return amount >= 0 ? value.lighten(amount).color : value.darken(-amount).color;
}

function graphics(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  return scene.make.graphics({ x: 0, y: 0 }, false);
}

function finish(g: Phaser.GameObjects.Graphics, key: string, width: number, height: number): void {
  g.generateTexture(key, width, height);
  g.destroy();
}

export function bakeTextures(scene: Phaser.Scene): void {
  if (scene.textures.exists(WORLD_TEXTURES.water[0])) return;
  bakeTerrain(scene);
  bakeProps(scene);
  bakeInfrastructure(scene);
  bakeTrees(scene);
  bakeBuildings(scene);
  bakeEffects(scene);
  bakeConstruction(scene);
}

function bakeTerrain(scene: Phaser.Scene): void {
  WORLD_TEXTURES.water.forEach((key, variant) => {
    const g = graphics(scene);
    g.fillStyle(TERRAIN.water[variant]!, 1); g.fillPoints(diamondPoints(), true);
    g.lineStyle(1, TERRAIN.waterDeep, 0.48); g.strokePoints(diamondPoints(), true);
    g.lineStyle(2, TERRAIN.waterFoam, 0.42);
    for (let i = 0; i < 3; i++) {
      const x = 22 + ((variant * 19 + i * 23) % 48); const y = 14 + ((variant * 7 + i * 9) % 20);
      g.lineBetween(x, y, x + 10 + ((variant + i) % 6), y);
    }
    finish(g, key, HALF_W * 2, HALF_H * 2);
  });

  WORLD_TEXTURES.sand.forEach((key, variant) => {
    const g = graphics(scene); const color = TERRAIN.sand[variant]!;
    g.fillStyle(color, 1); g.fillPoints(diamondPoints(), true); g.lineStyle(1, shade(color, -9), 0.55); g.strokePoints(diamondPoints(), true);
    g.fillStyle(0xf4e8be, 0.7);
    for (let i = 0; i < 5; i++) g.fillRect(22 + ((i * 17 + variant * 9) % 52), 12 + ((i * 7) % 24), 3, 2);
    finish(g, key, HALF_W * 2, HALF_H * 2);
  });

  WORLD_TEXTURES.grass.forEach((key, variant) => {
    const g = graphics(scene); const color = TERRAIN.grass[variant]!;
    g.fillStyle(color, 1); g.fillPoints(diamondPoints(), true); g.lineStyle(1, shade(color, -8), 0.48); g.strokePoints(diamondPoints(), true);
    g.fillStyle(shade(color, 12), 0.72);
    for (let i = 0; i < 6; i++) g.fillRect(19 + ((variant * 13 + i * 17) % 60), 11 + ((variant * 11 + i * 7) % 27), 3, 2);
    finish(g, key, HALF_W * 2, HALF_H * 2);
  });

  {
    const g = graphics(scene); g.fillStyle(TERRAIN.road, 1); g.fillPoints(diamondPoints(), true);
    g.lineStyle(3, 0xd8d3c4, 0.95); g.lineBetween(1, 23, 48, 47); g.lineBetween(48, 1, 95, 23);
    g.lineStyle(1, TERRAIN.roadShade, 0.8); g.strokePoints(diamondPoints(), true); g.fillStyle(TERRAIN.roadLine, 0.9);
    for (let x = 28; x < 76; x += 18) g.fillRect(x, 22, 9, 2);
    finish(g, WORLD_TEXTURES.road, HALF_W * 2, HALF_H * 2);
  }
  {
    const g = graphics(scene); g.fillStyle(TERRAIN.plaza, 1); g.fillPoints(diamondPoints(), true);
    g.lineStyle(1, shade(TERRAIN.plaza, -10), 0.65); g.strokePoints(diamondPoints(), true); g.lineStyle(1, 0xbab5a7, 0.42);
    g.lineBetween(24, 12, 72, 36); g.lineBetween(72, 12, 24, 36);
    finish(g, WORLD_TEXTURES.plaza, HALF_W * 2, HALF_H * 2);
  }
}

function bakeProps(scene: Phaser.Scene): void {
  const propCanvas = (key: string, draw: (g: Phaser.GameObjects.Graphics, bx: number, by: number) => void) => {
    const g = graphics(scene); const bx = 48, by = 57;
    g.fillStyle(TERRAIN.shadow, 0.2); g.fillEllipse(bx, by - 2, 28, 9); draw(g, bx, by); finish(g, key, 96, 64);
  };
  propCanvas(WORLD_TEXTURES.bush, (g, x, y) => {
    g.fillStyle(0x3d9b45, 1); g.fillCircle(x - 7, y - 10, 8); g.fillCircle(x + 7, y - 9, 7); g.fillStyle(0x54b958, 1); g.fillCircle(x, y - 15, 9);
  });
  propCanvas(WORLD_TEXTURES.rock, (g, x, y) => {
    g.fillStyle(0x92978d, 1); g.fillTriangle(x - 12, y, x + 12, y, x - 1, y - 15); g.fillStyle(0xb4b8af, 1); g.fillTriangle(x - 1, y - 15, x + 12, y, x + 5, y - 8);
  });
  propCanvas(WORLD_TEXTURES.pine, (g, x, y) => {
    g.fillStyle(0x704828, 1); g.fillRect(x - 2, y - 18, 5, 18); g.fillStyle(0x1f6f3a, 1);
    ([[12, 18], [25, 14], [37, 9]] as const).forEach(([offset, width]) => g.fillTriangle(x - width, y - offset, x + width, y - offset, x, y - offset - 20));
  });
  propCanvas(WORLD_TEXTURES.palm, (g, x, y) => {
    g.lineStyle(5, 0x875a2e, 1); g.lineBetween(x - 2, y, x + 5, y - 36);
    g.lineStyle(3, 0x2e873d, 1);
    for (const [dx, dy] of [[-25, -4], [-20, -16], [-8, -24], [12, -23], [24, -12], [25, 0]] as const) g.lineBetween(x + 5, y - 36, x + 5 + dx, y - 36 + dy);
    g.fillStyle(0x53ad43, 1); g.fillCircle(x + 4, y - 37, 6); g.fillStyle(0x2f7936, 1); g.fillCircle(x + 9, y - 34, 4);
  });
  propCanvas(WORLD_TEXTURES.lamp, (g, x, y) => {
    g.fillStyle(0x2b3038, 1); g.fillRect(x - 1, y - 30, 3, 30); g.fillRect(x - 6, y - 31, 12, 2); g.fillStyle(0xffd166, 0.22); g.fillCircle(x, y - 35, 9); g.fillStyle(0xffd166, 1); g.fillCircle(x, y - 35, 4);
  });
  propCanvas(WORLD_TEXTURES.bench, (g, x, y) => {
    g.fillStyle(0x8a5b35, 1); g.fillRect(x - 16, y - 17, 32, 5); g.fillRect(x - 16, y - 9, 32, 5); g.fillStyle(0x3d4650, 1); g.fillRect(x - 12, y - 5, 3, 8); g.fillRect(x + 9, y - 5, 3, 8);
  });
  propCanvas(WORLD_TEXTURES.fountain, (g, x, y) => {
    g.fillStyle(0xc6c0b0, 1); g.fillEllipse(x, y - 3, 42, 16); g.fillStyle(0x54b7ea, 1); g.fillEllipse(x, y - 6, 32, 10); g.fillStyle(0xd9d5c8, 1); g.fillRect(x - 2, y - 27, 4, 21); g.fillStyle(0x9fd8f5, 0.85); g.fillCircle(x, y - 30, 6);
  });
}

function bakeInfrastructure(scene: Phaser.Scene): void {
  {
    const g = graphics(scene); const x = 100, ground = 166;
    g.fillStyle(0x163b2c, .22); g.fillEllipse(x, ground, 138, 25);
    g.fillStyle(0xb8c9ce, 1); g.fillPoints([new Phaser.Geom.Point(42, 98), new Phaser.Geom.Point(x, 127), new Phaser.Geom.Point(x, ground), new Phaser.Geom.Point(42, 137)], true);
    g.fillStyle(0xe9f1ef, 1); g.fillPoints([new Phaser.Geom.Point(158, 98), new Phaser.Geom.Point(x, 127), new Phaser.Geom.Point(x, ground), new Phaser.Geom.Point(158, 137)], true);
    g.fillStyle(0xf6fbf7, 1); g.fillPoints([new Phaser.Geom.Point(x, 68), new Phaser.Geom.Point(158, 98), new Phaser.Geom.Point(x, 127), new Phaser.Geom.Point(42, 98)], true);
    g.fillStyle(0x4f91b2, 1); for (const [wx, wy] of [[55,112],[70,120],[113,121],[130,112]] as const) g.fillRect(wx, wy, 10, 8);
    g.fillStyle(0xd94d49, 1); g.fillRect(94, 76, 12, 38); g.fillRect(81, 89, 38, 12);
    g.fillStyle(0x285c68, 1); g.fillRect(108, 142, 16, 24);
    g.fillStyle(0xffffff, .9); g.fillCircle(100, 91, 22); g.fillStyle(0xd94d49, 1); g.fillRect(96, 77, 8, 28); g.fillRect(86, 87, 28, 8);
    finish(g, WORLD_TEXTURES.hospital, 200, 180);
  }
  {
    const g = graphics(scene); const panels = [[24,34],[57,49],[90,64],[45,22],[78,37],[111,52]] as const;
    g.fillStyle(0x173b2d, .2); g.fillEllipse(78, 78, 118, 24);
    for (const [x,y] of panels) {
      g.fillStyle(0x164c79, 1); g.fillPoints([new Phaser.Geom.Point(x,y),new Phaser.Geom.Point(x+29,y+14),new Phaser.Geom.Point(x+17,y+28),new Phaser.Geom.Point(x-12,y+14)],true);
      g.lineStyle(1,0x67b9e8,.85); g.strokePoints([new Phaser.Geom.Point(x,y),new Phaser.Geom.Point(x+29,y+14),new Phaser.Geom.Point(x+17,y+28),new Phaser.Geom.Point(x-12,y+14)],true); g.lineBetween(x+8,y+4,x-3,y+18); g.lineBetween(x+19,y+9,x+8,y+23);
    }
    finish(g, WORLD_TEXTURES.solarArray, 160, 100);
  }
  {
    const g = graphics(scene); const x = 62, ground = 94;
    g.fillStyle(0x173b2d,.22); g.fillEllipse(x,ground,86,17);
    g.fillStyle(0xaebcc0,1); g.fillPoints([new Phaser.Geom.Point(25,48),new Phaser.Geom.Point(x,66),new Phaser.Geom.Point(x,ground),new Phaser.Geom.Point(25,76)],true);
    g.fillStyle(0xe8efeb,1); g.fillPoints([new Phaser.Geom.Point(99,48),new Phaser.Geom.Point(x,66),new Phaser.Geom.Point(x,ground),new Phaser.Geom.Point(99,76)],true);
    g.fillStyle(0xf8fbf5,1); g.fillPoints([new Phaser.Geom.Point(x,31),new Phaser.Geom.Point(99,48),new Phaser.Geom.Point(x,66),new Phaser.Geom.Point(25,48)],true);
    g.fillStyle(0x2f6c45,1); g.fillRect(72,68,18,15); g.fillStyle(0xb7df72,1); for(let i=0;i<4;i++) g.fillCircle(34+i*11,61+i*5,2);
    g.lineStyle(2,0x59686e,.8); for(let i=0;i<5;i++) g.lineBetween(35+i*11,43+i*5,35+i*11,73+i*5);
    finish(g, WORLD_TEXTURES.battery, 124, 106);
  }
  {
    const g = graphics(scene); g.fillStyle(0x173b2d,.18); g.fillEllipse(66,100,105,19);
    g.lineStyle(3,0x59666e,1); for(const x of [28,52,80,104]) { g.lineBetween(x,34,x,94); g.lineBetween(x-9,45,x+9,45); }
    g.lineStyle(2,0xadb9bc,1); g.lineBetween(17,44,115,44); g.lineBetween(18,58,112,58);
    g.fillStyle(0xd7a63d,1); for(const x of [27,52,80,104]) { g.fillCircle(x,45,4); g.fillCircle(x,58,4); }
    g.fillStyle(0x49606b,1); g.fillRect(43,67,47,27); g.fillStyle(0x9fd8f5,1); g.fillRect(51,73,12,8); g.fillStyle(0xb7df72,1); g.fillCircle(80,76,3);
    finish(g, WORLD_TEXTURES.substation, 132, 112);
  }
  {
    const g = graphics(scene); const x=55,ground=102;
    g.fillStyle(0x173b2d,.2); g.fillEllipse(x,ground,75,15); g.fillStyle(0xc5b997,1); g.fillPoints([new Phaser.Geom.Point(22,61),new Phaser.Geom.Point(x,77),new Phaser.Geom.Point(x,ground),new Phaser.Geom.Point(22,85)],true); g.fillStyle(0xf0ead7,1); g.fillPoints([new Phaser.Geom.Point(88,61),new Phaser.Geom.Point(x,77),new Phaser.Geom.Point(x,ground),new Phaser.Geom.Point(88,85)],true); g.fillStyle(0x2f6f52,1); g.fillPoints([new Phaser.Geom.Point(x,40),new Phaser.Geom.Point(91,58),new Phaser.Geom.Point(x,78),new Phaser.Geom.Point(19,58)],true); g.fillStyle(0x77bfe4,1); g.fillRect(65,79,9,9); g.fillStyle(0x835b37,1); g.fillRect(39,80,10,22);
    finish(g, WORLD_TEXTURES.home,110,112);
  }
  {
    const g = graphics(scene); g.fillStyle(0x754f31,1); for(let i=0;i<7;i++) g.fillRect(20+i*15,30+i*7,42,7); g.lineStyle(3,0x4b3728,1); g.lineBetween(23,35,23,84); g.lineBetween(129,84,129,42); finish(g,WORLD_TEXTURES.dock,160,94);
  }
  {
    const g = graphics(scene); g.fillStyle(0x173b2d,.2); g.fillEllipse(45,49,57,12); g.fillStyle(0xf3f5ed,1); g.fillRoundedRect(18,20,48,23,5); g.fillStyle(0x407a54,1); g.fillRect(42,14,23,23); g.fillStyle(0x9fd8f5,1); g.fillRect(47,18,13,8); g.fillStyle(0x355044,1); g.fillCircle(28,44,7); g.fillCircle(58,44,7); g.fillStyle(0xb7df72,1); g.fillRect(20,25,15,5); finish(g,WORLD_TEXTURES.serviceVan,90,58);
  }
}

function bakeTrees(scene: Phaser.Scene): void {
  for (const species of Object.keys(TREE_STYLE) as TreeSpecies[]) {
    const style = TREE_STYLE[species]; const g = graphics(scene); const w = 82, h = 112, x = w / 2, y = h - 12, s = style.scale;
    g.fillStyle(TERRAIN.shadow, 0.24); g.fillEllipse(x, y - 1, 34 * s, 11 * s); g.fillStyle(style.trunk, 1); g.fillRect(x - 4 * s, y - 39 * s, 8 * s, 37 * s); g.fillStyle(shade(style.trunk, 12), 1); g.fillRect(x - 3 * s, y - 37 * s, 3 * s, 32 * s);
    g.fillStyle(style.leaf, 1); g.fillCircle(x, y - 56 * s, 23 * s); g.fillCircle(x - 17 * s, y - 44 * s, 16 * s); g.fillCircle(x + 18 * s, y - 44 * s, 17 * s);
    g.fillStyle(style.light, 1); g.fillCircle(x - 7 * s, y - 64 * s, 12 * s); g.fillCircle(x + 15 * s, y - 55 * s, 9 * s);
    if (style.accent) {
      g.fillStyle(style.accent, 1);
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; g.fillCircle(x + Math.cos(a) * 22 * s, y - 53 * s + Math.sin(a) * 15 * s, 2.6); }
    }
    finish(g, `tree-${species}`, w, h);
  }
}

function bakeBuildings(scene: Phaser.Scene): void {
  for (const kind of Object.keys(BUILDING_STYLE) as BuildingKind[]) {
    const c = BUILDING_STYLE[kind]; const w = 116, h = 166, cx = w / 2, ground = h - 16, roofY = ground - c.height, roofW = kind === "solarHall" ? 51 : 42, roofH = roofW / 2; const g = graphics(scene);
    g.fillStyle(TERRAIN.shadow, 0.25); g.fillEllipse(cx, ground, 72, 18);
    if (kind === "reservoir") {
      g.fillStyle(c.shadow, 1); g.fillRect(cx - 23, roofY, 46, c.height); g.fillStyle(c.wall, 1); g.fillEllipse(cx, roofY, 46, 18); g.fillRect(cx - 23, roofY, 25, c.height); g.fillStyle(c.roof, 1); g.fillEllipse(cx, roofY - 2, 48, 18); g.fillStyle(c.accent, 0.7); g.fillRect(cx - 23, roofY + 17, 46, 5); g.fillStyle(0x4b6674, 1); g.fillRect(cx - 18, ground - 2, 4, 23); g.fillRect(cx + 14, ground - 2, 4, 23);
    } else {
      g.fillStyle(c.shadow, 1); g.fillPoints([new Phaser.Geom.Point(cx - roofW, roofY), new Phaser.Geom.Point(cx, roofY + roofH), new Phaser.Geom.Point(cx, ground), new Phaser.Geom.Point(cx - roofW, ground - roofH)], true);
      g.fillStyle(c.wall, 1); g.fillPoints([new Phaser.Geom.Point(cx + roofW, roofY), new Phaser.Geom.Point(cx, roofY + roofH), new Phaser.Geom.Point(cx, ground), new Phaser.Geom.Point(cx + roofW, ground - roofH)], true);
      g.fillStyle(c.roof, 1); g.fillPoints([new Phaser.Geom.Point(cx, roofY - roofH), new Phaser.Geom.Point(cx + roofW, roofY), new Phaser.Geom.Point(cx, roofY + roofH), new Phaser.Geom.Point(cx - roofW, roofY)], true);
      g.fillStyle(c.roofLight, 0.8); g.fillPoints([new Phaser.Geom.Point(cx, roofY - roofH + 3), new Phaser.Geom.Point(cx + roofW - 6, roofY), new Phaser.Geom.Point(cx, roofY + 5), new Phaser.Geom.Point(cx - roofW + 6, roofY)], true);
      for (let row = 0; row < c.floors; row++) {
        const yy = roofY + roofH + 8 + row * Math.max(11, (c.height - roofH - 17) / c.floors); g.fillStyle(0x79bde0, 1);
        for (let col = 0; col < 3; col++) { g.fillRect(cx + 8 + col * 10, yy, 6, 6); g.fillStyle(0x4e91b9, 1); g.fillRect(cx - 34 + col * 10, yy - 5, 6, 6); g.fillStyle(0x79bde0, 1); }
      }
      g.fillStyle(c.accent, 1); g.fillRect(cx + 5, ground - 20, 10, 20);
      if (kind === "solarHall") { g.lineStyle(2, 0x74b9e5, 0.95); for (let i = -2; i <= 2; i++) g.lineBetween(cx - 27 + i * 8, roofY - 8 + Math.abs(i) * 2, cx + i * 8, roofY + 6 + Math.abs(i) * 2); }
      if (kind === "watchtower") { g.fillStyle(c.accent, 1); g.fillRect(cx - 2, roofY - roofH - 18, 4, 18); g.fillTriangle(cx, roofY - roofH - 18, cx + 13, roofY - roofH - 13, cx, roofY - roofH - 8); }
      if (kind === "resilienceHall") { g.fillStyle(c.wall, 1); g.fillCircle(cx, roofY - roofH - 2, 15); g.fillStyle(c.roofLight, 1); g.fillCircle(cx - 3, roofY - roofH - 6, 10); }
    }
    finish(g, `bld-${kind}`, w, h);
  }
}

function bakeEffects(scene: Phaser.Scene): void {
  { const g = graphics(scene); g.fillStyle(0xffffff, 0.78); g.fillRect(0, 3, 16, 2); g.fillRect(5, 0, 6, 8); finish(g, WORLD_TEXTURES.sparkle, 16, 8); }
  { const g = graphics(scene); g.fillStyle(0xeaff9c, .22); g.fillCircle(8, 8, 8); g.fillStyle(0xd9ff7d, .95); g.fillCircle(8, 8, 3); finish(g, WORLD_TEXTURES.energyPulse, 16, 16); }
  { const g = graphics(scene); g.fillStyle(0xffffff, .22); g.fillEllipse(18, 35, 31, 8); g.fillStyle(0xe7524e, 1); g.fillTriangle(11, 12, 25, 12, 18, 31); g.fillStyle(0xf8f1d8, 1); g.fillRect(15, 5, 6, 12); g.fillStyle(0xf1b840, 1); g.fillCircle(18, 5, 4); finish(g, WORLD_TEXTURES.buoy, 36, 42); }
  {
    const g = graphics(scene); g.fillStyle(0xffffff, 0.84);
    ([[35, 31, 20], [60, 27, 25], [88, 33, 20], [112, 32, 15]] as const).forEach(([x, y, r]) => g.fillCircle(x, y, r));
    g.fillStyle(0xffffff, 0.95); g.fillCircle(65, 21, 18); finish(g, WORLD_TEXTURES.cloud, 145, 62);
  }
  {
    const g = graphics(scene); const x = 45, y = 69; g.fillStyle(0xffffff, 0.28); g.fillEllipse(x, y + 2, 55, 12); g.fillStyle(0x7e4f2c, 1); g.fillTriangle(x - 24, y - 12, x + 25, y - 12, x + 15, y + 1); g.fillStyle(0x4d3423, 1); g.fillRect(x - 13, y - 14, 30, 4); g.fillStyle(0x503820, 1); g.fillRect(x - 1, y - 54, 3, 42); g.fillStyle(0xf3ead8, 1); g.fillTriangle(x + 2, y - 52, x + 2, y - 16, x + 25, y - 31); g.fillStyle(0xd94f4f, 1); g.fillTriangle(x + 1, y - 56, x + 1, y - 48, x + 13, y - 52); finish(g, WORLD_TEXTURES.boat, 90, 82);
  }
}

function bakeConstruction(scene: Phaser.Scene): void {
  {
    const g = graphics(scene); const footX = 152, footY = 206, jibY = 70; g.fillStyle(0x1f4d16, 0.22); g.fillEllipse(footX, footY, 50, 14); g.fillStyle(0xb8b0a0, 1); g.fillEllipse(footX, footY - 2, 35, 11); g.fillStyle(0xf2b134, 1); g.fillRect(footX - 7, jibY, 4, footY - jibY); g.fillStyle(0xc08a1e, 1); g.fillRect(footX + 3, jibY, 4, footY - jibY); g.lineStyle(2, 0x8a6314, 0.9);
    for (let y = jibY + 6; y < footY - 6; y += 16) { g.lineBetween(footX - 4, y, footX + 4, y + 8); g.lineBetween(footX + 4, y, footX - 4, y + 8); }
    g.fillStyle(0xf2b134, 1); g.fillTriangle(footX - 6, jibY, footX - 110, jibY - 55, footX - 110, jibY - 48); g.fillTriangle(footX - 6, jibY, footX - 6, jibY + 7, footX - 110, jibY - 48); g.fillStyle(0xc08a1e, 1); g.fillTriangle(footX + 6, jibY, footX + 44, jibY + 22, footX + 44, jibY + 29); g.fillTriangle(footX + 6, jibY, footX + 6, jibY + 7, footX + 44, jibY + 29); g.fillStyle(0x3f4b5b, 1); g.fillRect(footX - 10, jibY + 7, 17, 14); g.fillStyle(0x9fd8f5, .9); g.fillRect(footX - 7, jibY + 10, 10, 7); g.fillStyle(0x6b7280, 1); g.fillRect(footX + 28, jibY + 17, 18, 14); g.lineStyle(1, 0x2f3742, .9); g.lineBetween(footX, jibY - 26, footX - 104, jibY - 52); g.lineBetween(footX, jibY - 26, footX + 40, jibY + 21); g.lineStyle(2, 0xf2b134, 1); g.lineBetween(footX, jibY, footX, jibY - 26); g.lineStyle(1, 0x2f3742, .9); g.lineBetween(60, 20, 60, 125); g.fillStyle(0x6b7280, 1); g.fillRect(54, 122, 12, 7); g.lineStyle(2, 0x2f3742, 1); g.strokeCircle(60, 136, 5); finish(g, WORLD_TEXTURES.crane, 210, 230);
  }
  {
    const g = graphics(scene); const pole = 0xd8b061; g.fillStyle(0x7b8892, 0.13); g.fillRect(15, 18, 66, 92); g.lineStyle(2, pole, .95); for (const x of [13, 35, 59, 82]) g.lineBetween(x, 10, x, 116); for (const y of [18, 43, 68, 93, 116]) g.lineBetween(10, y, 86, y); g.lineStyle(1, 0xf0d59b, .72); for (let x = 13; x < 80; x += 22) { g.lineBetween(x, 93, x + 22, 68); g.lineBetween(x + 22, 93, x, 68); g.lineBetween(x, 43, x + 22, 18); } finish(g, WORLD_TEXTURES.scaffold, 96, 124);
  }
}
