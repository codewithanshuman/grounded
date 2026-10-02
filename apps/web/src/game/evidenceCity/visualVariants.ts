import type { Archetype } from "../../reference-city/math/palette";
import type { EvidenceOrientation } from "./placementModel";

/** Existing archive silhouettes and material palettes; no replacement city art. */
const STYLES: Record<string, { archetype: Archetype; language: string; accent: number }> = {
  "storage-battery-pavilion": { archetype: "utility", language: "JSON", accent: 0x77bdb3 },
  "storage-control-hall": { archetype: "office", language: "Rust", accent: 0xd39869 },
  "storage-reserve-centre": { archetype: "townhouse", language: "SQL", accent: 0x63bfa2 },
  "flexibility-mobility-hub": { archetype: "utility", language: "Shell", accent: 0x9bd16d },
  "flexibility-cooling-commons": { archetype: "townhouse", language: "Python", accent: 0x88bbdc },
  "flexibility-demand-tower": { archetype: "tower", language: "TypeScript", accent: 0x72aade },
  "resilience-watchtower": { archetype: "tower", language: "Go", accent: 0x73c8c1 },
  "resilience-community-hall": { archetype: "office", language: "HTML", accent: 0xd3a06b },
  "resilience-refuge": { archetype: "townhouse", language: "JavaScript", accent: 0xb6c976 },
};

export function evidenceVisualStyle(variantId: string, level = 1, rotation: EvidenceOrientation = 0) {
  const style = STYLES[variantId];
  if (!style) return undefined;
  // Evidence level remains the proof contract. Presentation starts at the
  // authored mid-rise tier so a newly earned building reads as infrastructure,
  // not as a tiny placeholder; stronger proof still earns two visible upgrades.
  const tier = Math.min(3, Math.max(1, Math.floor(level)));
  return { ...style, tier, loc: [25, 100, 250, 600][tier]!,
    facing: rotation === 90 || rotation === 270 ? "u" as const : "v" as const,
    flipX: rotation === 180 || rotation === 270 };
}

export function orientationFront(rotation: EvidenceOrientation): { gx: number; gy: number } {
  return rotation === 90 ? { gx: .52, gy: 0 } : rotation === 180 ? { gx: 0, gy: -.52 }
    : rotation === 270 ? { gx: -.52, gy: 0 } : { gx: 0, gy: .52 };
}
