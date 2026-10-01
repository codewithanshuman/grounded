import { z } from "zod";

export const EvidenceFamily = z.enum(["storage", "flexibility", "resilience"]);
export type EvidenceFamily = z.infer<typeof EvidenceFamily>;
export const CityRotation = z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]);
export type CityRotation = z.infer<typeof CityRotation>;
const count = z.number().int().nonnegative();
export const CityProofSummary = z.object({
  proofIdentity: z.string().min(1), sourceContextKey: z.string().min(1),
  baselineRunId: z.string().min(1), resultRunId: z.string().min(1), modelVersion: z.string().min(1),
  calibrationFingerprint: z.string().min(1), siteDataFingerprint: z.string().min(1),
  targetPct: z.number().finite().positive().max(100), baselineSampleSize: count.positive(), resultSampleSize: count.positive(),
  beforeCritical: count, afterCritical: count,
  holdouts: z.array(z.object({ label: z.string(), seedOffset: count, clusterCount: count.positive(),
    upperCriticalRiskPct: z.number().finite().min(0).max(100), pairedPValue: z.number().finite().min(0).max(1),
    preventedFailureClusters: count, introducedFailureClusters: count })).min(3),
  compoundStressCells: count.positive(), compoundPassingCells: count,
});
export type CityProofSummary = z.infer<typeof CityProofSummary>;
export const EvidenceMilestone = z.object({ id: z.string().min(1), family: EvidenceFamily,
  level: z.number().int().min(1).max(3), earnedAt: z.number().finite().nonnegative(), proof: CityProofSummary });
export type EvidenceMilestone = z.infer<typeof EvidenceMilestone>;
export const PlacementRequest = z.object({ milestoneId: z.string().min(1), variantId: z.string().min(1),
  plotId: z.string().min(1), rotation: CityRotation });
export type PlacementRequest = z.infer<typeof PlacementRequest>;

export const CITY_VARIANTS = [
  { id: "storage-battery-pavilion", family: "storage", label: "Battery pavilion", kind: "reservoir" },
  { id: "storage-control-hall", family: "storage", label: "Storage control hall", kind: "solarHall" },
  { id: "storage-reserve-centre", family: "storage", label: "Reserve centre", kind: "resilienceHall" },
  { id: "flexibility-mobility-hub", family: "flexibility", label: "Mobility hub", kind: "solarHall" },
  { id: "flexibility-cooling-commons", family: "flexibility", label: "Cooling commons", kind: "reservoir" },
  { id: "flexibility-demand-tower", family: "flexibility", label: "Demand-response tower", kind: "watchtower" },
  { id: "resilience-watchtower", family: "resilience", label: "Resilience watchtower", kind: "watchtower" },
  { id: "resilience-community-hall", family: "resilience", label: "Community resilience hall", kind: "resilienceHall" },
  { id: "resilience-refuge", family: "resilience", label: "Emergency refuge", kind: "reservoir" },
] as const;

/** Frozen authored seats, not arbitrary coordinates. Odd tile origins are
 * reserved two-by-two plots, away from roads, water, landmarks and the mall. */
export const CITY_PLOTS = [
  { id: "storage-1", district: "Storage quarter", label: "Storage plot 1", gx: 1, gy: 1, families: ["storage"] },
  { id: "storage-2", district: "Storage quarter", label: "Storage plot 2", gx: 5, gy: 1, families: ["storage"] },
  { id: "storage-3", district: "Storage quarter", label: "Storage plot 3", gx: 7, gy: 1, families: ["storage"] },
  { id: "flexibility-1", district: "Flexible-load quarter", label: "Flexibility plot 1", gx: 11, gy: 1, families: ["flexibility"] },
  { id: "flexibility-2", district: "Flexible-load quarter", label: "Flexibility plot 2", gx: 13, gy: 1, families: ["flexibility"] },
  { id: "flexibility-3", district: "Flexible-load quarter", label: "Flexibility plot 3", gx: 17, gy: 1, families: ["flexibility"] },
  { id: "resilience-1", district: "Resilience quarter", label: "Resilience plot 1", gx: 19, gy: 1, families: ["resilience"] },
  { id: "resilience-2", district: "Resilience quarter", label: "Resilience plot 2", gx: 23, gy: 1, families: ["resilience"] },
  { id: "resilience-3", district: "Resilience quarter", label: "Resilience plot 3", gx: 25, gy: 1, families: ["resilience"] },
] as const;

/** A registered building occupies its authored catalogue seat, never untrusted
 * saved coordinates. Malformed/legacy metadata keeps the legacy render seat. */
export function catalogBuildingPlot(building: { milestoneId?: string; plotId?: string;
  variantId?: string; family?: string; kind: string }) {
  if (!building.milestoneId || !building.plotId || !building.variantId) return undefined;
  const plot = CITY_PLOTS.find((candidate) => candidate.id === building.plotId);
  const variant = CITY_VARIANTS.find((candidate) => candidate.id === building.variantId);
  return plot && variant && variant.kind === building.kind && variant.family === building.family
    && (plot.families as readonly string[]).includes(variant.family) ? plot : undefined;
}

/** Exact legacy rendered ordering, including the authored landmark filter.
 * Legacy stored gx/gy were forest cells and must not be used as city plots. */
export const LEGACY_EVIDENCE_PLOTS: ReadonlyArray<readonly [number, number]> = [
  ...[1, 5, 23, 29].flatMap((y) => [1, 5, 7, 11, 13, 17, 19, 23, 25, 29, 31, 35]
    .filter((x) => y !== 29 || ![7, 11, 31, 35].includes(x)).map((x) => [x, y] as const)),
  ...Array.from({ length: 16 }, (_, index) => [1 + Math.floor(index / 2) * 6, index % 2 ? 35 : 31] as const),
];
export function legacyEvidencePlot(index: number): readonly [number, number] {
  return LEGACY_EVIDENCE_PLOTS[index % LEGACY_EVIDENCE_PLOTS.length]!;
}
