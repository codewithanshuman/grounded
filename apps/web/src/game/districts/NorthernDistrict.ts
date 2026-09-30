import Phaser from "phaser";
import { GROUND_DEPTH, projection } from "../../reference-city/world/core/worldConstants";
import { TILE_ANCHOR_Y } from "../../reference-city/textures/core";
import { propTextureKey } from "../../reference-city/textures/props";
import { prefersReducedMotion } from "../../reference-city/systems/ambient";
import { NORTHERN_SITES, NORTH_ROADS, insideNorthernMainland, northernShoreline, northernTileKind, northernTreeSites } from "./expansionLayout";
import { NORTHERN_ARCHITECTURE, bakeNorthernArchitecture, northernTextureKey } from "./northernArchitecture";

/** Authored streets and architecture extend the archive city without altering its land. */
export function addNorthernDistrict(scene: Phaser.Scene, inspect: (title: string, evidence: string) => void): Phaser.GameObjects.GameObject[] {
  bakeNorthernArchitecture(scene);
  const objects: Phaser.GameObjects.GameObject[] = [];
  // Far-north isometric depths can be less than the original -1M ground plane.
  // Keep this ground below every local prop instead of hiding northern groves.
  const terrain=scene.add.graphics().setDepth(GROUND_DEPTH-600_000);
  const roads=scene.add.graphics().setDepth(GROUND_DEPTH-599_990);
  objects.push(terrain,roads);
  const project=(x:number,y:number,z=0)=>{
    const p=projection.project(x,y,z);return new Phaser.Geom.Point(p.x,p.y);
  };
  const coast=(scale:number)=>northernShoreline(scale).map(point=>project(point.x,point.y));
  terrain.fillStyle(0x5ec5dd,.36).fillPoints(coast(1.017),true);
  terrain.lineStyle(5,0xd1eee0,.64).strokePoints(coast(1.006),true);
  terrain.fillStyle(0xd9cfa1).fillPoints(coast(1),true);
  terrain.fillStyle(0x94bd71).fillPoints(coast(.975),true);
  terrain.lineStyle(2,0xc5d68d,.7).strokePoints(coast(.974),true);
  const tile=(x:number,y:number,color:number,alpha=1)=>{
    roads.fillStyle(color,alpha).fillPoints([project(x-.5,y-.5),project(x+.5,y-.5),project(x+.5,y+.5),project(x-.5,y+.5)],true);
  };
  for(let x=-42;x<=78;x++)for(let y=-99;y<=-27;y++) {
    if(![[x-.5,y-.5],[x+.5,y-.5],[x+.5,y+.5],[x-.5,y+.5]].every(([a,b])=>insideNorthernMainland(a!,b!)))continue;
    const kind=northernTileKind(x,y);
    if(kind==="road")tile(x,y,0x88928a);
    else if(kind==="meadow" && Math.abs((x*127)^(y*53))%13===0)tile(x,y,0x82ab68,.22);
  }
  const stripe=(x1:number,y1:number,x2:number,y2:number,color:number,width:number)=>{
    roads.lineStyle(width,color,.85).strokePoints([project(x1,y1,1),project(x2,y2,1)],false);
  };
  for(const x of NORTH_ROADS.columns)for(let y=-97;y<-29;y+=2) {
    if(northernTileKind(x,y)==="road"&&northernTileKind(x,y+.8)==="road") {
      stripe(x,y,x,y+.8,0xe6debd,2);
      for(const side of [-1,1])if(insideNorthernMainland(x+side*1.02,y,.08)&&insideNorthernMainland(x+side*1.02,y+1.9,.08))stripe(x+side*1.02,y,x+side*1.02,y+1.9,0xc9d0b6,3);
    }
  }
  for(const y of NORTH_ROADS.rows)for(let x=-40;x<76;x+=2) {
    if(northernTileKind(x,y)==="road"&&northernTileKind(x+.8,y)==="road") {
      stripe(x,y,x+.8,y,0xe6debd,2);
      for(const side of [-1,1])if(insideNorthernMainland(x,y+side*1.02,.08)&&insideNorthernMainland(x+1.9,y+side*1.02,.08))stripe(x,y+side*1.02,x+1.9,y+side*1.02,0xc9d0b6,3);
    }
  }
  // Nine types reuse the source city's masonry, window, cornice and projection tools.
  for(const site of NORTHERN_SITES) {
    const point=projection.project(site.x,site.y);
    const scale=site.halfSize/NORTHERN_ARCHITECTURE.halfSize;
    const building=scene.add.image(point.x,point.y+NORTHERN_ARCHITECTURE.anchorY*scale,northernTextureKey(site.kind))
      .setOrigin(.5,1).setScale(scale).setDepth(projection.depth(site.x+site.halfSize,site.y+site.halfSize)+5)
      .setInteractive({pixelPerfect:true,useHandCursor:true});
    building.on("pointerup",()=>inspect(site.title,"Authored northern-city architecture. This is illustrative system context, not a surveyed Jaipur facility, connected sensor, or independently simulated service. Energy-policy evidence remains linked to completed analysis runs."));
    const label=scene.add.text(point.x,point.y-320,site.title,{
      fontFamily:"DM Sans, sans-serif",fontSize:"13px",color:"#eff4e5",backgroundColor:"#254d43ed",padding:{x:10,y:6},
    }).setOrigin(.5,1).setDepth(building.depth+10).setVisible(false);
    building.on("pointerover",()=>label.setVisible(true));
    building.on("pointerout",()=>label.setVisible(false));
    objects.push(building,label);
  }
  const reduced=prefersReducedMotion();
  northernTreeSites().forEach((point,index)=>{
    const screen=projection.project(point.x,point.y),variant=index%7;
    const key=variant===0?"tree-ancient":variant===1?"tree-flowering":propTextureKey(variant<4?"pine":"tree");
    const scale=variant===0?1.4:1+(index%4)*.11,anchor=variant<2?12:TILE_ANCHOR_Y;
    const tree=scene.add.image(screen.x,screen.y+anchor*scale,key).setOrigin(.5,1).setScale(scale).setDepth(projection.depth(point.x,point.y));
    if(!reduced&&variant===1&&index<90)scene.tweens.add({targets:tree,angle:.6,duration:3400+index*11,yoyo:true,repeat:-1,ease:"Sine.InOut"});
    objects.push(tree);
  });
  return objects;
}
