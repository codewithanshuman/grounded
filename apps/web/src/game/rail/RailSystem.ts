import Phaser from "phaser";
import { createBaker, fillFace, type Baker, type Point3 } from "../../reference-city/textures/core";
import { drawCapitolBox, type Box } from "../../reference-city/textures/capitol/primitives";
import { projection, GROUND_DEPTH } from "../../reference-city/world/core/worldConstants";
import { TERRAIN_ATLAS_KEY, terrainTextureKey } from "../../reference-city/textures/terrain";
import { propTextureKey } from "../../reference-city/textures/props";
import { prefersReducedMotion } from "../../reference-city/systems/ambient";
import { RAIL, RAIL_STATIONS, RAIL_CYCLE_MS, RailClock, carY, railPose, researchDistance, type RailPose } from "./railModel";

const VEHICLE_W = 160, VEHICLE_H = 110, ANCHOR = 32;
const colors = { top: 0xe9e9db, frontLeft: 0xbbc9bc, frontRight: 0x8fa6a1 };
export interface RailStatus { paused: boolean; speed: number; trains: RailPose[]; }

function bakeTrains(scene: Phaser.Scene) {
  if (scene.textures.exists("grounded:rail:car:0:1")) return;
  const b = createBaker(scene);
  for (const train of [0,1]) for (const direction of [-1,1]) {
    const ox = VEHICLE_W / 2, oy = VEHICLE_H - ANCHOR;
    const box = (bounds: Box, palette = colors) => drawCapitolBox(b, bounds, ox, oy, palette);
    box({u0:-.25,u1:.25,v0:-.47,v1:.47,z0:4,z1:23});
    box({u0:-.24,u1:.24,v0:-.45,v1:.45,z0:23,z1:27},{top:0xf5f3e6,frontLeft:0xd8e0d5,frontRight:0xb4c8c1});
    // Roof HVAC, pantograph, glazing, door leaves, lower sill and four bogies.
    box({u0:-.13,u1:.13,v0:-.22,v1:.05,z0:27,z1:30},{top:0xb4c3bf,frontLeft:0x7f9595,frontRight:0x668487});
    const face = (c:number, points:Point3[]) => fillFace(b,c,1,points,ox,oy);
    const paint = train === 0 ? 0x378c6e : 0xd49c4f;
    // Only the +u and +v elevations face the fixed isometric camera. Painting
    // the far side after the body would show windows through its solid roof.
    for (const u of [.255]) {
      face(paint,[[u,-.47,9],[u,.47,9],[u,.47,13],[u,-.47,13]]);
      for (let window=0;window<5;window++) {
        const v=-.4+window*.17;
        face(0x274b59,[[u,v,15],[u,v+.13,15],[u,v+.13,23],[u,v,23]]);
        face(0x8dbac2,[[u,v,21],[u,v+.13,21],[u,v+.13,23],[u,v,23]]);
      }
      for (const v of [-.3,.3]) {
        const p=b.at([u,v,4],ox,oy);
        b.graphics.fillStyle(0x233740).fillEllipse(p.x,p.y,8,6);
        b.graphics.fillStyle(0x92a3a2).fillCircle(p.x,p.y,1.5);
      }
      const door=.07;
      face(0xe0e9df,[[u,door,6],[u,door+.16,6],[u,door+.16,23],[u,door,23]]);
      b.graphics.lineStyle(.8,0x698c84).strokePoints([b.at([u,door+.08,6],ox,oy),b.at([u,door+.08,23],ox,oy)],false);
    }
    const front=.48;
    face(0x233f51,[[-.2,front,14],[.2,front,14],[.2,front,23],[-.2,front,23]]);
    for (const u of [-.16,.16]) { const p=b.at([u,front,10],ox,oy); b.graphics.fillStyle(direction === 1 ? 0xffedb7 : 0xe96f55).fillCircle(p.x,p.y,1.8); }
    const pantograph:Point3[]=[[0,.1,30],[0,.22,39],[0,.34,30]];
    b.graphics.lineStyle(1.6,0x476462).strokePoints(pantograph.map(p=>b.at(p,ox,oy)),false);
    b.graphics.lineStyle(2,0x476462).strokePoints([b.at([-.14,.22,39],ox,oy),b.at([.14,.22,39],ox,oy)],false);
    b.finish(`grounded:rail:car:${train}:${direction}`,VEHICLE_W,VEHICLE_H);
  }
  b.destroy();
}

export class RailSystem {
  readonly clock = new RailClock();
  private objects: Phaser.GameObjects.GameObject[] = [];
  private trains: Phaser.GameObjects.Image[][] = [];
  private statusHandler?: (status: RailStatus) => void;
  private lastStatusAt = -1000;
  private alive = true;
  constructor(private scene: Phaser.Scene, inspect: (title:string,evidence:string)=>void) {
    this.clock.paused = prefersReducedMotion();
    bakeTrains(scene);
    this.drawResearchDistrict();
    this.drawViaduct();
    this.drawStations(inspect);
    for (let train=0; train<2; train++) {
      const cars:Phaser.GameObjects.Image[]=[];
      for(let car=0;car<3;car++) {
        const sprite=scene.add.image(0,0,`grounded:rail:car:${train}:1`).setOrigin(.5,1);
        sprite.setInteractive({useHandCursor:true}).on("pointerup",()=>{
          const pose=railPose(this.clock.elapsedMs,train*RAIL_CYCLE_MS/2);
          inspect(`Rail service ${train+1}`,`${pose.phase === "DWELL" ? `Boarding at ${pose.station}` : `Traveling to ${pose.nextStation}`}. Three linked cars follow a deterministic four-station timetable on separate tracks. Illustrative transit simulation; not measured passenger or energy telemetry.`);
        });
        cars.push(sprite); this.objects.push(sprite);
      }
      this.trains.push(cars);
    }
    this.update(0,0);
    scene.events.on(Phaser.Scenes.Events.UPDATE,this.update,this);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN,this.destroy,this);
  }
  setStatusHandler(handler?: (status: RailStatus)=>void) { this.statusHandler=handler; this.publish(); }
  setPaused(paused:boolean) { this.clock.paused=paused; this.publish(); }
  setSpeed(speed:number) { this.clock.setSpeed(speed); this.publish(); }
  private publish() { this.statusHandler?.({ paused:this.clock.paused,speed:this.clock.speed,trains:[railPose(this.clock.elapsedMs),railPose(this.clock.elapsedMs,RAIL_CYCLE_MS/2)] }); }
  private update(_time:number, delta:number) {
    this.clock.advance(delta);
    for(let train=0;train<2;train++) {
      const pose=railPose(this.clock.elapsedMs,train*RAIL_CYCLE_MS/2);
      const x=RAIL.x+(train===0?-RAIL.laneOffset:RAIL.laneOffset);
      this.trains[train]?.forEach((sprite,car)=>{
        const y=carY(pose,car), p=projection.project(x,y,RAIL.elevation);
        sprite.setPosition(p.x,p.y+ANCHOR).setTexture(`grounded:rail:car:${train}:${pose.direction}`).setDepth(projection.depth(x,y)+110);
      });
    }
    if(this.clock.elapsedMs-this.lastStatusAt>=500){this.lastStatusAt=this.clock.elapsedMs;this.publish();}
  }
  private drawResearchDistrict() {
    const s=this.scene;
    for(let x=-16;x<=14;x++) for(let y=-39;y<=-19;y++) {
      const d=researchDistance(x,y); if(d>1.13)continue;
      const p=projection.project(x,y);
      const plaza=Math.abs(y+28)<.8;
      const kind=d>1?'water':d>.80?'sand':plaza?'plaza':'park';
      this.objects.push(s.add.image(p.x,p.y+24,TERRAIN_ATLAS_KEY,terrainTextureKey(kind,kind==='plaza'?0:Math.abs(x*7+y)%2)).setOrigin(.5,1).setDepth(GROUND_DEPTH+5));
      if(d<.73&&x%3===0&&y%3===0&&Math.abs(x-RAIL.x)>3&&!plaza&&!(x>0&&x<10&&y>-33&&y<-24)){
        this.objects.push(s.add.image(p.x,p.y+24,propTextureKey((x+y)%2?'pine':'tree')).setOrigin(.5,1).setDepth(projection.depth(x,y)));
      }
    }
    // A masonry research campus using the archive's courthouse box primitives.
    const b=createBaker(s), ox=300, oy=300;
    const box=(bounds:Box,palette=colors)=>drawCapitolBox(b,bounds,ox,oy,palette);
    box({u0:-2.5,u1:2.5,v0:-1.7,v1:1.7,z0:0,z1:7});
    box({u0:-2,u1:2,v0:-1.25,v1:1.25,z0:7,z1:74});
    box({u0:-2.1,u1:2.1,v0:-1.35,v1:1.35,z0:74,z1:79});
    for(let floor=0;floor<3;floor++) for(let window=0;window<10;window++) {
      const u=-1.8+window*.38,z=15+floor*19;
      fillFace(b,0x386473,1,[[u,1.255,z],[u+.23,1.255,z],[u+.23,1.255,z+11],[u,1.255,z+11]],ox,oy);
    }
    for(const u of [-1.6,-.8,0,.8,1.6])box({u0:u-.055,u1:u+.055,v0:1.3,v1:1.45,z0:7,z1:50});
    box({u0:-2.2,u1:2.2,v0:1.15,v1:1.7,z0:50,z1:54});
    for(let i=0;i<4;i++)box({u0:-1.1,u1:1.1,v0:1.5+i*.15,v1:1.7+i*.15,z0:0,z1:7-i*1.5});
    for(let row=0;row<3;row++) for(let col=0;col<5;col++)box({u0:-1.6+col*.65,u1:-1.1+col*.65,v0:-.95+row*.65,v1:-.52+row*.65,z0:80,z1:84},{top:0x346d87,frontLeft:0x1d495e,frontRight:0x457d90});
    // The front foundation reaches y=401 in texture space. Keep the complete
    // stairs and plinth inside the bake, then preserve the ground origin at 300.
    b.finish('grounded:rail:research',600,420);b.destroy();
    const p=projection.project(6,-29);
    this.objects.push(s.add.image(p.x,p.y+120,'grounded:rail:research').setOrigin(.5,1).setDepth(projection.depth(8,-27)));
    this.objects.push(s.add.text(p.x,p.y-106,'RESEARCH PARK',{fontFamily:'IBM Plex Mono',fontSize:'12px',color:'#365b47',backgroundColor:'#f5f4dfe8',padding:{x:12,y:7}}).setOrigin(.5,1).setDepth(projection.depth(8,-27)+10));
  }
  private drawViaduct() {
    const s=this.scene;
    const g=s.add.graphics().setDepth(-700_000);this.objects.push(g);
    const at=(x:number,y:number,z=0)=>{const p=projection.project(x,y,z);return new Phaser.Geom.Point(p.x,p.y);};
    const face=(c:number,points:number[][])=>{g.fillStyle(c).fillPoints(points.map(p=>at(p[0],p[1],p[2])),true);};
    const line=(c:number,w:number,points:number[][])=>{g.lineStyle(w,c).strokePoints(points.map(p=>at(p[0],p[1],p[2])),false);};
    for(let y=RAIL.trackStart;y<RAIL.trackEnd;y+=.5) {
      const x=RAIL.x,z=RAIL.elevation;
      face(0x809892,[[x+.95,y,z-8],[x+.95,y+.5,z-8],[x+.95,y+.5,z],[x+.95,y,z]]);
      face(0xc2cbb9,[[x-.95,y,z],[x+.95,y,z],[x+.95,y+.5,z],[x-.95,y+.5,z]]);
      for(const lane of [-RAIL.laneOffset,RAIL.laneOffset]) {
        line(0x777e72,3,[[x+lane-.22,y,z+1],[x+lane+.22,y,z+1]]);
        for(const offset of [-.16,.16])line(0x415c60,2,[[x+lane+offset,y,z+2],[x+lane+offset,y+.5,z+2]]);
      }
      for(const side of [-1,1])line(0x587a6a,1.8,[[x+side*.9,y,z+12],[x+side*.9,y+.5,z+12]]);
      if(Number.isInteger(y))for(const side of [-1,1])line(0x799584,1.1,[[x+side*.9,y,z],[x+side*.9,y,z+12]]);
      if(y%3===.5||y%3===-2.5) {
        for(const side of [-1,1]){
          face(0x819b98,[[x+side*.55-.13,y-.13,0],[x+side*.55+.13,y-.13,0],[x+side*.55+.13,y-.13,z-6],[x+side*.55-.13,y-.13,z-6]]);
          face(0xa9b9ad,[[x+side*.55+.13,y-.13,0],[x+side*.55+.13,y+.13,0],[x+side*.55+.13,y+.13,z-6],[x+side*.55+.13,y-.13,z-6]]);
        }
      }
    }
    for(let y=-29;y<=32;y+=4) {
      const x=RAIL.x,z=RAIL.elevation;
      line(0x587b70,2,[[x-.88,y,z],[x-.88,y,z+47],[x+.88,y,z+47],[x+.88,y,z]]);
      if(y<28)for(const lane of [-RAIL.laneOffset,RAIL.laneOffset])line(0x6b897e,.8,[[x+lane,y,z+42],[x+lane,y+4,z+42]]);
    }
  }
  private drawStations(inspect:(title:string,evidence:string)=>void) {
    for(const station of RAIL_STATIONS) {
      const z=RAIL.elevation;
      const describe=()=>inspect(station.name,`Operating stop on the four-station coastal railway. Both tracks have a side platform, joined by a raised pedestrian overpass above the overhead wires. Services dwell for five simulated seconds. Illustrative transit, not a surveyed Jaipur railway or measured ridership.`);
      for(const side of [-1,1]) {
        const b=createBaker(this.scene),ox=250,oy=260;
        const box=(bounds:Box,palette=colors)=>drawCapitolBox(b,bounds,ox,oy,palette);
        // Piers flank the promenade, leaving the existing reserve approach open.
        for(const v of [-1.6,1.6])for(const u of [-.5,.5])box({u0:u-.09,u1:u+.09,v0:v-.09,v1:v+.09,z0:0,z1:z-7});
        box({u0:-.75,u1:.75,v0:-1.9,v1:1.9,z0:z-7,z1:z});
        const trackEdge=side===1?-.71:.64;
        box({u0:trackEdge,u1:trackEdge+.07,v0:-1.8,v1:1.8,z0:z,z1:z+1},{top:0xf0d98d,frontLeft:0xd0b776,frontRight:0xb79759});
        // A short north-end shelter leaves the overpass stairs unobstructed.
        for(const v of [-1.75,-1.0])for(const u of [-.58,.58])box({u0:u-.04,u1:u+.04,v0:v-.05,v1:v+.05,z0:z,z1:z+38});
        box({u0:-.9,u1:.9,v0:-2,v1:-.86,z0:z+37,z1:z+42},{top:0x487f6b,frontLeft:0x2e6458,frontRight:0x204e4c});
        box({u0:.46,u1:.65,v0:-1.7,v1:-1.05,z0:z+2,z1:z+10},{top:0xbfa274,frontLeft:0x8d784f,frontRight:0x6c644d});
        // East stairs descend toward the city. West stairs descend northward,
        // not west into the reserve bridge or south into the airport terminal.
        for(let step=0;step<16;step++) {
          const bounds=side===1
            ? {u0:.7+step*.085,u1:.8+step*.085,v0:-.4,v1:.4,z0:0,z1:z-step*4}
            : {u0:-.36,u1:.36,v0:-2-step*.115,v1:-1.9-step*.115,z0:0,z1:z-step*4};
          box(bounds);
        }
        const key=`grounded:rail:station:${station.id}:${side}`;b.finish(key,500,350);b.destroy();
        const x=RAIL.x+side*1.65,p=projection.project(x,station.y);
        const platform=this.scene.add.image(p.x,p.y+90,key).setOrigin(.5,1).setDepth(projection.depth(x+.75,station.y+1.9)+120).setInteractive({useHandCursor:true});
        platform.on('pointerup',describe);this.objects.push(platform);
      }

      const b=createBaker(this.scene),ox=320,oy=280;
      const box=(bounds:Box,palette=colors)=>drawCapitolBox(b,bounds,ox,oy,palette);
      const footbridgeZ=z+72;
      // Deck underside is 128px; wire gantries top out at 111px. Stair runs
      // stay entirely on the side platforms and never cross either track.
      for(const u of [-1.92,1.92])for(const v of [1.15,1.65])box({u0:u-.055,u1:u+.055,v0:v-.055,v1:v+.055,z0:z,z1:footbridgeZ-8});
      for(const side of [-1,1]) {
        const center=side*1.65;
        for(let step=0;step<18;step++)box({u0:center-.32,u1:center+.32,v0:-1.5+step*.15,v1:-1.35+step*.15,z0:z,z1:z+4+step*4});
        for(const offset of [-.34,.34]) {
          const u=center+offset;
          b.graphics.lineStyle(1.8,0x668174).strokePoints([b.at([u,-1.5,z+15],ox,oy),b.at([u,1.2,footbridgeZ+12],ox,oy)],false);
          for(let step=0;step<=6;step++) {
            const v=-1.5+step*.45,h=Math.min(footbridgeZ,z+4+step*12);
            b.graphics.lineStyle(1.3,0x789087).strokePoints([b.at([u,v,h],ox,oy),b.at([u,v,h+11],ox,oy)],false);
          }
        }
      }
      box({u0:-2.05,u1:2.05,v0:1.05,v1:1.75,z0:footbridgeZ-8,z1:footbridgeZ});
      for(const v of [1.05,1.75]) {
        // Open the north balustrade at each stair landing instead of putting
        // a continuous railing across the walking route.
        const from=v===1.05?-1.3:-2.05,to=v===1.05?1.3:2.05;
        b.graphics.lineStyle(2,0x4f7565).strokePoints([b.at([from,v,footbridgeZ+12],ox,oy),b.at([to,v,footbridgeZ+12],ox,oy)],false);
        for(let u=from;u<=to;u+=.41)b.graphics.lineStyle(1.2,0x789087).strokePoints([b.at([u,v,footbridgeZ],ox,oy),b.at([u,v,footbridgeZ+12],ox,oy)],false);
      }
      for(const u of [-2.05,2.05])b.graphics.lineStyle(2,0x4f7565).strokePoints([b.at([u,1.05,footbridgeZ+12],ox,oy),b.at([u,1.75,footbridgeZ+12],ox,oy)],false);
      const bridgeKey=`grounded:rail:station:${station.id}:overpass`;b.finish(bridgeKey,640,360);b.destroy();
      const p=projection.project(RAIL.x,station.y),depth=projection.depth(RAIL.x+2.4,station.y+1.9)+140;
      const overpass=this.scene.add.image(p.x,p.y+80,bridgeKey).setOrigin(.5,1).setDepth(depth).setInteractive({useHandCursor:true});
      overpass.on('pointerup',describe);
      const label=this.scene.add.text(p.x,p.y-footbridgeZ-70,station.name.toUpperCase(),{fontFamily:'IBM Plex Mono',fontSize:'10px',color:'#e8eedc',backgroundColor:'#234d43e8',padding:{x:9,y:5}}).setOrigin(.5,1).setDepth(depth+2);
      this.objects.push(overpass,label);
    }
  }
  destroy() {
    if(!this.alive)return;this.alive=false;
    this.scene.events.off(Phaser.Scenes.Events.UPDATE,this.update,this);
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN,this.destroy,this);
    this.objects.forEach(object=>object.destroy());this.objects=[];this.trains=[];this.statusHandler=undefined;
  }
}
