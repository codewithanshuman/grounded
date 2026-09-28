import Phaser from 'phaser';
import { createBaker, fillFace, type Baker, type Point3 } from '../../reference-city/textures/core';
import { drawCapitolBox, type Box } from '../../reference-city/textures/capitol/primitives';
import { projection } from '../../reference-city/world/core/worldConstants';

/** All geometry uses the supplied city archive's 96 × 48 isometric projection. */
const TURBINE_KEY = 'grounded:energy:turbine';
const ROTOR_KEY = 'grounded:energy:rotor';
const PYLON_KEY = 'grounded:energy:pylon';
const TURBINE = { width: 240, height: 350, anchorY: 48, hubX: 27.84, hubY: -238.08 };
const PYLON = { width: 300, height: 330, anchorY: 70 };
const STEEL = { top: 0xe0e9e9, frontLeft: 0x9dadae, frontRight: 0x6c858a };
const CONCRETE = { top: 0xd5d7ca, frontLeft: 0xb8bcae, frontRight: 0x959f97 };

export interface EnergyInstallation {
  objects: Phaser.GameObjects.GameObject[];
  destroy(): void;
}

export interface TurbineOptions {
  scale?: number;
  /** Rotor's initial angle, in degrees. */
  phase?: number;
  reducedMotion?: boolean;
}

function line(b: Baker, x: number, y: number, points: readonly Point3[], color = 0x61797f, width = 1.5, alpha = 1): void {
  b.graphics.lineStyle(width, color, alpha);
  b.graphics.strokePoints(points.map(p => b.at(p, x, y)), false);
}

function box(b: Baker, x: number, y: number, bounds: Box, colors = STEEL): void {
  drawCapitolBox(b, bounds, x, y, colors);
}

function bakeTurbine(b: Baker): void {
  const x = TURBINE.width / 2;
  const y = TURBINE.height - TURBINE.anchorY;
  const g = b.graphics;
  fillFace(b, 0x142c2e, .16, [[-.45,-.45,0],[.5,-.45,0],[1.15,.8,0],[.2,1.2,0]], x, y);
  box(b, x, y, {u0:-.65,u1:.65,v0:-.65,v1:.65,z0:0,z1:5}, CONCRETE);
  box(b, x, y, {u0:-.38,u1:.38,v0:-.38,v1:.38,z0:5,z1:11}, CONCRETE);
  // Anchor studs and a service hatch make the footing read as engineered.
  for (const u of [-.3,.3]) for (const v of [-.3,.3]) {
    const p = b.at([u,v,12],x,y);
    g.fillStyle(0x778782).fillCircle(p.x,p.y,2);
    g.fillStyle(0xeaf0e5).fillCircle(p.x-.5,p.y-.5,.7);
  }
  // A tapered 24-sided mast: alternating highlights follow its round surface.
  for (let i=0;i<24;i++) {
    const a=i*Math.PI/12;
    const c=(i+1)*Math.PI/12;
    const light=.68+.30*Math.max(0,Math.cos(a+.6));
    const color=Phaser.Display.Color.GetColor(Math.round(235*light),Math.round(244*light),Math.round(237*light));
    fillFace(b,color,1,[[Math.cos(a)*.23,Math.sin(a)*.23,11],[Math.cos(c)*.23,Math.sin(c)*.23,11],[Math.cos(c)*.075,Math.sin(c)*.075,246],[Math.cos(a)*.075,Math.sin(a)*.075,246]],x,y);
  }
  // Tower access door, hinges and a short staircase.
  fillFace(b,0x4e666b,1,[[-.095,.21,12],[.095,.21,12],[.08,.18,36],[-.08,.18,36]],x,y);
  line(b,x,y,[[-.08,.213,14],[-.073,.188,34],[.073,.188,34]],0xe1e9dc,.8);
  for(let i=0;i<3;i++) box(b,x,y,{u0:-.17,u1:.17,v0:.28+i*.1,v1:.4+i*.1,z0:4,z1:11-i*2},CONCRETE);
  for(const z of [94,170]) {
    const p=b.at([0,0,z],x,y);
    g.lineStyle(.7,0x91a5a0,.6).lineBetween(p.x-7,p.y,p.x+7,p.y+1);
  }
  // Yaw collar and nacelle. The rotor hub is positioned on its forward face.
  box(b,x,y,{u0:-.16,u1:.16,v0:-.15,v1:.15,z0:239,z1:246});
  box(b,x,y,{u0:-.65,u1:.58,v0:-.22,v1:.22,z0:245,z1:264},{top:0xf4f7ef,frontLeft:0xd9e5df,frontRight:0xa8bbb9});
  fillFace(b,0xf9fbf1,1,[[-.78,-.16,248],[-.65,-.22,245],[-.65,-.22,264],[-.78,-.16,258]],x,y);
  fillFace(b,0xc1d2c9,1,[[-.78,-.16,248],[-.78,.16,248],[-.65,.22,245],[-.65,-.22,245]],x,y);
  fillFace(b,0xdbe8dc,1,[[-.78,.16,248],[-.65,.22,245],[-.65,.22,264],[-.78,.16,258]],x,y);
  fillFace(b,0x518368,1,[[-.55,.224,252],[.42,.224,252],[.42,.224,256],[-.55,.224,256]],x,y);
  for(let i=0;i<5;i++) line(b,x,y,[[-.52+i*.085,.23,258],[-.49+i*.085,.23,262]],0x63817c,1);
  line(b,x,y,[[-.33,-.12,264],[-.33,-.12,277]],0x596e74,1.3);
  line(b,x,y,[[-.43,-.12,273],[-.22,-.12,273]],0x657f80,1.1);
  const light=b.at([-.34,-.12,278],x,y);
  g.fillStyle(0xef8d70).fillCircle(light.x,light.y,1.8);
  b.finish(TURBINE_KEY,TURBINE.width,TURBINE.height);

  // Separate balanced three-blade rotor: a tapered, swept airfoil, not a cross.
  const center=120;
  const bladePoints=[[6,-4],[17,-9],[35,-9.5],[64,-6],[97,-1.5],[106,1],[101,3],[64,3.5],[33,4],[14,5]];
  for(let blade=0;blade<3;blade++) {
    const angle=blade*2*Math.PI/3;
    const project=(p:number[])=>new Phaser.Math.Vector2(center+p[0]*Math.cos(angle)-p[1]*Math.sin(angle),center+p[0]*Math.sin(angle)+p[1]*Math.cos(angle));
    g.fillStyle(0x718d8d,.25).fillPoints(bladePoints.map(p=>project([p[0]+1,p[1]+2])),true);
    g.fillStyle(0xe9f2e8).fillPoints(bladePoints.map(project),true);
    g.lineStyle(1,0xffffff,.8).strokePoints([[13,-5],[37,-6],[66,-3],[100,1]].map(project),false);
    g.lineStyle(1,0x96b7af,.8).strokePoints([[19,4],[60,3],[97,2]].map(project),false);
    g.lineStyle(1.5,0x65a38a).strokePoints([[91,-2],[92,2.5]].map(project),false);
    g.lineStyle(1,0x8bb6a2).strokePoints([[96,-.8],[97,2.2]].map(project),false);
  }
  g.fillStyle(0x79948e).fillCircle(center+1,center+1,10);
  g.fillStyle(0xe7f1e5).fillCircle(center,center,9);
  g.fillStyle(0xffffff).fillCircle(center-2,center-2,5.5);
  b.finish(ROTOR_KEY,240,240);
}

/** Attachment locations must match the insulators used by the line renderer. */
const CABLE_ANCHORS: readonly Point3[] = [[-1.18,0,168],[1.18,0,168],[-.91,0,200],[.91,0,200]];

function bakePylon(b:Baker):void {
  const x=PYLON.width/2;
  const y=PYLON.height-PYLON.anchorY;
  fillFace(b,0x193332,.14,[[-.65,-.65,0],[.65,-.65,0],[1.1,.9,0],[-.4,.9,0]],x,y);
  for(const u of [-.49,.49]) for(const v of [-.49,.49]) {
    box(b,x,y,{u0:u-.13,u1:u+.13,v0:v-.13,v1:v+.13,z0:0,z1:6},CONCRETE);
    box(b,x,y,{u0:u-.075,u1:u+.075,v0:v-.075,v1:v+.075,z0:6,z1:9},STEEL);
  }
  const levels=[{z:7,r:.49},{z:42,r:.39},{z:78,r:.29},{z:112,r:.20},{z:143,r:.14},{z:179,r:.15},{z:211,r:.10},{z:243,r:.025}];
  // Four faces, full diagonal cross-bracing and horizontal platforms.
  for(let face=0;face<4;face++) {
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]];
    const a=corners[face]; const c=corners[(face+1)%4];
    const front=face===1||face===2;
    for(let i=0;i<levels.length-1;i++) {
      const lo=levels[i];const hi=levels[i+1];
      const p:Point3=[a[0]*lo.r,a[1]*lo.r,lo.z];
      const q:Point3=[c[0]*lo.r,c[1]*lo.r,lo.z];
      const r:Point3=[a[0]*hi.r,a[1]*hi.r,hi.z];
      const s:Point3=[c[0]*hi.r,c[1]*hi.r,hi.z];
      line(b,x,y,[p,r],front?0x718b92:0x9cafb0,front?2.4:1.5);
      line(b,x,y,[p,q],0x92a7a6,1.7);
      line(b,x,y,[p,s],front?0x657f86:0x9dafad,1.3);
      line(b,x,y,[q,r],front?0x718b92:0xadbdba,1.1);
      if(front){const bolt=b.at(p,x,y);b.graphics.fillStyle(0xe1e8dd).fillCircle(bolt.x,bolt.y,1.2);}
    }
  }
  // Two cantilevered crossarms with genuine triangular truss sections.
  for(const [z,span] of [[183,1.18],[215,.91]]) {
    for(const sign of [-1,1]) {
      line(b,x,y,[[0,0,z+9],[sign*span,0,z],[0,0,z-6]],0x668087,2.2);
      line(b,x,y,[[0,0,z],[sign*span,0,z]],0xb2c1b9,2);
      for(let i=1;i<=4;i++) {
        const u=sign*span*i/4;
        line(b,x,y,[[u-sign*span/4,0,z],[u,0,z+9*(1-i/4)],[u,0,z]],0x91a8a8,1.1);
      }
      // Glazed ceramic insulator stacks, six individual discs per conductor.
      line(b,x,y,[[sign*span,0,z],[sign*span,0,z-15]],0x566d71,1.5);
      for(let i=0;i<6;i++) {
        const p=b.at([sign*span,0,z-3-i*2],x,y);
        b.graphics.fillStyle(i%2===0?0x8bb3a5:0xd1e1c9).fillEllipse(p.x,p.y,7-i*.3,2.7);
      }
    }
  }
  const tip=b.at([0,0,243],x,y);
  b.graphics.fillStyle(0xf8ad76).fillCircle(tip.x,tip.y,1.5);
  b.finish(PYLON_KEY,PYLON.width,PYLON.height);
}

export function bakeEnergy(scene:Phaser.Scene):void {
  if(scene.textures.exists(TURBINE_KEY)&&scene.textures.exists(ROTOR_KEY)&&scene.textures.exists(PYLON_KEY))return;
  const baker=createBaker(scene);
  bakeTurbine(baker);
  bakePylon(baker);
  baker.destroy();
}

function ownedInstallation(scene:Phaser.Scene,objects:Phaser.GameObjects.GameObject[]):EnergyInstallation {
  let destroyed=false;
  const destroy=()=>{
    if(destroyed)return;
    destroyed=true;
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN,destroy);
    for(const object of objects){scene.tweens.killTweensOf(object);object.destroy();}
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN,destroy);
  return {objects,destroy};
}

export function addWindTurbine(scene:Phaser.Scene,gx:number,gy:number,options:TurbineOptions={}):EnergyInstallation {
  bakeEnergy(scene);
  const scale=options.scale??1;
  const p=projection.project(gx,gy);
  const depth=projection.depth(gx,gy);
  const tower=scene.add.image(p.x,p.y+TURBINE.anchorY*scale,TURBINE_KEY).setOrigin(.5,1).setScale(scale).setDepth(depth+30);
  const rotor=scene.add.image(p.x+TURBINE.hubX*scale,p.y+TURBINE.hubY*scale,ROTOR_KEY).setScale(scale).setAngle(options.phase??-90).setDepth(depth+31);
  const reduced=options.reducedMotion??(typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  if(!reduced)scene.tweens.add({targets:rotor,angle:rotor.angle+360,duration:10500,repeat:-1,ease:'Linear'});
  return ownedInstallation(scene,[tower,rotor]);
}

export function addPylonLine(scene:Phaser.Scene,points:readonly {gx:number;gy:number}[]):EnergyInstallation {
  bakeEnergy(scene);
  const objects:Phaser.GameObjects.GameObject[]=[];
  for(let i=0;i<points.length;i++) {
    const at=points[i];const p=projection.project(at.gx,at.gy);
    const tower=scene.add.image(p.x,p.y+PYLON.anchorY,PYLON_KEY).setOrigin(.5,1).setDepth(projection.depth(at.gx,at.gy)+30);
    objects.push(tower);
    if(i===0)continue;
    const before=points[i-1];
    const cables=scene.add.graphics().setDepth(Math.max(projection.depth(at.gx,at.gy),projection.depth(before.gx,before.gy))+29);
    for(const [du,dv,height] of CABLE_ANCHORS) {
      const a=projection.project(before.gx+du,before.gy+dv,height);
      const b=projection.project(at.gx+du,at.gy+dv,height);
      const span=Math.hypot(b.x-a.x,b.y-a.y);
      const sag=Math.min(46,Math.max(12,span*.09));
      const samples=Array.from({length:33},(_,j)=>{const t=j/32;return new Phaser.Math.Vector2(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t+4*sag*t*(1-t));});
      cables.lineStyle(1.35,0x354e55,.85).strokePoints(samples,false);
      cables.lineStyle(.45,0xa5b8b2,.7).strokePoints(samples.map(p=>new Phaser.Math.Vector2(p.x,p.y-.6)),false);
    }
    objects.push(cables);
  }
  return ownedInstallation(scene,objects);
}
