import type { Building, WorldState } from "@verdant/protocol";
import { CITY_PLOTS, CITY_VARIANTS, catalogBuildingPlot, legacyEvidencePlot } from "@verdant/protocol/city";
import { placementStatus } from "@verdant/sim/evidenceCity";

export type EvidenceOrientation = 0 | 90 | 180 | 270;
export interface EvidenceBuildPlan {
  milestoneId: string;
  variantId: string;
  rotation: EvidenceOrientation;
}
export interface EvidencePlacement extends EvidenceBuildPlan { plotId: string }
export type EvidencePlot = (typeof CITY_PLOTS)[number];
export type EvidenceVariant = (typeof CITY_VARIANTS)[number];
export interface PlacementVerdict { eligible: boolean; reason: string; plot: EvidencePlot; variant?: EvidenceVariant }
export type EvidencePlotPresentation = "OCCUPIED" | "SELECTED" | "ELIGIBLE" | "UNRELATED";

/** Isometric front orientation, not a rotated two-dimensional building bitmap. */
export const nextEvidenceOrientation = (rotation: EvidenceOrientation): EvidenceOrientation =>
  ((rotation + 90) % 360) as EvidenceOrientation;

export function evidenceVariant(id: string): EvidenceVariant | undefined {
  return CITY_VARIANTS.find((variant) => variant.id === id);
}

export function catalogPlotFor(building: Building): EvidencePlot | undefined {
  return catalogBuildingPlot(building);
}

/** Preserve the renderer's exact legacy index seats, not the old forest gx/gy. */
export function renderedBuildingPlot(building: Building, index: number): { gx: number; gy: number } {
  const plot = catalogPlotFor(building);
  if (plot) return { gx: plot.gx, gy: plot.gy };
  const [gx, gy] = legacyEvidencePlot(index);
  return { gx, gy };
}

export function placementVerdict(world: WorldState, plan: EvidenceBuildPlan, plot: EvidencePlot): PlacementVerdict {
  const variant = evidenceVariant(plan.variantId);
  // The preview and final placement share family, occupancy and upgrade rules.
  // A green overlay must never promise a placement that the transport rejects.
  const status = placementStatus(world, { ...plan, plotId: plot.id });
  const sameFamily = world.buildings.some((candidate) => candidate.family === variant?.family);
  return { eligible: status.valid, reason: status.valid
    ? sameFamily ? "Upgrade this building." : "Available evidence plot."
    : status.reason, plot, variant };
}

/** Keeps construction mode local to the plot under consideration. */
export function evidencePlotPresentation(world: WorldState, plan: EvidenceBuildPlan | null,
  plot: EvidencePlot, selectedPlotId?: string): EvidencePlotPresentation {
  if (world.buildings.some((building) => catalogPlotFor(building)?.id === plot.id)) return "OCCUPIED";
  if (!plan) return "UNRELATED";
  const eligible = placementVerdict(world, plan, plot).eligible;
  if (eligible && selectedPlotId === plot.id) return "SELECTED";
  return eligible ? "ELIGIBLE" : "UNRELATED";
}

/** A world pointer must be inside the authored land tile, not its bounding box. */
export function plotAtGrid(gx: number, gy: number): EvidencePlot | undefined {
  if (!Number.isFinite(gx) || !Number.isFinite(gy)) return undefined;
  return CITY_PLOTS.find((plot) => Math.abs(gx - plot.gx) <= .48 && Math.abs(gy - plot.gy) <= .48);
}

export function placementClickIsValid(start: { x: number; y: number; plotId?: string; dragged?: boolean } | undefined,
  end: { x: number; y: number; plotId?: string }, slop = 5): boolean {
  return !!start?.plotId && !start.dragged && start.plotId === end.plotId
    && Math.hypot(end.x - start.x, end.y - start.y) <= slop;
}

export function inspectionClickIsValid(start: { x: number; y: number; dragged?: boolean } | undefined,
  end: { x: number; y: number }, slop = 5): boolean {
  return !!start && !start.dragged && Math.hypot(end.x - start.x, end.y - start.y) <= slop;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) return false;
  return target.isContentEditable || !!target.closest("input,textarea,select,[contenteditable=true],[role=textbox],[role=dialog],dialog");
}

export function constructionReceipt(building: Building): string | undefined {
  return building.milestoneId && building.variantId && building.plotId
    ? `${building.id}:${building.milestoneId}:${building.level ?? 1}:${building.variantId}:${building.rotation ?? 0}` : undefined;
}
