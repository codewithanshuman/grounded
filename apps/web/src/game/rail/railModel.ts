/** A deterministic operating timetable; independent of the energy evidence model. */
export const RAIL = { x: -3, elevation: 64, laneOffset: .37, carSpacing: 1.03, trackStart: -30.5, trackEnd: 33.5 };
export const RESEARCH_DISTRICT = { cx: -1, cy: -29, rx: 14, ry: 9 };
export const RAIL_STATIONS = [
  { id: "research", name: "Research Park", y: -28 },
  { id: "city", name: "City Gate", y: 0 },
  { id: "reserve", name: "Reserve Link", y: 12 },
  { id: "airport", name: "Airport", y: 31 },
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
export function researchDistance(x: number, y: number) { return ((x - RESEARCH_DISTRICT.cx) / RESEARCH_DISTRICT.rx) ** 2 + ((y - RESEARCH_DISTRICT.cy) / RESEARCH_DISTRICT.ry) ** 2; }
export function inRailCorridor(x: number, y: number) { return Math.abs(x - RAIL.x) < 2.3 && y >= RAIL.trackStart - 2 && y <= RAIL.trackEnd + 1; }

export class RailClock {
  elapsedMs = 0;
  paused = false;
  speed = 1;
  advance(deltaMs: number) { if (!this.paused && Number.isFinite(deltaMs)) this.elapsedMs += Math.max(0, Math.min(deltaMs, 100)) * this.speed; }
  setSpeed(speed: number) { if ([.5, 1, 2].includes(speed)) this.speed = speed; }
}
