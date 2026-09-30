import Phaser from "phaser";
import { projection } from "../../reference-city/world/core/worldConstants";
import { prefersReducedMotion } from "../../reference-city/systems/ambient";
import { NORTH_CITY_BRIDGE, northBridgeHeight } from "./northBridgeModel";

/** A raised two-lane bridge with land ramps, clear navigation span and a city-road approach. */
export function addNorthCityBridge(scene: Phaser.Scene): Phaser.GameObjects.GameObject[] {
  const { gx, startY, endY, roadEndY, halfWidth, pierYs } = NORTH_CITY_BRIDGE;
  const objects: Phaser.GameObjects.GameObject[] = [];
  const g = scene.add.graphics().setDepth(-700_000);
  objects.push(g);
  type Vertex = readonly [number, number, number];
  const p = (v: Vertex) => {
    const point = projection.project(...v);
    return new Phaser.Geom.Point(point.x, point.y);
  };
  const face = (color: number, vertices: Vertex[], alpha = 1) => {
    g.fillStyle(color, alpha).fillPoints(vertices.map(p), true);
  };
  const line = (color: number, width: number, vertices: Vertex[], alpha = 1) => {
    g.lineStyle(width, color, alpha).strokePoints(vertices.map(p), false);
  };
  const column = (x: number, y: number, height: number) => {
    const w = .18;
    face(0x829998, [[x-w,y-w,0],[x+w,y-w,0],[x+w,y-w,height],[x-w,y-w,height]]);
    face(0xaebfba, [[x+w,y-w,0],[x+w,y+w,0],[x+w,y+w,height],[x+w,y-w,height]]);
    face(0xd7dfd3, [[x-w,y-w,height],[x+w,y-w,height],[x+w,y+w,height],[x-w,y+w,height]]);
  };

  // Two paired foundations sit outside the archive's y=-16..-11 navigation lane.
  for (const y of pierYs) {
    const shadow = p([gx,y,0]);
    g.fillStyle(0x165478,.24).fillEllipse(shadow.x+15,shadow.y+17,150,25);
    for (const side of [-1,1]) column(gx+side*.82,y,northBridgeHeight(y)-9);
    line(0xc2cebf,13,[[gx-halfWidth,y,95],[gx+halfWidth,y,95]]);
  }

  for (let y=startY; y<endY; y+=.25) {
    const next=Math.min(y+.25,endY), a=northBridgeHeight(y), b=northBridgeHeight(next);
    face(0x6f8280,[[gx-halfWidth,y,a-8],[gx-halfWidth,next,b-8],[gx-halfWidth,next,b],[gx-halfWidth,y,a]]);
    face(0x99aaa1,[[gx+halfWidth,y,a-8],[gx+halfWidth,next,b-8],[gx+halfWidth,next,b],[gx+halfWidth,y,a]]);
    face(0x646f72,[[gx-halfWidth,y,a],[gx-halfWidth,next,b],[gx+halfWidth,next,b],[gx+halfWidth,y,a]]);
    // Sidewalks and white edge markings continue through both approach ramps.
    for(const side of [-1,1]) {
      const outer=gx+side*halfWidth, inner=gx+side*.84;
      face(0xd5d8ca,[[outer,y,a+.8],[outer,next,b+.8],[inner,next,b+.8],[inner,y,a+.8]]);
      line(0xf4efda,1.8,[[inner,y,a+1],[inner,next,b+1]]);
      line(0x48625e,2,[[outer,y,a+16],[outer,next,b+16]]);
      line(0x8ba99f,1,[[outer,y,a+7],[outer,next,b+7]]);
      if(Number.isInteger(y)) line(0x48625e,2,[[outer,y,a+1],[outer,y,a+16]]);
    }
    if(Math.round(y*4)%8<4) line(0xe9d89d,2,[[gx,y,a+1.2],[gx,next,b+1.2]]);
  }

  // Cable-stayed towers and fan cables are drawn on the bridge, not through water traffic.
  for(const y of pierYs) for(const side of [-1,1]) {
    const x=gx+side*1.05, base=northBridgeHeight(y);
    column(x,y,base+132);
    line(0xdfe5d7,5,[[x,y,base+132],[gx-side*1.05,y,base+132]]);
    for(const offset of [-4,-3,-2,2,3,4]) {
      const end=Math.max(startY+1,Math.min(endY-1,y+offset));
      line(0xe6e8d9,1.4,[[x,y,base+123],[x,end,northBridgeHeight(end)+5]],.94);
    }
    const lamp=p([x,y,base+137]);
    g.fillStyle(0xffeec9,.17).fillCircle(lamp.x,lamp.y,8);
    g.fillStyle(0xffefd4).fillRect(lamp.x-2,lamp.y-2,4,4);
  }
  // Ground approach reaches the existing x=30 city road; no coast tiles are removed.
  face(0x727b78,[[gx-halfWidth,endY,0],[gx-halfWidth,roadEndY,0],[gx+halfWidth,roadEndY,0],[gx+halfWidth,endY,0]]);
  for(const side of [-1,1]) line(0xe4dfc8,3,[[gx+side*.84,endY,1],[gx+side*.84,roadEndY,1]]);
  for(let y=endY;y<roadEndY;y+=2) line(0xe4d5a4,2,[[gx,y,1],[gx,y+.8,1]]);
  for(const y of [-29,-26,-21,-18,-15,-12,-7]) for(const side of [-1,1]) {
    const x=gx+side*halfWidth, z=northBridgeHeight(y);
    line(0x435e58,2,[[x,y,z],[x,y,z+28]]);
    const lamp=p([x,y,z+29]);
    g.fillStyle(0xfff0c8).fillRect(lamp.x-3,lamp.y-2,6,3);
  }

  // One small shuttle uses the same road/deck elevation (not an independent transport forecast).
  if(!prefersReducedMotion()) {
    const vehicle=scene.add.graphics().setDepth(-699_990);
    vehicle.fillStyle(0x2a514c).fillRoundedRect(-14,-10,28,11,2);
    vehicle.fillStyle(0xe3eee1).fillRoundedRect(-15,-18,30,12,3);
    vehicle.fillStyle(0x548a98).fillRect(-10,-16,20,5);
    vehicle.fillStyle(0x202f32).fillCircle(-9,0,3).fillCircle(9,0,3);
    const movement={y:startY+1};
    const update=()=>{
      const point=projection.project(gx-.4,movement.y,northBridgeHeight(movement.y));
      vehicle.setPosition(point.x,point.y-2);
    };
    update();
    scene.tweens.add({targets:movement,y:roadEndY-1,duration:28_000,yoyo:true,repeat:-1,ease:"Linear",onUpdate:update});
    objects.push(vehicle);
  }
  return objects;
}
