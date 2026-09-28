/** Grounded's authored extension. Coordinates use the archive's 96×48 grid. */
export const CITY_SIZE = { width: 48, height: 36 };
export const RESERVE = { cx: -33, cy: 12, rx: 11, ry: 14, bridgeY: 12, bridgeStart: -23, bridgeEnd: -6 };

export const RESERVE_STRUCTURES = {
  fieldStation: { gx: -33, gy: 3 },
  watchtower: { gx: -27, gy: 11 },
  rangerLodge: { gx: -37, gy: 19 },
  sensor: { gx: -33, gy: 22 },
} as const;

/** Clear ground for buildings, entrances and overhanging tree canopies. */
export function insideReserveStructure(gx: number, gy: number): boolean {
  return Object.values(RESERVE_STRUCTURES).some(site => Math.abs(site.gx - gx) < 1.5 && Math.abs(site.gy - gy) < 1.5);
}

export const LANDMARK_SITES = [
  { kind: 'hospital', path: 'facility/critical-care', gx: 9, gy: 15, title: 'Critical-care hospital' },
  { kind: 'school', path: 'place/school', gx: 9, gy: 27, title: 'Community school' },
  { kind: 'temple', path: 'place/temple', gx: 39, gy: 9, title: 'Temple gardens' },
  { kind: 'church', path: 'place/church', gx: 39, gy: 21, title: 'Community church' },
  { kind: 'eiffel', path: 'place/eiffel', gx: 33, gy: 27, title: 'Eiffel-inspired observation tower' },
] as const;

export function reserveDistance(gx: number, gy: number): number {
  return ((gx - RESERVE.cx) / RESERVE.rx) ** 2 + ((gy - RESERVE.cy) / RESERVE.ry) ** 2;
}

export function reserveTrail(gx: number, gy: number): boolean {
  return (Math.abs(gy - RESERVE.bridgeY) < .6 && gx >= -39)
    || (Math.abs(gx - RESERVE.cx) < .6 && gy >= 3 && gy <= 22);
}

/** Deterministic spaced plots: no repeated offsets leaking trees into the sea. */
export const FOREST_PLOTS: ReadonlyArray<readonly [number, number]> = (() => {
  const plots: Array<readonly [number, number]> = [];
  for (let y = 1; y <= 24; y += 2) for (let x = -42; x <= -24; x += 2) {
    if (reserveDistance(x, y) < .72 && !reserveTrail(x, y) && !insideReserveStructure(x, y)) plots.push([x, y]);
  }
  return plots;
})();

export function insideLandmark(gx: number, gy: number, margin = 2.65): boolean {
  return LANDMARK_SITES.some(site => Math.abs(site.gx - gx) < margin && Math.abs(site.gy - gy) < margin);
}
