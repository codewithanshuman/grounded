import Phaser from 'phaser';
import { GROUND_DEPTH, projection } from '../../reference-city/world/core/worldConstants';
import { TERRAIN_ATLAS_KEY, terrainTextureKey } from '../../reference-city/textures/terrain';
import { propTextureKey } from '../../reference-city/textures/props';
import { prefersReducedMotion } from '../../reference-city/systems/ambient';
import { RESERVE, insideReserveStructure, reserveDistance, reserveTrail } from './worldLayout';

/** Builds once; the actual mainland terrain is never repainted or cut away. */
export function addReserve(scene: Phaser.Scene): Phaser.GameObjects.GameObject[] {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const reduced = prefersReducedMotion();
  for (let gx = -46; gx <= -21; gx++) for (let gy = -4; gy <= 28; gy++) {
    const d = reserveDistance(gx, gy);
    if (d > 1.18) continue;
    const p = projection.project(gx, gy);
    const kind = d > 1 ? 'water' : d > .80 || reserveTrail(gx, gy) ? 'sand' : 'park';
    objects.push(scene.add.image(p.x, p.y + 24, TERRAIN_ATLAS_KEY, terrainTextureKey(kind, Math.abs(gx * 11 + gy * 7) % 2))
      .setOrigin(.5, 1).setDepth(GROUND_DEPTH + 5));
    // Groves occupy the even rows; odd rows remain available for run evidence.
    if (d < .76 && gy % 2 === 0 && gx % 2 === 0 && !reserveTrail(gx, gy) && !insideReserveStructure(gx, gy)) {
      const variant = Math.abs(gx * 13 + gy * 7) % 5;
      const key = variant === 0 ? 'tree-flowering' : variant === 1 ? 'tree-ancient' : propTextureKey(variant === 2 ? 'pine' : 'tree');
      const scale = variant < 2 ? 1.22 : 1.05 + (Math.abs(gx + gy) % 4) * .13;
      const anchor = variant < 2 ? 12 : 24;
      const tree = scene.add.image(p.x, p.y + anchor * scale, key).setOrigin(.5, 1).setScale(scale).setDepth(projection.depth(gx, gy));
      objects.push(tree);
      if (!reduced && variant === 0) scene.tweens.add({ targets: tree, angle: .7, duration: 2800 + gy * 20, yoyo: true, repeat: -1, ease: 'Sine.InOut' });
    }
    if (d > .58 && d < .78 && (gx + gy) % 4 === 0 && !reserveTrail(gx, gy) && !insideReserveStructure(gx, gy)) {
      objects.push(scene.add.image(p.x - 10, p.y + 24, propTextureKey('bush')).setOrigin(.5, 1).setDepth(projection.depth(gx, gy) + 1));
    }
  }
  // Small shoreline ripples, only in the channel and around the island.
  for (let i = 0; i < 14; i++) {
    const p = projection.project(-21 + (i % 6) * 2, 3 + Math.floor(i / 6) * 9);
    const ripple = scene.add.ellipse(p.x, p.y, 28, 6).setStrokeStyle(1, 0xc7eff5, .42).setDepth(GROUND_DEPTH + 7);
    if (!reduced) scene.tweens.add({ targets: ripple, x: p.x + 18, alpha: .1, duration: 1900 + i * 80, yoyo: true, repeat: -1 });
    objects.push(ripple);
  }
  objects.push(drawBridge(scene));
  return objects;
}

/** Continuous three-dimensional deck, not eight disconnected diamond sprites. */
function drawBridge(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const g = scene.add.graphics().setDepth(-700_000);
  const y = RESERVE.bridgeY, start = RESERVE.bridgeStart, end = RESERVE.bridgeEnd;
  const project = (x: number, v: number, z = 0) => {
    const p = projection.project(x, v, z);
    return new Phaser.Geom.Point(p.x, p.y);
  };
  const face = (color: number, points: Array<[number, number, number]>, alpha = 1) => {
    g.fillStyle(color, alpha); g.fillPoints(points.map(p => project(...p)), true);
  };
  const line = (color: number, width: number, points: Array<[number, number, number]>, alpha = 1) => {
    g.lineStyle(width, color, alpha); g.strokePoints(points.map(p => project(...p)), false);
  };
  const lift = (x: number) => Math.min(28, Math.max(0, (x - start) * 14), Math.max(0, (end - x) * 14));
  // Long piers descend to the original water plane, carrying paired crossheads.
  for (let x = start + 3; x < end - 1; x += 3) {
    const p = project(x, y);
    g.fillStyle(0x165d88, .22); g.fillEllipse(p.x + 10, p.y + 9, 76, 15);
    for (const v of [y - .6, y + .6]) {
      face(0x8b988e, [[x-.12,v-.12,0],[x+.12,v-.12,0],[x+.12,v-.12,25],[x-.12,v-.12,25]]);
      face(0xb1b7a7, [[x+.12,v-.12,0],[x+.12,v+.12,0],[x+.12,v+.12,25],[x+.12,v-.12,25]]);
    }
    line(0xc9cbb8, 7, [[x,y-.78,24],[x,y+.78,24]]);
  }
  // Back parapet first, then deck & near parapet for correct occlusion.
  for (let x = start; x < end; x += .5) {
    const next = x + .5, a = lift(x), b = lift(next);
    face(0x7c8e78, [[x,y-.85,a-6],[next,y-.85,b-6],[next,y-.85,b],[x,y-.85,a]]);
    face(0x829575, [[x,y+.85,a-6],[next,y+.85,b-6],[next,y+.85,b],[x,y+.85,a]]);
    face(Math.round(x*2)%2 ? 0xd8c79e : 0xe2d3af, [[x,y-.85,a],[next,y-.85,b],[next,y+.85,b],[x,y+.85,a]]);
    line(0x9b8966, .7, [[x,y-.78,a+.3],[x,y+.78,a+.3]], .55);
    for (const side of [-1,1]) {
      const v=y+side*.79;
      line(0x435f51, 2, [[x,v,a+15],[next,v,b+15]]);
      line(0x7a9480, 1.4, [[x,v,a+7],[next,v,b+7]]);
      if (Number.isInteger(x)) line(0x435f51, 2, [[x,v,a],[x,v,a+16]]);
    }
  }
  // Arched steel braces carry the longest water spans; lamps repeat at piers.
  for (let x=start+2; x<end-2; x+=3) for (const side of [-1,1]) {
    const v=y+side*.85;
    const arch: Array<[number,number,number]> = [];
    for (let i=0;i<=12;i++) arch.push([x+i/4,v,28+38*Math.sin(i/12*Math.PI)]);
    line(0x527464, 3, arch);
    for (let i=1;i<6;i++) line(0x789384, 1, [[x+i/2,v,28],[x+i/2,v,28+38*Math.sin(i/6*Math.PI)]]);
    const p=project(x,v,63);
    line(0x365246,2,[[x,v,28],[x,v,62]]);
    g.fillStyle(0xffeab2,.22);g.fillCircle(p.x,p.y,8);
    g.fillStyle(0xffe8ad,1);g.fillCircle(p.x,p.y,3);
  }
  // Approach is a raised path ON TOP of intact countryside, ending at road x=0.
  face(0xcfc4a6, [[end,y-.65,0],[.2,y-.65,0],[.2,y+.65,0],[end,y+.65,0]]);
  line(0xece1c5,2,[[end,y+.65,.5],[.2,y+.65,.5]]);
  line(0xb1a17f,2,[[end,y-.65,.5],[.2,y-.65,.5]]);
  return g;
}
