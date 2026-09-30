import { insideNorthRoad } from "../districts/expansionLayout";
/** A dedicated northern-mainland metro, independent of the energy evidence model. */
export const RAIL = { x: 18, elevation: 64, laneOffset: .37, carSpacing: 1.03, trackStart: -89, trackEnd: -33 };
/** Clear land for the entire station stair, shelter and train envelope, not just the rails. */
export const RAIL_RESERVATION = { minX: 13, maxX: 23, minY: -91, maxY: -32 };
export const RAIL_STATIONS = [
  { id: "campus", name: "Climate Campus", y: -86 },
  { id: "research", name: "Research Park", y: -70 },
  { id: "garden", name: "Garden Quarter", y: -54 },
  { id: "interchange", name: "City Interchange", y: -36 },
] as const;
export interface RailPose { y: number; direction: 1 | -1; phase: "DWELL" | "RUNNING"; station: string; nextStation: string; secondsRemaining: number; }
const DWELL_MS = 5_000;
const MS_PER_TILE = 950;
const STOPS = [0, 1, 2, 3, 2, 1];
export const RAIL_CYCLE_MS = STOPS.reduce((sum, station, index) => sum + DWELL_MS + Math.abs(RAIL_STATIONS[STOPS[(index + 1) % STOPS.length]]!.y - RAIL_STATIONS[station]!.y) * MS_PER_TILE, 0);

export function railPose(elapsedMs: number, phaseOffset = 0): RailPose {
  let clock = ((Math.max(0, elapsedMs) + phaseOffset) % RAIL_CYCLE_MS + RAIL_CYCLE_MS) % RAIL_CYCLE_MS;
  for (let index = 0; index < STOPS.length; index++) {
    const from = RAIL_STATIONS[STOPS[index]]!, to = RAIL_STATIONS[STOPS[(index + 1) % STOPS.length]]!;
    const direction = Math.sign(to.y - from.y) as 1 | -1;
    if (clock < DWELL_MS) return { y: from.y, direction, phase: "DWELL", station: from.name, nextStation: to.name, secondsRemaining: Math.ceil((DWELL_MS - clock) / 1000) };
    clock -= DWELL_MS;
    const duration = Math.abs(to.y - from.y) * MS_PER_TILE;
    if (clock < duration) {
      const t = clock / duration;
      // Smooth acceleration and braking, with exactly zero speed at stations.
      const progress = t * t * (3 - 2 * t);
      return { y: from.y + (to.y - from.y) * progress, direction, phase: "RUNNING", station: from.name, nextStation: to.name, secondsRemaining: Math.ceil((duration - clock) / 1000) };
    }
    clock -= duration;
  }
  return railPose(0);
}

export function carY(pose: RailPose, car: number): number { return pose.y + (1 - car) * RAIL.carSpacing; }
export function inRailCorridor(x: number, y: number) { return x >= RAIL_RESERVATION.minX && x <= RAIL_RESERVATION.maxX && y >= RAIL_RESERVATION.minY && y <= RAIL_RESERVATION.maxY; }
export function railSupportYs(): number[] {
  const supports=[RAIL.trackStart,RAIL.trackEnd];
  for(let y=RAIL.trackStart+2.5;y<RAIL.trackEnd-1;y+=3) supports.push(y);
  return supports.filter(y=>!insideNorthRoad(RAIL.x,y,.35));
}

export class RailClock {
  elapsedMs = 0;
  paused = false;
  speed = 1;
  advance(deltaMs: number) { if (!this.paused && Number.isFinite(deltaMs)) this.elapsedMs += Math.max(0, Math.min(deltaMs, 100)) * this.speed; }
  setSpeed(speed: number) { if ([.5, 1, 2].includes(speed)) this.speed = speed; }
}
