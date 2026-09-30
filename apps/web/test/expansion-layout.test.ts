import { describe, expect, it } from "vitest";
import { NORTH_CONNECTOR, NORTHERN_MAINLAND, NORTHERN_SITES, NORTH_ROADS, NORTH_STATION_Y, insideNorthernMainland, insideNorthernSite, insideNorthRoad, insideNorthRailBuffer, northernShoreline, northernTreeSites, northSiteAccess } from "../src/game/districts/expansionLayout";
import { NORTH_CITY_BRIDGE } from "../src/game/districts/northBridgeModel";
import { RAIL, railSupportYs } from "../src/game/rail/railModel";
import { CITY_SIZE, RESERVE } from "../src/game/landmarks/worldLayout";

describe("expanded northern city", () => {
  it("adds substantially larger rounded land without resizing the original city", () => {
    expect(Math.PI*NORTHERN_MAINLAND.radiusX*NORTHERN_MAINLAND.radiusY).toBeGreaterThan(CITY_SIZE.width*CITY_SIZE.height*3);
    expect(CITY_SIZE).toEqual({width:48,height:36});
    expect(RESERVE.bridgeEnd).toBe(-6);
    expect(northernShoreline()).toHaveLength(144);
  });
  it("retains the original sea gap and northern ship route", () => {
    for(const point of northernShoreline())expect(point.y).toBeLessThanOrEqual(-27);
    for(let x=-30;x<=78;x++)for(let y=-26;y<=-7;y++)expect(insideNorthernMainland(x,y)).toBe(false);
  });
  it("grounds all detailed building footprints and separates them", () => {
    for(const site of NORTHERN_SITES) {
      for(const x of [site.x-site.halfSize,site.x+site.halfSize])for(const y of [site.y-site.halfSize,site.y+site.halfSize])expect(insideNorthernMainland(x,y)).toBe(true);
      for(const other of NORTHERN_SITES)if(site.id!==other.id)expect(Math.abs(site.x-other.x)>site.halfSize+other.halfSize+2 || Math.abs(site.y-other.y)>site.halfSize+other.halfSize+2).toBe(true);
    }
    expect(new Set(NORTHERN_SITES.map(site=>site.kind)).size).toBe(9);
    expect(new Set(NORTHERN_SITES.map(site=>site.id)).size).toBe(NORTHERN_SITES.length);
  });
  it("keeps building courts outside the rail corridor and road bridge spine", () => {
    for(const site of NORTHERN_SITES) {
      expect(Math.abs(site.x-RAIL.x)).toBeGreaterThan(site.halfSize+5);
      expect(Math.abs(site.x-NORTH_CONNECTOR.x)).toBeGreaterThan(site.halfSize+NORTH_CONNECTOR.halfWidth);
    }
  });
  it("connects every building court to a street without sending paths into sea", () => {
    for(const site of NORTHERN_SITES) {
      const {from,to}=northSiteAccess(site);
      expect(NORTH_ROADS.rows.some(row=>row===to.y)||NORTH_ROADS.columns.some(column=>column===to.x)).toBe(true);
      for(let t=0;t<=1;t+=.02)expect(insideNorthRoad(from.x+(to.x-from.x)*t,from.y+(to.y-from.y)*t)).toBe(true);
    }
  });
  it("links both station stair landings to the road spine", () => {
    for(const y of NORTH_STATION_Y) {
      for(let x=8;x<=30;x+=.25)expect(insideNorthRoad(x,y+4)).toBe(true);
      expect(insideNorthRoad(16.35,y-3.8)).toBe(true);
      expect(insideNorthRoad(21.65,y)).toBe(true);
    }
  });
  it("joins the elevated road approach on land and the existing city street", () => {
    expect(NORTH_CONNECTOR.x).toBe(NORTH_CITY_BRIDGE.gx);
    expect(insideNorthernMainland(NORTH_CITY_BRIDGE.gx,NORTH_CITY_BRIDGE.startY)).toBe(true);
    expect(insideNorthRoad(NORTH_CITY_BRIDGE.gx,NORTH_CITY_BRIDGE.startY)).toBe(true);
    expect(NORTH_CITY_BRIDGE.roadEndY).toBe(0);
  });
  it("keeps bounded mixed groves out of buildings, streets and transit", () => {
    const trees=northernTreeSites();
    expect(trees.length).toBeGreaterThan(150);
    expect(trees.length).toBeLessThan(400);
    for(const point of trees) {
      expect(insideNorthernMainland(point.x,point.y)).toBe(true);
      expect(insideNorthernSite(point.x,point.y,.65)).toBe(false);
      expect(insideNorthRoad(point.x,point.y,.3)).toBe(false);
      expect(insideNorthRailBuffer(point.x,point.y)).toBe(false);
    }
    expect(northernTreeSites()).toEqual(trees);
  });
  it("keeps concrete rail supports out of ground streets", () => {
    const supports=railSupportYs();
    expect(supports.length).toBeGreaterThan(5);
    for(const y of supports)expect(insideNorthRoad(RAIL.x,y,.35)).toBe(false);
  });
});
