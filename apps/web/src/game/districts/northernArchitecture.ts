import type { Scene } from 'phaser';
import { createBaker, fillFace, strokeFace, type Baker, type Point3 } from '../../reference-city/textures/core';
import { drawCapitolBox, drawCornice, drawWindowBand, drawPilasters, drawBalustrade, type Box } from '../../reference-city/textures/capitol/primitives';
import { drawCylinder } from '../../reference-city/textures/capitol/dome';
import type { Colors } from '../../reference-city/textures/capitol/base';
import type { NorthernBuilding } from './expansionLayout';

/** These are authored geometry using the archive's exact isometric/masonry tools. */
export const NORTHERN_ARCHITECTURE = { width: 832, height: 864, anchorY: 220, halfSize: 3.5 } as const;
export const northernTextureKey = (kind: NorthernBuilding) => `grounded:northern:${kind}`;
const STONE: Colors = { top: 0xf3f0dc, frontLeft: 0xdedcc8, frontRight: 0xa9b8ad };
const TERRACOTTA: Colors = { top: 0xe9c0a0, frontLeft: 0xc99378, frontRight: 0x95695d };
const PAVING: Colors = { top: 0xdedbcb, frontLeft: 0xb9bead, frontRight: 0x99aa9b };
const GLASS: Colors = { top: 0xa1c9bf, frontLeft: 0x649b97, frontRight: 0x386d78 };
const STEEL: Colors = { top: 0xa5b8b1, frontLeft: 0x708f8c, frontRight: 0x496d70 };
const TIMBER: Colors = { top: 0xc9ab76, frontLeft: 0xa8865a, frontRight: 0x766444 };

class Studio {
  readonly x = NORTHERN_ARCHITECTURE.width / 2;
  readonly y = NORTHERN_ARCHITECTURE.height - NORTHERN_ARCHITECTURE.anchorY;
  constructor(readonly baker: Baker) {}
  box(bounds: Box, palette = STONE) { drawCapitolBox(this.baker, bounds, this.x, this.y, palette); }
  face(color: number, points: Point3[], alpha = 1) { fillFace(this.baker, color, alpha, points, this.x, this.y); }
  line(color: number, points: Point3[], width = 1, alpha = 1) {
    this.baker.graphics.lineStyle(width, color, alpha).strokePoints(points.map(point => this.baker.at(point, this.x, this.y)), false);
  }
  cylinder(u: number, v: number, radius: number, z0: number, z1: number, color: number, top: number) {
    drawCylinder(this.baker, this.x, this.y, u, v, radius, z0, z1, color, top, 24);
  }
  cornice(bounds: Box, palette = STONE, overhang = .075, thickness = 4) {
    drawCornice(this.baker, bounds, this.x, this.y, overhang, thickness, palette);
  }
  windows(bounds: Box, floors: number, baysU = 5, baysV = 5, palette = STONE) {
    const pitch = (bounds.z1 - bounds.z0) / floors;
    for (let floor = 0; floor < floors; floor++) {
      const z = bounds.z0 + floor * pitch;
      drawWindowBand(this.baker, this.x, this.y, 'u', bounds.u1 + .006, bounds.v0 + .1, bounds.v1 - .1, z + 7, z + pitch - 6, baysV);
      drawWindowBand(this.baker, this.x, this.y, 'v', bounds.v1 + .006, bounds.u0 + .1, bounds.u1 - .1, z + 7, z + pitch - 6, baysU);
      this.cornice({ ...bounds, z1: z + pitch }, palette, .025, 2);
    }
  }
  parapet(bounds: Box) {
    this.cornice(bounds, STONE, .09, 4);
    drawBalustrade(this.baker, this.x, this.y, 'u', bounds.u1, bounds.v0, bounds.v1, bounds.z1, 7);
    drawBalustrade(this.baker, this.x, this.y, 'v', bounds.v1, bounds.u0, bounds.u1, bounds.z1, 7);
  }
  grounds() {
    this.face(0x163e32, [[-3.5,-3.5,0],[3.5,-3.5,0],[3.5,3.5,0],[-3.5,3.5,0]], .14);
    this.box({ u0:-3.35,u1:3.35,v0:-3.35,v1:3.35,z0:0,z1:4 }, PAVING);
    for (let t = -3; t <= 3; t += .5) {
      this.line(0xc2c7b6, [[t,-3.3,4.2],[t,3.3,4.2]], .65);
      this.line(0xc2c7b6, [[-3.3,t,4.2],[3.3,t,4.2]], .65);
    }
  }
  planter(u: number, v: number, size = .34, z = 4) {
    this.box({u0:u-size,u1:u+size,v0:v-size*.45,v1:v+size*.45,z0:z,z1:z+7}, PAVING);
    this.box({u0:u-size+.04,u1:u+size-.04,v0:v-size*.45+.03,v1:v+size*.45-.03,z0:z+7,z1:z+13}, {top:0x7da65b,frontLeft:0x51814a,frontRight:0x356344});
    for (const offset of [-.55,0,.55]) this.cylinder(u+offset*size,v,size*.23,z+13,z+20,0x598652,0x8cb469);
  }
  lamp(u: number, v: number) {
    this.box({u0:u-.06,u1:u+.06,v0:v-.06,v1:v+.06,z0:4,z1:10}, STEEL);
    this.line(0x48695b, [[u,v,10],[u,v,41]], 2);
    this.box({u0:u-.07,u1:u+.07,v0:v-.07,v1:v+.07,z0:39,z1:47},{top:0x65785c,frontLeft:0xf1db9c,frontRight:0xb9ba83});
  }
  entrance(u0: number, u1: number, v: number, z = 4, roof = 40) {
    for (const u of [u0,u0+(u1-u0)/3,u0+(u1-u0)*2/3,u1]) {
      this.box({u0:u-.09,u1:u+.09,v0:v-.09,v1:v+.09,z0:z,z1:roof-3});
      this.cornice({u0:u-.09,u1:u+.09,v0:v-.09,v1:v+.09,z0:z,z1:roof-3},STONE,.035,4);
    }
    this.box({u0:u0-.2,u1:u1+.2,v0:v-.6,v1:v+.17,z0:roof-3,z1:roof+4});
    for (let step = 0; step < 5; step++) this.box({u0:u0-.3,u1:u1+.3,v0:v+.17+step*.14,v1:v+.32+step*.14,z0:4,z1:z+7-step*1.4},PAVING);
  }
  solar(u: number, v: number, rows = 2, cols = 4, z = 6) {
    for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
      const x=u+col*.36,y=v+row*.54;
      this.box({u0:x-.025,u1:x+.025,v0:y+.02,v1:y+.035,z0:z,z1:z+12},STEEL);
      this.face(0x2b5571, [[x-.14,y-.22,z+16],[x+.14,y-.22,z+16],[x+.14,y+.22,z+7],[x-.14,y+.22,z+7]]);
      this.line(0xa7ccce, [[x-.14,y-.22,z+16],[x+.14,y-.22,z+16],[x+.14,y+.22,z+7],[x-.14,y+.22,z+7],[x-.14,y-.22,z+16]], .8);
      for (const q of [-.05,.05]) this.line(0x6397ad, [[x+q,y-.22,z+16],[x+q,y+.22,z+7]],.6);
      this.line(0x6397ad, [[x-.14,y,z+11.5],[x+.14,y,z+11.5]],.6);
    }
  }
}

function research(a: Studio) {
  a.grounds();
  const wings: Box[] = [
    {u0:-2.65,u1:2.55,v0:-2.5,v1:-1.25,z0:9,z1:123},
    {u0:-2.65,u1:-1.25,v0:-1.25,v1:1.85,z0:9,z1:98},
    {u0:1.25,u1:2.55,v0:-1.25,v1:1.1,z0:9,z1:104},
  ];
  for (const b of wings) { a.box({...b,z0:4,z1:9},PAVING);a.box(b);a.windows(b,3,Math.ceil((b.u1-b.u0)*3),Math.ceil((b.v1-b.v0)*3));a.parapet(b); }
  drawPilasters(a.baker,a.x,a.y,'v',-1.24,-2.5,2.4,13,118,12);
  a.cylinder(.45,-1.9,.55,124,145,0xb8c4b4,0xecf0db);
  for(let tier=0;tier<8;tier++)a.cylinder(.45,-1.9,.54*Math.cos(tier/8*Math.PI/2),145+tier*3,148+tier*3,0x7299a1,0xc2d6d0);
  a.line(0xbad2cc, [[.45,-1.9,166],[.45,-1.9,183]],1.8);
  a.box({u0:-.95,u1:.95,v0:-1.23,v1:-1.17,z0:9,z1:46},GLASS);
  a.entrance(-1.02,1.02,.2,9,48);
  a.solar(-2.25,-2.2,1,3,125);
  for(const u of [-2.65,2.65])for(const v of [2.3,2.85])a.planter(u,v,.48);
  a.lamp(-1.7,3);a.lamp(1.7,3);
  for(let s=-.5;s<=.5;s+=.5)a.box({u0:s-.17,u1:s+.17,v0:2.1,v1:2.22,z0:4,z1:11},TIMBER);
}

function library(a: Studio) {
  a.grounds();
  const b:Box={u0:-2.3,u1:2.3,v0:-2.3,v1:1.3,z0:13,z1:117};
  a.box({...b,z0:4,z1:13},PAVING);a.box(b);a.windows(b,3,10,8);a.parapet(b);
  for(const u of [-2.1,-1.4,-.7,0,.7,1.4,2.1]) {
    a.cylinder(u,1.65,.09,13,76,0xd5d8be,0xeeefd8);
    a.box({u0:u-.17,u1:u+.17,v0:1.49,v1:1.82,z0:9,z1:17},STONE);
    a.box({u0:u-.17,u1:u+.17,v0:1.49,v1:1.82,z0:74,z1:82},STONE);
  }
  a.box({u0:-2.55,u1:2.55,v0:1.24,v1:1.94,z0:82,z1:89});
  a.face(0xd6d7bc,[[-2.65,1.96,89],[2.65,1.96,89],[0,1.96,122]]);
  a.line(0xf4f0d8,[[-2.65,1.98,89],[0,1.98,122],[2.65,1.98,89]],3);
  a.box({u0:-.8,u1:.8,v0:1.305,v1:1.32,z0:13,z1:63},GLASS);
  for(let step=0;step<7;step++)a.box({u0:-2.6,u1:2.6,v0:1.94+step*.15,v1:2.1+step*.15,z0:4,z1:13-step*1.28},PAVING);
  a.box({u0:-1.1,u1:1.1,v0:-1.35,v1:-.2,z0:118,z1:158},GLASS);
  a.box({u0:-1.25,u1:1.25,v0:-1.5,v1:-.05,z0:158,z1:163},STONE);
  for(let u=-.9;u<=.9;u+=.3)a.line(0xe0e8d7,[[u,-.19,118],[u,-.19,158]],1.6);
  a.planter(-2.85,2.25,.3);a.planter(2.85,2.25,.3);a.lamp(-3,3);a.lamp(3,3);
}

function conservatory(a: Studio) {
  a.grounds();
  a.box({u0:-2.8,u1:2.8,v0:-2.4,v1:1.8,z0:4,z1:16},PAVING);
  // Three glazed vaults: curved ribs are projected in the same plane as panes.
  for(const u of [-1.8,0,1.8]) {
    a.box({u0:u-.82,u1:u+.82,v0:-2.25,v1:1.65,z0:16,z1:71},GLASS);
    for(let strip=0;strip<12;strip++) {
      const theta0=strip/12*Math.PI,theta1=(strip+1)/12*Math.PI;
      const x0=u+Math.cos(theta0)*.83,x1=u+Math.cos(theta1)*.83;
      const z0=71+Math.sin(theta0)*42,z1=71+Math.sin(theta1)*42;
      a.face(strip<6?0x80b3b0:0xb0d3c3,[[x0,-2.25,z0],[x1,-2.25,z1],[x1,1.65,z1],[x0,1.65,z0]],.94);
    }
    for(let v=-2.25;v<=1.66;v+=.39) {
      const rib:Point3[]=[];for(let t=0;t<=16;t++){const theta=t/16*Math.PI;rib.push([u+Math.cos(theta)*.835,v,71+Math.sin(theta)*42]);}
      a.line(0xdfe8d5,rib,1.6);
    }
    for(const edge of [u-.83,u+.83])a.line(0xe0e7d1,[[edge,-2.25,70],[edge,1.65,70]],2);
    for(let v=-2.1;v<=1.6;v+=.4)a.line(0xc7dfcc,[[u+.835,v,16],[u+.835,v,71]],1.1);
  }
  a.box({u0:-.65,u1:.65,v0:1.66,v1:2.15,z0:16,z1:54},GLASS);
  a.line(0xe1e6d2,[[0,2.155,16],[0,2.155,54]],1.5);
  a.entrance(-.68,.68,2.5,16,57);
  for(const u of [-2.9,2.9])for(const v of [-1.8,-.4,1,2.4])a.planter(u,v,.24);
  a.lamp(-1.6,3.05);a.lamp(1.6,3.05);
}

function apartments(a: Studio) {
  a.grounds();
  const blocks:Box[]=[
    {u0:-2.6,u1:-.5,v0:-2.5,v1:-.55,z0:9,z1:175},
    {u0:.1,u1:2.4,v0:-2.5,v1:-.55,z0:9,z1:145},
    {u0:-2.6,u1:-.5,v0:.2,v1:1.7,z0:9,z1:109},
    {u0:.1,u1:2.4,v0:.2,v1:1.7,z0:9,z1:79},
  ];
  for(const b of blocks){a.box({...b,z0:4,z1:9},PAVING);a.box(b,TERRACOTTA);a.windows(b,Math.round((b.z1-9)/33),5,4,TERRACOTTA);a.parapet(b);a.planter(b.u0+.55,b.v1-.15,.38,b.z1+2);a.solar(b.u0+.32,b.v0+.38,1,3,b.z1+2);}
  for(const b of blocks)for(let z=39;z<b.z1;z+=33) {
    a.box({u0:b.u0+.1,u1:b.u1-.1,v0:b.v1,v1:b.v1+.21,z0:z,z1:z+3},PAVING);
    a.line(0x729586,[[b.u0+.1,b.v1+.22,z+10],[b.u1-.1,b.v1+.22,z+10]],1.8);
    for(let u=b.u0+.1;u<b.u1;u+=.3)a.line(0x91ab93,[[u,b.v1+.22,z+3],[u,b.v1+.22,z+10]],1);
  }
  for(const u of [-2.6,-1.25,1.1,2.45])a.planter(u,2.6,.47);
  for(const u of [-3,3])a.lamp(u,3);
  a.box({u0:-.38,u1:-.28,v0:-2.6,v1:2.65,z0:4,z1:6},PAVING);
}

function tower(a: Studio) {
  a.grounds();
  for(const b of [
    {u0:-2.25,u1:-.25,v0:-2.15,v1:.2,z0:13,z1:268},
    {u0:.4,u1:2.3,v0:-1.7,v1:.7,z0:13,z1:224},
  ]) {
    a.box({...b,z0:4,z1:13},PAVING);a.box(b,GLASS);
    a.windows(b,Math.round((b.z1-13)/26),5,6,STEEL);
    for(let u=b.u0+.08;u<=b.u1;u+=.3)a.line(0xaad3c6,[[u,b.v1+.01,13],[u,b.v1+.01,b.z1]],1.3);
    for(let v=b.v0+.08;v<=b.v1;v+=.3)a.line(0x80b3b4,[[b.u1+.01,v,13],[b.u1+.01,v,b.z1]],1.2);
    a.cornice(b,STONE,.12,7);
    a.box({u0:b.u0+.25,u1:b.u1-.25,v0:b.v0+.25,v1:b.v1-.25,z0:b.z1,z1:b.z1+29},STEEL);
    a.box({u0:b.u0+.2,u1:b.u1-.2,v0:b.v0+.2,v1:b.v1-.2,z0:b.z1+29,z1:b.z1+33},STONE);
    for(let z=b.z1+7;z<b.z1+28;z+=5)a.line(0x4f716e,[[b.u0+.3,b.v1-.24,z],[b.u1-.3,b.v1-.24,z]],2);
  }
  const podium={u0:-2.8,u1:2.8,v0:.9,v1:2.45,z0:4,z1:43};a.box(podium);a.windows(podium,1,12,3);a.parapet(podium);
  for(const u of [-2,-.8,.8,2])a.planter(u,1.75,.48,45);
  a.entrance(-.8,.8,2.68,4,31);a.lamp(-3,3);a.lamp(3,3);
}

function innovation(a: Studio) {
  a.grounds();
  const base={u0:-2.6,u1:2.6,v0:-2.2,v1:1.65,z0:9,z1:76};a.box({...base,z0:4,z1:9},PAVING);a.box(base,GLASS);
  // Timber ribs span a shallow barrel roof, with independent lit/shaded faces.
  for(let u=-2.65;u<2.65;u+=.32) {
    const z=78+32*Math.sin((u+2.65)/5.3*Math.PI);
    const next=u+.31,z2=78+32*Math.sin((next+2.65)/5.3*Math.PI);
    a.face(0xd8bb83,[[u,-2.3,z],[next,-2.3,z2],[next,1.75,z2],[u,1.75,z]]);
    a.line(0x94764c,[[u,-2.3,z+1],[u,1.75,z+1]],2);
  }
  for(let u=-2.5;u<=2.5;u+=.42)a.line(0xd4cda8,[[u,1.66,9],[u,1.66,77]],2.4);
  for(let v=-2.1;v<=1.6;v+=.42)a.line(0xb5c4af,[[2.61,v,9],[2.61,v,77]],1.6);
  a.entrance(-.9,.9,2,9,45);
  for(const u of [-2.6,2.6]) {a.planter(u,2.2,.42);a.lamp(u,3);}
  // A low outdoor teaching pergola and four slatted benches.
  for(const u of [-2.6,-1.6])for(const v of [2.55,3.05])a.box({u0:u-.04,u1:u+.04,v0:v-.04,v1:v+.04,z0:4,z1:35},TIMBER);
  for(let v=2.5;v<=3.08;v+=.1)a.box({u0:-2.7,u1:-1.5,v0:v,v1:v+.045,z0:35,z1:39},TIMBER);
}

function depot(a: Studio) {
  a.grounds();
  const b={u0:-2.7,u1:2.7,v0:-2.55,v1:.15,z0:4,z1:79};a.box(b,STEEL);a.cornice(b,STONE,.12,5);
  for(const u of [-1.8,0,1.8]){
    a.face(0x284c52,[[u-.68,.16,7],[u+.68,.16,7],[u+.68,.16,63],[u-.68,.16,63]]);
    for(let z=10;z<=63;z+=7)a.line(0x638b88,[[u-.65,.17,z],[u+.65,.17,z]],1.2);
    a.box({u0:u-.75,u1:u+.75,v0:.12,v1:.26,z0:64,z1:69},STONE);
  }
  a.solar(-2.28,-2.12,4,12,81);
  for(const u of [-1.5,1.15]) {
    a.box({u0:u-.32,u1:u+.32,v0:.7,v1:2.2,z0:10,z1:39},{top:0xe7e7d7,frontLeft:0x69a77d,frontRight:0x3f7f72});
    a.box({u0:u-.34,u1:u+.34,v0:.68,v1:2.22,z0:39,z1:43},STONE);
    for(let v=.85;v<=1.8;v+=.28)a.face(0x285461,[[u+.326,v,23],[u+.326,v+.22,23],[u+.326,v+.22,36],[u+.326,v,36]]);
    a.face(0x345d63,[[u-.27,2.226,23],[u+.27,2.226,23],[u+.27,2.226,36],[u-.27,2.226,36]]);
    for(const v of [.96,1.86]){const p=a.baker.at([u+.34,v,10],a.x,a.y);a.baker.graphics.fillStyle(0x263e41).fillEllipse(p.x,p.y,11,9);a.baker.graphics.fillStyle(0xc3cabc).fillCircle(p.x,p.y,2);}
  }
  a.box({u0:2.55,u1:2.8,v0:1.35,v1:1.8,z0:4,z1:36},STEEL);
  a.face(0x95c77e,[[2.55,1.805,20],[2.8,1.805,20],[2.8,1.805,31],[2.55,1.805,31]]);
  for(const u of [-3,3]){a.lamp(u,3);a.planter(u,.8,.23);}
}

function solar(a: Studio) {
  a.grounds();
  a.solar(-2.6,-2.8,7,13,6);
  const battery={u0:-2.8,u1:.4,v0:1.5,v1:2.7,z0:4,z1:60};a.box(battery,STONE);a.cornice(battery,STEEL,.05,4);
  for(let u=-2.6;u<.35;u+=.47){a.line(0x627e78,[[u,2.705,9],[u,2.705,55]],1.5);a.face(0x438a74,[[u+.07,2.71,39],[u+.19,2.71,39],[u+.19,2.71,46],[u+.07,2.71,46]]);for(let z=12;z<=30;z+=5)a.line(0x8ea69d,[[u+.03,2.71,z],[u+.32,2.71,z]],1);}
  const office={u0:1.1,u1:2.7,v0:1.5,v1:2.7,z0:4,z1:54};a.box(office,GLASS);a.windows(office,1,3,2);a.cornice(office);
  for(let u=-2.8;u<.4;u+=.36)a.box({u0:u,u1:u+.04,v0:1.43,v1:1.49,z0:10,z1:13},STEEL);
  a.lamp(-3,3);a.lamp(3,3);
}

function waterworks(a: Studio) {
  a.grounds();
  for(const [u,v] of [[-1.4,-1.5],[1.3,-1.5]]) {
    a.cylinder(u,v,1.08,4,37,0x98b8ad,0x79b5bb);
    const rim=Array.from({length:40},(_,i):Point3=>[u+Math.cos(i/40*Math.PI*2)*1.04,v+Math.sin(i/40*Math.PI*2)*1.04,38]);
    strokeFace(a.baker,0xe0e5d0,1,3,rim,a.x,a.y);
    a.line(0xe0e5d0,[[u-1.1,v,40],[u+1.1,v,40]],3);
    a.cylinder(u,v,.09,39,48,0xa9b9b0,0xedebd9);
    for(let i=0;i<20;i++){const angle=i/20*Math.PI*2;a.line(0x64877b,[[u+Math.cos(angle)*1.1,v+Math.sin(angle)*1.1,38],[u+Math.cos(angle)*1.1,v+Math.sin(angle)*1.1,46]],.9);}
  }
  const plant={u0:-2.5,u1:1.2,v0:.4,v1:2.2,z0:4,z1:70};a.box(plant,STONE);a.windows(plant,2,8,4);a.cornice(plant);a.solar(-2.2,.7,2,8,72);
  a.box({u0:1.8,u1:2.5,v0:.4,v1:2.2,z0:4,z1:35},STEEL);
  for(const u of [-1.4,1.3])a.line(0x709aa1,[[u,-.45,23],[u,.1,23],[2.15,.1,23],[2.15,.4,23]],5);
  for(const u of [-3,3]){a.planter(u,2.8,.3);a.lamp(u,3.1);}
}

export function bakeNorthernArchitecture(scene: Scene): void {
  const builders: Record<NorthernBuilding, (atelier: Studio) => void> = { research,library,conservatory,apartments,tower,innovation,depot,solar,waterworks };
  const baker=createBaker(scene);
  for(const kind of Object.keys(builders) as NorthernBuilding[]) {
    const key=northernTextureKey(kind);if(scene.textures.exists(key))continue;
    builders[kind](new Studio(baker));baker.finish(key,NORTHERN_ARCHITECTURE.width,NORTHERN_ARCHITECTURE.height);
  }
  baker.destroy();
}
