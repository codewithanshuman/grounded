/** Separate approach for the expanded city; the original coast remains intact. */
export const NORTH_CITY_BRIDGE = {
  gx: 30,
  startY: -31,
  endY: -6,
  roadEndY: 0,
  halfWidth: 1.15,
  deckHeight: 104,
  rampRisePerTile: 26,
  pierYs: [-24, -9] as readonly number[],
} as const;

export function northBridgeHeight(gy: number): number {
  const bridge = NORTH_CITY_BRIDGE;
  return Math.max(0, Math.min(bridge.deckHeight,
    (gy - bridge.startY) * bridge.rampRisePerTile,
    (bridge.endY - gy) * bridge.rampRisePerTile));
}

export function onNorthCityApproach(gx: number, gy: number, margin = 0): boolean {
  return Math.abs(gx - NORTH_CITY_BRIDGE.gx) <= NORTH_CITY_BRIDGE.halfWidth + margin
    && gy >= NORTH_CITY_BRIDGE.startY - margin && gy <= NORTH_CITY_BRIDGE.roadEndY + margin;
}
