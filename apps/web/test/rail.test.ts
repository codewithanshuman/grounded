import { describe, expect, it } from "vitest";
import { airportReservedRects, createAirportLayout } from "../src/reference-city/layouts/airport";
import { billboardPanelTransform, repoBillboardSlot } from "../src/reference-city/layouts/billboards";
import { createIsoProjection, TILE_HEIGHT, TILE_WIDTH } from "../src/reference-city/math/iso";
import { RAIL, RAIL_RESERVATION, RAIL_CYCLE_MS, RAIL_STATIONS, RailClock, carY, railPose, inRailCorridor } from "../src/game/rail/railModel";
import { CITY_SIZE, LANDMARK_SITES, RESERVE } from "../src/game/landmarks/worldLayout";
import { NORTH_RAIL_BUFFER, NORTH_STATION_Y, NORTHERN_SITES, insideNorthernMainland } from "../src/game/districts/expansionLayout";

describe("Northern-mainland metro", () => {
  it("dwells at every station in both directions and repeats exactly", () => {
    const visited = new Set<string>();
    for (let time=0;time<RAIL_CYCLE_MS;time+=250) { const pose=railPose(time); if(pose.phase==='DWELL')visited.add(pose.station); }
    expect([...visited].sort()).toEqual(RAIL_STATIONS.map(station=>station.name).sort());
    expect(railPose(RAIL_CYCLE_MS+27000)).toEqual(railPose(27000));
    expect(railPose(0).phase).toBe('DWELL');
    expect(railPose(4900).y).toBe(RAIL_STATIONS[0].y);
  });
  it("keeps all cars on connected track through the entire timetable", () => {
    for(let time=0;time<RAIL_CYCLE_MS;time+=100) for(const offset of [0,RAIL_CYCLE_MS/2]) {
      const pose=railPose(time,offset);
      for(let car=0;car<3;car++) { expect(carY(pose,car)-.48).toBeGreaterThanOrEqual(RAIL.trackStart); expect(carY(pose,car)+.48).toBeLessThanOrEqual(RAIL.trackEnd); }
      expect(carY(pose,0)-carY(pose,1)).toBeCloseTo(RAIL.carSpacing,8);
    }
    expect(2*RAIL.laneOffset).toBeGreaterThan(.5); // car width .5: trains cannot touch
  });
  it("brakes continuously into station dwell without position jumps", () => {
    let before=railPose(0).y;
    for(let t=10;t<=RAIL_CYCLE_MS;t+=10) { const y=railPose(t).y; expect(Math.abs(y-before)).toBeLessThan(.02); before=y; }
  });
  it("pause freezes time and speed controls are bounded", () => {
    const clock=new RailClock(); clock.advance(100); clock.paused=true; clock.advance(100); expect(clock.elapsedMs).toBe(100);
    clock.paused=false; clock.setSpeed(2); clock.advance(100); expect(clock.elapsedMs).toBe(300);
    clock.setSpeed(100); expect(clock.speed).toBe(2); clock.advance(-100); expect(clock.elapsedMs).toBe(300);
  });
  it("extends north without moving the existing city, forest or airport", () => {
    expect(CITY_SIZE).toEqual({width:48,height:36}); expect(RESERVE.bridgeEnd).toBe(-6);
    expect(RAIL.trackEnd).toBeLessThan(createAirportLayout(CITY_SIZE.width,CITY_SIZE.height).terminal.y-1);
    for(const landmark of LANDMARK_SITES) {
      expect(landmark.gy-RAIL_RESERVATION.maxY).toBeGreaterThan(20);
      expect(inRailCorridor(landmark.gx,landmark.gy)).toBe(false);
    }
    // Ships and the airport retain their authored layouts. The whole metro,
    // including station stairs, now sits on the new northern mainland.
    expect(RAIL_RESERVATION.maxY).toBeLessThan(-27);
    for(let x=-16;x<=14;x++)for(let y=-16;y<=-11;y++)expect(inRailCorridor(x,y)).toBe(false);
  });
  it("keeps every platform, stair and track envelope clear of airport ground", () => {
    const reserved=airportReservedRects(CITY_SIZE.width,CITY_SIZE.height);
    for(const rectangle of reserved) {
      expect(RAIL_RESERVATION.maxY).toBeLessThan(rectangle.minY-20);
    }
    for(const station of RAIL_STATIONS) {
      for(const x of [RAIL.x-3.4,RAIL.x+3.8]) for(const y of [station.y-3.8,station.y+1.9]) {
        expect(inRailCorridor(x,y)).toBe(true);
      }
    }
  });
  it("places the entire railway and every station on shared expanded land", () => {
    expect(RAIL_RESERVATION).toEqual(NORTH_RAIL_BUFFER);
    expect(RAIL_STATIONS.map(station=>station.y)).toEqual([...NORTH_STATION_Y]);
    for(let y=RAIL_RESERVATION.minY;y<=RAIL_RESERVATION.maxY;y+=.5) {
      for(const x of [RAIL_RESERVATION.minX,RAIL_RESERVATION.maxX]) {
        expect(insideNorthernMainland(x,y,.08)).toBe(true);
      }
    }
    for(const site of NORTHERN_SITES) {
      const clearsX=site.x+site.halfSize<RAIL_RESERVATION.minX || site.x-site.halfSize>RAIL_RESERVATION.maxX;
      const clearsY=site.y+site.halfSize<RAIL_RESERVATION.minY || site.y-site.halfSize>RAIL_RESERVATION.maxY;
      expect(clearsX || clearsY).toBe(true);
    }
  });
  it("has a separate screen silhouette from the Grounded airport hoarding", () => {
    const projection=createIsoProjection(TILE_WIDTH,TILE_HEIGHT);
    const board=repoBillboardSlot(CITY_SIZE.height),transform=billboardPanelTransform(board.size,board.facing);
    const anchor=projection.project(board.x,board.y);
    // The complete frame texture includes the sign, posts and ground shadow.
    const boardRight=anchor.x+transform.canvasWidth/2;
    // Even a conservative 700px envelope for platforms and the 640px overpass
    // stays away horizontally. This catches projection overlap, not just plan overlap.
    for(let y=RAIL.trackStart;y<=RAIL.trackEnd;y+=.5) {
      expect(projection.project(RAIL.x,y).x-350-boardRight).toBeGreaterThan(500);
    }
    // Regression fixture: the old line x=-3 passed within .2 tiles of the board.
    expect(Math.abs(board.x-(-3))).toBeLessThan(.25);
    expect(RAIL_STATIONS.map(station=>station.name)).not.toContain('Airport');
  });
});
