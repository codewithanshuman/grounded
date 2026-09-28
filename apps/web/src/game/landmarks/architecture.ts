import type { Scene } from 'phaser';
import { createBaker, fillFace, strokeFace, type Baker, type Point3 } from '../../reference-city/textures/core';
import { drawCapitolBox, drawCornice, drawPilasters, drawWindowBand, drawBalustrade, type Box } from '../../reference-city/textures/capitol/primitives';
import { drawGrandStair } from '../../reference-city/textures/capitol/blocks';
import { drawCylinder } from '../../reference-city/textures/capitol/dome';
import type { Colors } from '../../reference-city/textures/capitol/base';

/** Uses the supplied Claude Clan capitol's projection and masonry primitives. */
export const ARCHITECTURE = {
  hospital: { key: 'grounded:architecture:hospital', width: 560, height: 440, anchorY: 145, halfU: 2.5, halfV: 2.5 },
  school: { key: 'grounded:architecture:school', width: 560, height: 400, anchorY: 145, halfU: 2.5, halfV: 2.5 },
  temple: { key: 'grounded:architecture:temple', width: 540, height: 470, anchorY: 145, halfU: 2.5, halfV: 2.5 },
  church: { key: 'grounded:architecture:church', width: 540, height: 480, anchorY: 145, halfU: 2.5, halfV: 2.5 },
  eiffel: { key: 'grounded:architecture:eiffel', width: 540, height: 590, anchorY: 140, halfU: 2.5, halfV: 2.5 },
} as const;

const MARBLE: Colors = { top: 0xf7f5ed, frontLeft: 0xeeeade, frontRight: 0xbec4bf };
const PAVING: Colors = { top: 0xdad8c8, frontLeft: 0xb7b5a8, frontRight: 0x989e98 };
const STONE: Colors = { top: 0xf6dab1, frontLeft: 0xdbb58c, frontRight: 0xae886c };
const BRICK: Colors = { top: 0xe5b895, frontLeft: 0xc7896b, frontRight: 0x9d6553 };
const IRON: Colors = { top: 0xc6ab7a, frontLeft: 0x9c8056, frontRight: 0x705a40 };

class Atelier {
  constructor(readonly baker: Baker, readonly x: number, readonly y: number) {}
  box(box: Box, colors: Colors = MARBLE): void { drawCapitolBox(this.baker, box, this.x, this.y, colors); }
  face(color: number, points: Point3[], alpha = 1): void { fillFace(this.baker, color, alpha, points, this.x, this.y); }
  line(color: number, points: Point3[], width = 1, alpha = 1): void {
    const g = this.baker.graphics;
    g.lineStyle(width, color, alpha);
    g.strokePoints(points.map(p => this.baker.at(p, this.x, this.y)), false);
  }
  cylinder(u: number, v: number, radius: number, bottom: number, top: number, color: number, cap: number): void {
    drawCylinder(this.baker, this.x, this.y, u, v, radius, bottom, top, color, cap, 24);
  }
  cornice(box: Box, overhang = .07, thickness = 4, color = MARBLE): void {
    drawCornice(this.baker, box, this.x, this.y, overhang, thickness, color);
  }
  windows(box: Box, floors: number, baysU: number, baysV: number): void {
    const pitch = (box.z1 - box.z0) / floors;
    for (let floor = 0; floor < floors; floor++) {
      const base = box.z0 + floor * pitch;
      drawWindowBand(this.baker, this.x, this.y, 'v', box.v1 + .006, box.u0 + .09, box.u1 - .09, base + 6, base + pitch - 7, baysU);
      drawWindowBand(this.baker, this.x, this.y, 'u', box.u1 + .006, box.v0 + .09, box.v1 - .09, base + 6, base + pitch - 7, baysV);
      this.cornice({ ...box, z1: base + pitch }, .018, 2.2);
      // Fine mullions catch light on the hospital and classroom facades.
      for (let i = 0; i < baysU; i++) {
        const u = box.u0 + .09 + (box.u1 - box.u0 - .18) * (i + .5) / baysU;
        this.line(0x9dbec5, [[u, box.v1 + .01, base + 7], [u, box.v1 + .01, base + pitch - 8]], .8);
      }
    }
  }
  parapet(box: Box): void {
    this.cornice(box, .09, 4);
    drawBalustrade(this.baker, this.x, this.y, 'u', box.u1, box.v0, box.v1, box.z1, 5);
    drawBalustrade(this.baker, this.x, this.y, 'v', box.v1, box.u0, box.u1, box.z1, 5);
  }
}

function grounds(a: Atelier, lawn = false): void {
  a.face(0x192c26, [[-2.36, -2.36, 0], [2.62, -2.36, 0], [2.62, 2.62, 0], [-2.36, 2.62, 0]], .16);
  a.box({ u0: -2.5, u1: 2.5, v0: -2.5, v1: 2.5, z0: 0, z1: 3 }, PAVING);
  for (let i = -2; i <= 2; i += .5) {
    a.line(0xb6b7a9, [[i, -2.45, 3.2], [i, 2.45, 3.2]], .65, .8);
    a.line(0xb6b7a9, [[-2.45, i, 3.2], [2.45, i, 3.2]], .65, .8);
  }
  if (lawn) {
    for (const u of [-1.85, 1.85]) for (const v of [-1.85, 1.85]) {
      a.box({ u0: u - .45, u1: u + .45, v0: v - .45, v1: v + .45, z0: 3, z1: 5 }, { top: 0x6d9c51, frontLeft: 0x567f40, frontRight: 0x466b39 });
    }
  }
}

function planter(a: Atelier, u: number, v: number, length = .52): void {
  a.box({ u0: u - length / 2, u1: u + length / 2, v0: v - .14, v1: v + .14, z0: 3, z1: 10 }, PAVING);
  a.box({ u0: u - length / 2 + .035, u1: u + length / 2 - .035, v0: v - .10, v1: v + .10, z0: 10, z1: 16 }, { top: 0x5e9a51, frontLeft: 0x3e773f, frontRight: 0x2a5934 });
}

function lamp(a: Atelier, u: number, v: number): void {
  a.box({ u0: u - .08, u1: u + .08, v0: v - .08, v1: v + .08, z0: 3, z1: 7 }, PAVING);
  a.line(0x45544d, [[u, v, 7], [u, v, 34]], 2);
  a.box({ u0: u - .07, u1: u + .07, v0: v - .07, v1: v + .07, z0: 32, z1: 39 }, { top: 0x596251, frontLeft: 0xffe5a5, frontRight: 0xb8a783 });
}

function pitchedRoof(a: Atelier, b: Box, rise: number, color = 0x556e77): void {
  const mid = (b.u0 + b.u1) / 2;
  a.face(color, [[b.u0 - .12, b.v0 - .1, b.z1], [mid, b.v0 - .1, b.z1 + rise], [mid, b.v1 + .1, b.z1 + rise], [b.u0 - .12, b.v1 + .1, b.z1]]);
  a.face(0x394f5a, [[mid, b.v0 - .1, b.z1 + rise], [b.u1 + .12, b.v0 - .1, b.z1], [b.u1 + .12, b.v1 + .1, b.z1], [mid, b.v1 + .1, b.z1 + rise]]);
  a.face(MARBLE.frontLeft, [[b.u0 - .08, b.v1 + .11, b.z1], [b.u1 + .08, b.v1 + .11, b.z1], [mid, b.v1 + .11, b.z1 + rise - 3]]);
  for (let v = b.v0; v < b.v1; v += .18) {
    a.line(0x829698, [[b.u0 - .1, v, b.z1 + 1], [mid, v, b.z1 + rise + 1], [b.u1 + .1, v, b.z1 + 1]], .7, .65);
  }
  a.line(0xa4b3af, [[mid, b.v0 - .12, b.z1 + rise + 1], [mid, b.v1 + .12, b.z1 + rise + 1]], 2);
}

function cross(a: Atelier, u: number, v: number, z: number, color: number, size = 15): void {
  a.line(color, [[u, v, z], [u, v, z + size]], 4);
  a.line(color, [[u - .1, v + .1, z + size * .66], [u + .1, v - .1, z + size * .66]], 4);
}

/** A round feature on the +v facade must follow its plane, not face the camera. */
function facadeCircle(u: number, v: number, z: number, radiusU: number, radiusZ: number, segments = 32): Point3[] {
  return Array.from({ length: segments }, (_, index): Point3 => {
    const angle = index / segments * Math.PI * 2;
    return [u + Math.cos(angle) * radiusU, v, z + Math.sin(angle) * radiusZ];
  });
}

function hospital(a: Atelier): void {
  grounds(a);
  const wings: Box[] = [
    { u0: -1.95, u1: -.65, v0: -1.8, v1: .7, z0: 9, z1: 118 },
    { u0: -.65, u1: 1.95, v0: -1.8, v1: -.5, z0: 9, z1: 154 },
    { u0: .8, u1: 1.95, v0: -.5, v1: 1.2, z0: 9, z1: 110 },
  ];
  for (const block of wings.sort((l, r) => l.u1 + l.v1 - r.u1 - r.v1)) {
    a.box({ ...block, z0: 3, z1: 9 }, PAVING);
    a.box(block);
    a.windows(block, block.z1 > 120 ? 5 : 4, Math.round((block.u1 - block.u0) * 2.8), Math.round((block.v1 - block.v0) * 2.8));
    a.parapet(block);
    a.box({ u0: block.u0 + .22, u1: block.u0 + .64, v0: block.v0 + .22, v1: block.v0 + .7, z0: block.z1 + 1, z1: block.z1 + 12 }, { top: 0xadbfc0, frontLeft: 0x7b959d, frontRight: 0x526d76 });
    for (let j = 0; j < 4; j++) a.line(0x3d515d, [[block.u0 + .28, block.v0 + .3 + j * .08, block.z1 + 12.2], [block.u0 + .57, block.v0 + .3 + j * .08, block.z1 + 12.2]], 1);
  }
  // Recessed glazed entrance, stone piers, covered ambulance court.
  const lobby: Box = { u0: -.62, u1: .72, v0: -.5, v1: .66, z0: 7, z1: 55 };
  a.box(lobby, { top: 0x8aaeb4, frontLeft: 0x527e8c, frontRight: 0x355866 });
  for (let u = -.6; u <= .72; u += .22) a.line(0xb4d3d2, [[u, .67, 8], [u, .67, 54]], 1.5);
  for (let z = 20; z <= 48; z += 14) a.line(0xb4d3d2, [[-.62, .67, z], [.72, .67, z]], 1);
  for (const u of [-.7, .8]) a.box({ u0: u - .055, u1: u + .055, v0: 1.25, v1: 1.36, z0: 4, z1: 37 });
  a.box({ u0: -.88, u1: .97, v0: .55, v1: 1.48, z0: 37, z1: 43 }, MARBLE);
  a.box({ u0: -.88, u1: .97, v0: 1.48, v1: 1.5, z0: 37, z1: 41 }, { top: 0x3c8c84, frontLeft: 0x2c7d78, frontRight: 0x21605b });
  // Medical crosses are geometry on the two highest facades.
  a.face(0xc74946, [[.35, -.49, 126], [.58, -.49, 126], [.58, -.49, 134], [.76, -.49, 134], [.76, -.49, 141], [.58, -.49, 141], [.58, -.49, 149], [.35, -.49, 149], [.35, -.49, 141], [.17, -.49, 141], [.17, -.49, 134], [.35, -.49, 134]]);
  // Helipad: a painted ring on the roof, with its H projected into the same plane.
  const helipad = Array.from({ length: 32 }, (_, i): Point3 => [.62 + Math.cos(i / 32 * Math.PI * 2) * .58, -1.15 + Math.sin(i / 32 * Math.PI * 2) * .48, 155]);
  strokeFace(a.baker, 0xf3ecbf, 1, 2, helipad, a.x, a.y);
  a.line(0xf3ecbf, [[.4, -1.37, 155], [.4, -.93, 155]], 3);
  a.line(0xf3ecbf, [[.83, -1.37, 155], [.83, -.93, 155]], 3);
  a.line(0xf3ecbf, [[.4, -1.15, 155], [.83, -1.15, 155]], 3);
  for (const u of [-1.9, 1.9]) { planter(a, u, 1.8, .72); lamp(a, u, 2.2); }
  for (let u = -.7; u <= .8; u += .24) a.face(0xf9f5df, [[u, 1.7, 3.2], [u + .10, 1.7, 3.2], [u + .10, 2.23, 3.2], [u, 2.23, 3.2]]);
}

function school(a: Atelier): void {
  grounds(a);
  const wings: Box[] = [
    { u0: -2.05, u1: -.7, v0: -1.72, v1: .95, z0: 8, z1: 70 },
    { u0: -.7, u1: 2.05, v0: -1.72, v1: -.35, z0: 8, z1: 70 },
  ];
  for (const block of wings) {
    a.box({ ...block, z0: 3, z1: 8 }, PAVING);
    a.box(block, BRICK); a.windows(block, 2, Math.round((block.u1 - block.u0) * 2.8), Math.round((block.v1 - block.v0) * 2.8));
    a.cornice(block, .1, 5); pitchedRoof(a, block, 19, 0x5a7880);
  }
  // Clock tower and recessed colonnaded entrance.
  const tower = { u0: -.64, u1: .18, v0: -.52, v1: .32, z0: 7, z1: 108 };
  a.box(tower, BRICK); a.windows(tower, 3, 2, 2); a.cornice(tower, .12, 7);
  a.box({ ...tower, u0: -.55, u1: .09, v0: -.43, v1: .23, z0: 108, z1: 123 });
  pitchedRoof(a, { ...tower, z1: 123 }, 16);
  const clockFace = facadeCircle(-.23, .34, 96, .15, 8);
  a.face(0xf9efd9, clockFace);
  strokeFace(a.baker, 0x64523c, 1, 1.2, clockFace, a.x, a.y);
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2;
    a.line(0x786346, [
      [-.23 + Math.cos(angle) * .12, .345, 96 + Math.sin(angle) * 6.3],
      [-.23 + Math.cos(angle) * .14, .345, 96 + Math.sin(angle) * 7.5],
    ], .7);
  }
  a.line(0x514f45, [[-.23, .35, 101], [-.23, .35, 96], [-.15, .35, 94]], 1.3);
  for (const u of [-.6, -.15, .3, .75]) a.box({ u0: u - .05, u1: u + .05, v0: .42, v1: .53, z0: 4, z1: 35 });
  a.box({ u0: -.76, u1: .9, v0: .02, v1: .68, z0: 35, z1: 41 });
  // Courtyard sports surface, markings, benches, and flag standard.
  a.face(0x668578, [[.45, .8, 3.4], [1.94, .8, 3.4], [1.94, 2.07, 3.4], [.45, 2.07, 3.4]]);
  strokeFace(a.baker, 0xe5eadc, 1, 1, [[.58, .92, 3.5], [1.82, .92, 3.5], [1.82, 1.96, 3.5], [.58, 1.96, 3.5]], a.x, a.y);
  a.line(0xe5eadc, [[.58, 1.44, 3.6], [1.82, 1.44, 3.6]], 1);
  const courtCircle = Array.from({ length: 20 }, (_, i): Point3 => [1.2 + Math.cos(i / 20 * Math.PI * 2) * .23, 1.44 + Math.sin(i / 20 * Math.PI * 2) * .23, 3.6]);
  strokeFace(a.baker, 0xe5eadc, 1, 1, courtCircle, a.x, a.y);
  a.line(0x657974, [[-1.35, 1.74, 4], [-1.35, 1.74, 63]], 2);
  a.face(0xf0bb67, [[-1.35, 1.74, 63], [-.73, 1.74, 61], [-.73, 1.74, 46], [-1.35, 1.74, 48]]);
  for (const u of [-2.12, -.4]) { planter(a, u, 1.4); planter(a, u, 2.1); }
  lamp(a, -2.18, 2.2); lamp(a, 2.18, 2.2);
}

function shikhara(a: Atelier, u: number, v: number, radius: number, base: number, height: number): void {
  const segments = 10;
  for (let tier = 0; tier < segments; tier++) {
    const t = tier / segments;
    const r = radius * Math.pow(1 - t, .7);
    const r2 = radius * Math.pow(1 - (tier + 1) / segments, .7);
    const z = base + t * height, z2 = base + (tier + 1) / segments * height;
    a.face(0xe1bc86, [[u - r, v + r, z], [u + r, v + r, z], [u + r2, v + r2, z2], [u - r2, v + r2, z2]]);
    a.face(0xae825a, [[u + r, v - r, z], [u + r, v + r, z], [u + r2, v + r2, z2], [u + r2, v - r2, z2]]);
    a.cornice({ u0: u - r, u1: u + r, v0: v - r, v1: v + r, z0: z, z1: z + 3 }, .035, 3, STONE);
    for (const off of [-.55, 0, .55]) a.line(0xf0d7aa, [[u + r * off, v + r + .006, z + 4], [u + r2 * off, v + r2 + .006, z2]], 1.4);
  }
  a.cylinder(u, v, radius * .17, base + height - 1, base + height + 6, 0xcbac71, 0xf1dcac);
  a.cylinder(u, v, radius * .06, base + height + 6, base + height + 18, 0xb68b43, 0xe7c279);
}

function temple(a: Atelier): void {
  grounds(a);
  a.box({ u0: -1.9, u1: 1.9, v0: -1.75, v1: 1.65, z0: 3, z1: 14 }, STONE);
  a.cornice({ u0: -1.9, u1: 1.9, v0: -1.75, v1: 1.65, z0: 3, z1: 14 }, .06, 4);
  const shrine: Box = { u0: -.88, u1: .88, v0: -1.48, v1: .28, z0: 14, z1: 82 };
  a.box(shrine, STONE);
  drawPilasters(a.baker, a.x, a.y, 'u', .89, -1.48, .28, 18, 78, 5);
  drawPilasters(a.baker, a.x, a.y, 'v', .29, -.88, .88, 18, 78, 5);
  a.cornice(shrine, .14, 6, STONE);
  shikhara(a, 0, -.6, 1.03, 83, 122);
  // Open mandapa: carved columns, capitals, horizontal roof tiers and dark recess.
  a.box({ u0: -.83, u1: .83, v0: .25, v1: .31, z0: 17, z1: 65 }, { top: 0x755740, frontLeft: 0x584b40, frontRight: 0x594336 });
  for (const v of [.42, 1.35]) for (const u of [-1.28, -.43, .43, 1.28]) {
    a.box({ u0: u - .14, u1: u + .14, v0: v - .14, v1: v + .14, z0: 14, z1: 23 }, STONE);
    a.cylinder(u, v, .085, 23, 65, 0xe0bf91, 0xf1d5aa);
    for (const z of [26, 36, 52, 62]) a.cylinder(u, v, .112, z, z + 3, 0xb79160, 0xf1d5aa);
    a.box({ u0: u - .16, u1: u + .16, v0: v - .16, v1: v + .16, z0: 65, z1: 70 }, STONE);
  }
  a.box({ u0: -1.55, u1: 1.55, v0: .15, v1: 1.63, z0: 69, z1: 77 }, STONE);
  a.cornice({ u0: -1.55, u1: 1.55, v0: .15, v1: 1.63, z0: 69, z1: 79 }, .08, 4);
  shikhara(a, 0, .9, .66, 79, 42);
  drawGrandStair(a.baker, a.x, a.y, .87, 1.65, 2.38, 14);
  for (const u of [-2.14, 2.14]) { lamp(a, u, 1.5); planter(a, u, .2, .42); }
  // Cloth standard is part of the sanctuary silhouette, never a status indicator.
  a.line(0xc19c5b, [[0, -.6, 218], [0, -.6, 239]], 1.5);
  a.face(0xd98341, [[0, -.6, 239], [.48, -.6, 235], [0, -.6, 228]]);
}

function archedWindow(a: Atelier, face: 'u' | 'v', at: number, center: number, bottom: number, height: number, half = .13): void {
  const points: Point3[] = [];
  const p = (horizontal: number, z: number): Point3 => face === 'v' ? [horizontal, at, z] : [at, horizontal, z];
  points.push(p(center - half, bottom), p(center + half, bottom), p(center + half, bottom + height * .68));
  for (let i = 0; i <= 8; i++) {
    const t = i / 8 * Math.PI;
    points.push(p(center + Math.cos(t) * half, bottom + height * .68 + Math.sin(t) * height * .32));
  }
  a.face(0x426b79, points);
  strokeFace(a.baker, 0xe6d3b0, 1, 1.5, points, a.x, a.y);
  a.line(0xe6d3b0, [p(center, bottom), p(center, bottom + height)], 1);
  a.line(0xc79775, [p(center - half, bottom + height * .48), p(center + half, bottom + height * .48)], 1);
}

function church(a: Atelier): void {
  grounds(a, true);
  const nave: Box = { u0: -.96, u1: .96, v0: -1.9, v1: 1.35, z0: 8, z1: 88 };
  a.box({ ...nave, z0: 3, z1: 8 }, PAVING);
  a.box(nave, STONE);
  for (let v = -1.48; v <= 1.12; v += .56) {
    archedWindow(a, 'u', .965, v, 29, 43, .13);
    a.box({ u0: .96, u1: 1.11, v0: v - .34, v1: v - .24, z0: 8, z1: 75 }, STONE);
    a.box({ u0: 1.01, u1: 1.21, v0: v - .36, v1: v - .22, z0: 8, z1: 23 }, STONE);
  }
  a.cornice(nave, .1, 5, STONE); pitchedRoof(a, nave, 45, 0x6a7884);
  // Bell tower projects from the entry, leaving the long nave roof visible.
  const tower: Box = { u0: -.68, u1: .68, v0: .75, v1: 1.95, z0: 8, z1: 161 };
  a.box(tower, STONE);
  for (const z of [30, 87, 123, 161]) a.cornice({ ...tower, z1: z }, .08, 4);
  archedWindow(a, 'v', 1.956, 0, 10, 49, .29);
  archedWindow(a, 'v', 1.956, -.28, 130, 23, .14); archedWindow(a, 'v', 1.956, .28, 130, 23, .14);
  archedWindow(a, 'u', .686, 1.07, 130, 23, .13); archedWindow(a, 'u', .686, 1.62, 130, 23, .13);
  for (const u of [-.68, .68]) {
    a.box({ u0: u - .065, u1: u + .065, v0: 1.87, v1: 2.02, z0: 8, z1: 161 }, MARBLE);
    a.box({ u0: u - .1, u1: u + .1, v0: 1.82, v1: 2.04, z0: 159, z1: 168 }, MARBLE);
  }
  // Four-sided slate spire with bright ridge and finial.
  a.face(0x5f7785, [[-.73, .7, 161], [.73, .7, 161], [0, 1.35, 229]]);
  a.face(0x364f5f, [[.73, .7, 161], [.73, 2, 161], [0, 1.35, 229]]);
  a.face(0x50697b, [[-.73, 2, 161], [.73, 2, 161], [0, 1.35, 229]]);
  a.line(0xb5c0ba, [[-.73, 2, 161], [0, 1.35, 229], [.73, 2, 161]], 1.2);
  cross(a, 0, 1.35, 228, 0xc6ad74, 19);
  // Rose window is a twelve-spoke tracery wheel.
  const roseOuter = facadeCircle(0, 1.958, 102, .24, 12);
  a.face(0x466c7d, roseOuter);
  strokeFace(a.baker, 0xf2d9ad, 1, 2, roseOuter, a.x, a.y);
  strokeFace(a.baker, 0xf2d9ad, 1, 1.3, facadeCircle(0, 1.96, 102, .08, 4), a.x, a.y);
  for (let i = 0; i < 12; i++) {
    const angle = i / 12 * Math.PI * 2;
    a.line(0xe8c894, [[Math.cos(angle) * .08, 1.962, 102 + Math.sin(angle) * 4], [Math.cos(angle) * .22, 1.962, 102 + Math.sin(angle) * 11]], 1);
  }
  drawGrandStair(a.baker, a.x, a.y, .74, 1.96, 2.4, 8);
  lamp(a, -1.28, 2.17); lamp(a, 1.28, 2.17);
}

function eiffel(a: Atelier): void {
  grounds(a, true);
  const levels = [
    { z: 9, h: 1.58, w: .34 }, { z: 45, h: 1.32, w: .29 }, { z: 87, h: .97, w: .23 },
    { z: 115, h: .83, w: .19 }, { z: 151, h: .66, w: .16 }, { z: 193, h: .48, w: .13 },
    { z: 236, h: .34, w: .1 }, { z: 280, h: .24, w: .075 }, { z: 325, h: .16, w: .06 }, { z: 360, h: .1, w: .045 },
  ];
  const corners: Array<[number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
  for (const [su, sv] of corners) a.box({ u0: su * 1.58 - .4, u1: su * 1.58 + .4, v0: sv * 1.58 - .4, v1: sv * 1.58 + .4, z0: 3, z1: 11 }, PAVING);
  const leg = (su: number, sv: number): void => {
    for (let i = 0; i < levels.length - 1; i++) {
      const lo = levels[i], hi = levels[i + 1];
      const l: Point3 = [su * lo.h, sv * lo.h, lo.z], h: Point3 = [su * hi.h, sv * hi.h, hi.z];
      a.face(su > 0 ? 0x9f8154 : 0xb69968, [[l[0] - lo.w / 2, l[1], lo.z], [l[0] + lo.w / 2, l[1], lo.z], [h[0] + hi.w / 2, h[1], hi.z], [h[0] - hi.w / 2, h[1], hi.z]]);
      a.face(sv > 0 ? 0x806445 : 0x987b52, [[l[0], l[1] - lo.w / 2, lo.z], [l[0], l[1] + lo.w / 2, lo.z], [h[0], h[1] + hi.w / 2, hi.z], [h[0], h[1] - hi.w / 2, hi.z]]);
      for (let row = 0; row < 3; row++) {
        const t0 = row / 3, t1 = (row + 1) / 3;
        const interp = (t: number, side: number): Point3 => [l[0] + (h[0] - l[0]) * t + side * (lo.w + (hi.w - lo.w) * t) * .45, l[1] + (h[1] - l[1]) * t, lo.z + (hi.z - lo.z) * t];
        a.line(0x514637, [interp(t0, -1), interp(t1, 1)], .8, .9);
        a.line(0xe2c590, [interp(t0, 1), interp(t1, -1)], .8, .85);
      }
      a.line(0xe0c494, [[l[0] - lo.w / 2, l[1], lo.z], [h[0] - hi.w / 2, h[1], hi.z]], 1.25);
    }
  };
  // Far legs precede lattice faces; the near two legs close the silhouette.
  leg(-1, -1); leg(1, -1); leg(-1, 1);
  for (const axis of ['u', 'v'] as const) {
    const point = (along: number, depth: number, z: number): Point3 => axis === 'u' ? [depth, along, z] : [along, depth, z];
    for (let i = 2; i < levels.length - 1; i++) {
      const lo = levels[i], hi = levels[i + 1];
      a.line(axis === 'u' ? 0x785e3e : 0xab8d5b, [point(-lo.h, lo.h, lo.z), point(hi.h, hi.h, hi.z)], 1.65);
      a.line(axis === 'u' ? 0x977746 : 0xd6b37a, [point(lo.h, lo.h, lo.z), point(-hi.h, hi.h, hi.z)], 1.65);
      a.line(0xa18355, [point(-lo.h, lo.h, lo.z), point(lo.h, lo.h, lo.z)], 2);
      // A finer intermediate lattice keeps upper sections visually structured.
      if (i > 3) {
        const half = (lo.h + hi.h) / 2, z = (lo.z + hi.z) / 2;
        a.line(0x907449, [point(-half, half, z), point(half, half, z)], 1);
      }
    }
    const arch: Point3[] = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28, along = -1.52 + 3.04 * t;
      arch.push(point(along, 1.49 - Math.sin(t * Math.PI) * .42, 13 + Math.sin(t * Math.PI) * 69));
    }
    a.line(0x806445, arch, 6);
    a.line(0xc6a16b, arch, 2);
    for (let i = 2; i < 27; i += 2) {
      const p = arch[i];
      a.line(0x9a7b4e, [p, point(axis === 'u' ? p[1] : p[0], .97, 86)], .9);
    }
  }
  leg(1, 1);
  for (const [z, half] of [[88, 1.16], [195, .65], [361, .2]] as const) {
    a.box({ u0: -half, u1: half, v0: -half, v1: half, z0: z, z1: z + 6 }, IRON);
    // Iron observation decks use fine open rails rather than the stone court's balusters.
    for (const axis of ['u', 'v'] as const) {
      const point = (along: number, height: number): Point3 => axis === 'u' ? [half, along, height] : [along, half, height];
      for (const height of [z + 8, z + 14]) a.line(0xd2b178, [point(-half, height), point(half, height)], 1.4);
      const bays = Math.max(3, Math.round(half * 14));
      for (let bay = 0; bay <= bays; bay++) {
        const along = -half + 2 * half * bay / bays;
        a.line(0x947448, [point(along, z + 6), point(along, z + 14)], 1);
      }
    }
  }
  // Crown, observation lantern, and radio mast.
  a.box({ u0: -.13, u1: .13, v0: -.13, v1: .13, z0: 367, z1: 379 }, IRON);
  a.face(0xdcc28a, [[-.19, -.19, 379], [.19, -.19, 379], [.19, .19, 379], [-.19, .19, 379]]);
  a.line(0x967449, [[0, 0, 378], [0, 0, 408]], 3);
  a.line(0xe5d5b3, [[-.01, 0, 381], [-.01, 0, 408]], 1);
  for (const u of [-2.15, 2.15]) for (const v of [-2.15, 2.15]) lamp(a, u, v);
}

/** Textures use origin (.5, 1); place at groundY + descriptor.anchorY. */
export function bakeArchitecture(scene: Scene): void {
  const baker = createBaker(scene);
  const builders = { hospital, school, temple, church, eiffel };
  for (const name of Object.keys(ARCHITECTURE) as Array<keyof typeof ARCHITECTURE>) {
    const asset = ARCHITECTURE[name];
    if (scene.textures.exists(asset.key)) continue;
    builders[name](new Atelier(baker, asset.width / 2, asset.height - asset.anchorY));
    baker.finish(asset.key, asset.width, asset.height);
  }
  baker.destroy();
}
