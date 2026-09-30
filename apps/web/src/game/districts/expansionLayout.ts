/** Authored world-space layout, not a surveyed city or a measured deployment. */
export const NORTHERN_MAINLAND = {
  centerX: 18, centerY: -63, radiusX: 60, radiusY: 36,
  southShore: -27, shorelineSegments: 144,
} as const;

export const NORTH_RAIL_BUFFER = { minX: 13, maxX: 23, minY: -91, maxY: -32 } as const;
export const NORTH_CONNECTOR = { x: 30, halfWidth: 2, startY: -96, endY: -27 } as const;
export const NORTH_STATION_Y = [-86, -70, -54, -36] as const;
export const NORTH_ROADS = { columns: [-28, -10, 8, 30, 48, 66], rows: [-84, -68, -52, -36], halfWidth: .9, sidewalk: .36 } as const;

export type NorthernBuilding = 'research' | 'library' | 'conservatory' | 'apartments' | 'tower' | 'innovation' | 'depot' | 'solar' | 'waterworks';
export interface NorthernSite { id: string; kind: NorthernBuilding; x: number; y: number; title: string; halfSize: number; }
export const NORTHERN_SITES: readonly NorthernSite[] = [
  { id: 'north-research', kind: 'research', x: -20, y: -77, title: 'Climate research campus', halfSize: 3.5 },
  { id: 'north-library', kind: 'library', x: -1, y: -77, title: 'Civic knowledge library', halfSize: 3.5 },
  { id: 'north-conservatory', kind: 'conservatory', x: 39, y: -77, title: 'Botanical conservatory', halfSize: 3.5 },
  { id: 'north-terraces', kind: 'apartments', x: 57, y: -77, title: 'Terrace housing quarter', halfSize: 3.5 },
  { id: 'north-west-tower', kind: 'tower', x: -20, y: -61, title: 'Mixed-use tower court', halfSize: 3.5 },
  { id: 'north-homes', kind: 'apartments', x: -1, y: -61, title: 'Garden housing court', halfSize: 3.5 },
  { id: 'north-innovation', kind: 'innovation', x: 39, y: -61, title: 'Innovation and learning hall', halfSize: 3.5 },
  { id: 'north-depot', kind: 'depot', x: 57, y: -61, title: 'Electric transit service depot', halfSize: 3.5 },
  { id: 'north-solar', kind: 'solar', x: -20, y: -45, title: 'Solar and storage precinct', halfSize: 3.5 },
  { id: 'north-water', kind: 'waterworks', x: -1, y: -45, title: 'Water reuse works', halfSize: 3.5 },
  { id: 'north-east-homes', kind: 'apartments', x: 39, y: -45, title: 'Promenade housing quarter', halfSize: 3.5 },
  { id: 'north-east-tower', kind: 'tower', x: 57, y: -45, title: 'Eastern mixed-use tower', halfSize: 3.5 },
  { id: 'north-west-library', kind: 'library', x: -36, y: -61, title: 'West garden reading room', halfSize: 3.5 },
  { id: 'north-east-garden', kind: 'conservatory', x: 73, y: -61, title: 'Eastern botanical pavilion', halfSize: 3.4 },
  { id: 'north-energy', kind: 'solar', x: -1, y: -91, title: 'Northern energy court', halfSize: 3.5 },
  { id: 'north-upper-homes', kind: 'apartments', x: 39, y: -91, title: 'Northern terrace homes', halfSize: 3.5 },
  { id: 'north-west-pavilion', kind: 'library', x: -36, y: -74, title: 'West coast garden pavilion', halfSize: 1.3 },
  { id: 'north-east-nursery', kind: 'conservatory', x: 73, y: -73, title: 'Coastal plant nursery', halfSize: 1.3 },
  { id: 'north-west-service', kind: 'depot', x: -34, y: -49, title: 'West coast maintenance workshop', halfSize: 1.1 },
  { id: 'north-east-service', kind: 'innovation', x: 71, y: -49, title: 'East promenade learning pavilion', halfSize: 1.1 },
] as const;

export interface NorthPoint { x: number; y: number; }
export function northernDistance(x: number, y: number): number {
  return ((x - NORTHERN_MAINLAND.centerX) / NORTHERN_MAINLAND.radiusX) ** 2 + ((y - NORTHERN_MAINLAND.centerY) / NORTHERN_MAINLAND.radiusY) ** 2;
}
export function insideNorthernMainland(x: number, y: number, inset = 0): boolean {
  return northernDistance(x, y) <= 1 - inset && y <= NORTHERN_MAINLAND.southShore;
}
export function insideNorthRailBuffer(x: number, y: number): boolean {
  return x >= NORTH_RAIL_BUFFER.minX && x <= NORTH_RAIL_BUFFER.maxX && y >= NORTH_RAIL_BUFFER.minY && y <= NORTH_RAIL_BUFFER.maxY;
}
export function insideNorthernSite(x: number, y: number, margin = 0): boolean {
  return NORTHERN_SITES.some(site => Math.abs(x - site.x) <= site.halfSize + margin && Math.abs(y - site.y) <= site.halfSize + margin);
}
export function northSiteAccess(site: NorthernSite): { from: NorthPoint; to: NorthPoint } {
  const front=NORTH_ROADS.rows.find(row => row >= site.y + site.halfSize);
  const candidates=[
    ...NORTH_ROADS.rows.filter(row=>Math.abs(row-site.y)>site.halfSize).map(row=>({from:{x:site.x,y:site.y+Math.sign(row-site.y)*site.halfSize},to:{x:site.x,y:row}})),
    ...NORTH_ROADS.columns.filter(column=>Math.abs(column-site.x)>site.halfSize).map(column=>({from:{x:site.x+Math.sign(column-site.x)*site.halfSize,y:site.y},to:{x:column,y:site.y}})),
  ].filter(path=>Array.from({length:25},(_,i)=>i/24).every(t=>insideNorthernMainland(path.from.x+(path.to.x-path.from.x)*t,path.from.y+(path.to.y-path.from.y)*t)))
    .sort((a,b)=>Math.hypot(a.to.x-a.from.x,a.to.y-a.from.y)-Math.hypot(b.to.x-b.from.x,b.to.y-b.from.y));
  // Prefer the public front court where the coastline permits it. Coastal
  // pavilions use a shorter side approach rather than sending a path into sea.
  return candidates.find(path=>path.to.x===site.x&&path.to.y===front) ?? candidates[0]!;
}
const NORTHERN_ACCESS_PATHS = NORTHERN_SITES.map(northSiteAccess);
export function insideNorthRoad(x: number, y: number, margin = 0): boolean {
  if (!insideNorthernMainland(x, y)) return false;
  const width = NORTH_ROADS.halfWidth + NORTH_ROADS.sidewalk + margin;
  if (NORTH_ROADS.columns.some(column => Math.abs(x - column) <= width) || NORTH_ROADS.rows.some(row => Math.abs(y - row) <= width)) return true;
  // The platform stairs meet transverse pedestrian links to the bridge spine.
  if (NORTH_STATION_Y.some(stationY => Math.abs(y - (stationY + 4)) <= .65 + margin) && x >= 8 && x <= 31.2) return true;
  if (NORTH_STATION_Y.some(stationY => y >= stationY - 4.2 && y <= stationY + 4.65)
    && (Math.abs(x - 16.35) <= .35 + margin || Math.abs(x - 21.65) <= .4 + margin)) return true;
  // Individual short entrances connect the front court to the street grid.
  return NORTHERN_ACCESS_PATHS.some(({from,to}) => {
    return from.x===to.x ? Math.abs(x-from.x)<=.65+margin && y>=Math.min(from.y,to.y) && y<=Math.max(from.y,to.y)
      : Math.abs(y-from.y)<=.65+margin && x>=Math.min(from.x,to.x) && x<=Math.max(from.x,to.x);
  });
}
export function northernTileKind(x: number, y: number): 'water' | 'shore' | 'road' | 'plaza' | 'meadow' {
  if (!insideNorthernMainland(x, y)) return 'water';
  if (northernDistance(x, y) > .94) return 'shore';
  if (insideNorthRoad(x, y)) return 'road';
  if (insideNorthernSite(x, y)) return 'plaza';
  return 'meadow';
}
export function northernShoreline(scale = 1): NorthPoint[] {
  return Array.from({ length: NORTHERN_MAINLAND.shorelineSegments }, (_, index) => {
    const angle = index / NORTHERN_MAINLAND.shorelineSegments * Math.PI * 2;
    return { x: NORTHERN_MAINLAND.centerX + Math.cos(angle) * NORTHERN_MAINLAND.radiusX * scale, y: NORTHERN_MAINLAND.centerY + Math.sin(angle) * NORTHERN_MAINLAND.radiusY * scale };
  });
}
/** Bounded static props: large land does not imply thousands of game objects. */
export function northernTreeSites(): NorthPoint[] {
  const points: NorthPoint[] = [];
  for (let x = -40; x <= 76; x += 2) for (let y = -97; y <= -29; y += 2) {
    const hash = Math.abs((x * 7349) ^ (y * 9151));
    if (hash % 3 !== 0 || !insideNorthernMainland(x, y, .08) || insideNorthRailBuffer(x, y) || insideNorthRoad(x, y, .7) || insideNorthernSite(x, y, .9)) continue;
    points.push({ x: x + ((hash % 7) - 3) * .06, y: y + ((hash % 11) - 5) * .04 });
  }
  return points;
}
