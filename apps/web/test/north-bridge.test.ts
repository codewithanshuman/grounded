import { describe, expect, it } from "vitest";
import { NORTH_CITY_BRIDGE, northBridgeHeight, onNorthCityApproach } from "../src/game/districts/northBridgeModel";

describe("northern city road bridge", () => {
  it("starts and ends at ground level with a continuous navigable deck", () => {
    expect(northBridgeHeight(NORTH_CITY_BRIDGE.startY)).toBe(0);
    expect(northBridgeHeight(NORTH_CITY_BRIDGE.endY)).toBe(0);
    for(let y=NORTH_CITY_BRIDGE.startY;y<NORTH_CITY_BRIDGE.endY;y+=.1) {
      expect(Math.abs(northBridgeHeight(y+.1)-northBridgeHeight(y))).toBeLessThanOrEqual(2.601);
    }
  });
  it("keeps supports outside the original ship lane with sufficient deck clearance", () => {
    for(const y of NORTH_CITY_BRIDGE.pierYs) expect(y < -16 || y > -11).toBe(true);
    for(let y=-16;y<=-11;y+=.1) expect(northBridgeHeight(y)).toBe(104);
  });
  it("continues into the existing city road without cutting its coast or the hoarding", () => {
    expect(NORTH_CITY_BRIDGE.roadEndY).toBe(0);
    expect(onNorthCityApproach(30,-3)).toBe(true);
    expect(onNorthCityApproach(24,-3)).toBe(false);
    expect(onNorthCityApproach(-3.2,28.5)).toBe(false);
  });
});
