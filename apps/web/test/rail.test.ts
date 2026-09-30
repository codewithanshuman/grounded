import { describe, expect, it } from "vitest";
import { createAirportLayout } from "../src/reference-city/layouts/airport";
import { RAIL, RAIL_CYCLE_MS, RAIL_STATIONS, RailClock, carY, railPose, researchDistance } from "../src/game/rail/railModel";
import { CITY_SIZE, LANDMARK_SITES, RESERVE } from "../src/game/landmarks/worldLayout";

describe("Coastal railway", () => {
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
    for(const landmark of LANDMARK_SITES) expect(landmark.gx-RAIL.x).toBeGreaterThan(8);
    expect(researchDistance(RAIL.x,RAIL_STATIONS[0].y)).toBeLessThan(.8);
    // Existing ship loops use y=-11 .. -16; new land stays north of y=-19.
    for(let x=-16;x<=14;x++)for(let y=-16;y<=-11;y++)expect(researchDistance(x,y)).toBeGreaterThan(1);
  });
});
