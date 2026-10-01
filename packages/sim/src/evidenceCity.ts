import type { Building, GrowthEvent, RunSummary, WorldState } from "@verdant/protocol";
import { CITY_PLOTS, CITY_VARIANTS, PlacementRequest, catalogBuildingPlot, legacyEvidencePlot, type CityProofSummary,
  type EvidenceFamily, type EvidenceMilestone, type PlacementRequest as PlaceRequest } from "@verdant/protocol/city";
import type { OptimizationEvidence } from "./decisionReadiness.js";
import { assessOptimizationGrowth, type GrowthContext } from "./growth.js";
import { MODEL_VERSION } from "./index.js";

/** Deterministic identity, not a signature or authorization credential. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Synchronous browser-safe SHA-256 lets both transports share one identity. */
export function cityIdentity(value: unknown): string {
  const bytes = new TextEncoder().encode(canonical(value));
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(length); data.set(bytes); data[bytes.length] = 0x80;
  const view = new DataView(data.buffer);
  const bits = bytes.length * 8;
  view.setUint32(length - 8, Math.floor(bits / 0x100000000)); view.setUint32(length - 4, bits >>> 0);
  const constants = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const state = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const r = (n: number, x: number) => (x >>> n) | (x << (32 - n));
  for (let offset = 0; offset < length; offset += 64) {
    const words = Array<number>(64);
    for (let index = 0; index < 16; index++) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index++) {
      const a = words[index - 15]!, b = words[index - 2]!;
      words[index] = (words[index - 16]! + (r(7,a)^r(18,a)^(a>>>3)) + words[index - 7]! + (r(17,b)^r(19,b)^(b>>>10))) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = state;
    for (let index = 0; index < 64; index++) {
      const t1 = (h! + (r(6,e!)^r(11,e!)^r(25,e!)) + ((e!&f!)^(~e!&g!)) + constants[index]! + words[index]!) >>> 0;
      const t2 = ((r(2,a!)^r(13,a!)^r(22,a!)) + ((a!&b!)^(a!&c!)^(b!&c!))) >>> 0;
      h=g; g=f; f=e; e=(d!+t1)>>>0; d=c; c=b; b=a; a=(t1+t2)>>>0;
    }
    [a,b,c,d,e,f,g,h].forEach((item,index) => { state[index] = (state[index]! + item!) >>> 0; });
  }
  return state.map((item) => item.toString(16).padStart(8,"0")).join("");
}

function contextFor(before: RunSummary) {
  const { status: _cacheStatus, fetchedAt: _fetchedAt, ...climateContent } = before.calibration ?? {};
  return { modelVersion: before.manifest!.modelVersion, calibrationFingerprint: before.manifest!.calibrationFingerprint ?? "REFERENCE",
    siteDataFingerprint: before.manifest!.siteDataFingerprint ?? "REPRESENTATIVE", location: before.location,
    climateContentSha256: cityIdentity(climateContent), siteDataContentSha256: cityIdentity(before.siteData ?? null),
    preset: before.preset, config: before.config, baselinePolicy: before.intervention,
    horizonHours: before.manifest!.horizonHours, timestepMinutes: before.manifest!.timestepMinutes, seedScheme: before.manifest!.seedScheme };
}

export function summarizeCityProof(before: RunSummary, evidence: OptimizationEvidence, targetPct: number): CityProofSummary {
  const after = evidence.result;
  const context = contextFor(before);
  // Exclude only transport UUIDs and wall-clock creation times. The complete
  // deterministic reports, including traces, metrics and source trajectories,
  // remain bound so a certificate cannot silently substitute another report.
  const deterministicRun = ({ runId: _runId, createdAt: _createdAt, ...report }: RunSummary) => report;
  const proofIdentity = cityIdentity({ context, targetPct, intervention: evidence.intervention,
    baseline: deterministicRun(before), result: deterministicRun(after),
    analysis: evidence.analysis, validation: evidence.validation });
  return { proofIdentity, sourceContextKey: cityIdentity(context), baselineRunId: before.runId, resultRunId: after.runId,
    modelVersion: context.modelVersion, calibrationFingerprint: context.calibrationFingerprint, siteDataFingerprint: context.siteDataFingerprint,
    targetPct, baselineSampleSize: before.n, resultSampleSize: after.n, beforeCritical: before.counts.critical, afterCritical: after.counts.critical,
    holdouts: evidence.validation.cohorts.map((cohort) => ({ label: cohort.label, seedOffset: cohort.seedOffset,
      clusterCount: cohort.clusterUncertainty.clusterCount, upperCriticalRiskPct: cohort.clusterUncertainty.upperCriticalRiskPct,
      pairedPValue: cohort.pairedClusterPValue, preventedFailureClusters: cohort.preventedFailureClusters,
      introducedFailureClusters: cohort.introducedFailureClusters })),
    compoundStressCells: evidence.validation.jointStressEnvelope.evaluatedCells,
    compoundPassingCells: evidence.validation.jointStressEnvelope.passingCells };
}

function familiesFor(before: RunSummary, evidence: OptimizationEvidence): EvidenceFamily[] {
  const families: EvidenceFamily[] = ["resilience"];
  if (evidence.intervention.reservePct > before.intervention.reservePct) families.push("storage");
  if (evidence.intervention.evDelayMin > before.intervention.evDelayMin
    || (evidence.intervention.precoolHour !== null && evidence.intervention.precoolHour !== before.intervention.precoolHour)) families.push("flexibility");
  return families;
}
const upper = (proof: CityProofSummary) => Math.max(...proof.holdouts.map((cohort) => cohort.upperCriticalRiskPct));

/** Full validation earns a choice; it never automatically places a building.
 * Families describe levers present in a validated combined policy, not an
 * isolated causal attribution or physical asset deployment. */
export function earnEvidenceMilestones(world: WorldState, before: RunSummary, evidence: OptimizationEvidence, context: GrowthContext, targetPct = 5) {
  const verdict = assessOptimizationGrowth(before, evidence.result, evidence, targetPct);
  if (!verdict.eligible) return { world, events: [] as GrowthEvent[], verdict };
  const proof = summarizeCityProof(before, evidence, targetPct);
  let pending = [...(world.pendingMilestones ?? [])];
  const receipts = [...(world.cityProofReceipts ?? [])];
  const events: GrowthEvent[] = [];
  for (const family of familiesFor(before, evidence)) {
    const receipt = `${family}:${proof.proofIdentity}`;
    if (receipts.includes(receipt)) continue;
    const built = world.buildings.find((building) => building.family === family);
    const awaiting = pending.find((milestone) => milestone.family === family);
    const previous = awaiting?.proof ?? built?.proof;
    if (built && (!built.proof || (built.level ?? 1) >= 3)) continue;
    if (previous && (previous.sourceContextKey !== proof.sourceContextKey || proof.targetPct > previous.targetPct
      || !(upper(proof) < upper(previous) - 1e-9))) continue;
    const level = built ? (built.level ?? 1) + 1 : 1;
    const milestone: EvidenceMilestone = { id: context.id(), family, level, earnedAt: context.now(), proof };
    pending = [...pending.filter((item) => item.family !== family), milestone];
    receipts.push(receipt);
    events.push({ kind: "milestone.earned", runId: before.runId, pendingMilestone: milestone,
      message: `${family} model milestone level ${level} earned. Choose a design and an eligible plot. ${verdict.milestone} Combined-policy evidence is not isolated asset attribution.` });
  }
  return { world: events.length ? { ...world, pendingMilestones: pending, cityProofReceipts: receipts,
    bestImprovementPct: Math.max(world.bestImprovementPct, Math.round(verdict.improvementPct)) } : world, events, verdict };
}

export function verifyMilestoneEvidence(milestone: EvidenceMilestone, baseline: RunSummary, evidence: OptimizationEvidence): boolean {
  try {
    return milestone.proof.baselineRunId === baseline.runId && milestone.proof.resultRunId === evidence.result.runId
      && assessOptimizationGrowth(baseline, evidence.result, evidence, milestone.proof.targetPct).eligible
      && canonical(summarizeCityProof(baseline, evidence, milestone.proof.targetPct)) === canonical(milestone.proof)
      && familiesFor(baseline, evidence).includes(milestone.family);
  } catch { return false; }
}

export function validatePlacement(world: WorldState, input: unknown) {
  const request = PlacementRequest.parse(input);
  const milestone = world.pendingMilestones?.find((item) => item.id === request.milestoneId);
  if (!milestone) throw new Error("That milestone is locked, already placed or no longer current.");
  const variant = CITY_VARIANTS.find((item) => item.id === request.variantId);
  const plot = CITY_PLOTS.find((item) => item.id === request.plotId);
  if (!variant || variant.family !== milestone.family) throw new Error("Choose an unlocked design from this milestone's family.");
  if (!plot || !(plot.families as readonly string[]).includes(milestone.family)) throw new Error("That plot is not an eligible land plot for this family. Water, roads and arbitrary coordinates are not buildable.");
  const existing = world.buildings.find((building) => building.family === milestone.family);
  if (existing && (milestone.level !== (existing.level ?? 1) + 1 || existing.plotId !== plot.id)) throw new Error("An upgrade must keep its existing category building and plot.");
  if (!existing && milestone.level !== 1) throw new Error("A category's first construction must be level 1.");
  world.buildings.forEach((building, index) => {
    if (building.id === existing?.id) return;
    const occupiedPlot = catalogBuildingPlot(building);
    const [gx, gy] = occupiedPlot ? [occupiedPlot.gx, occupiedPlot.gy] : legacyEvidencePlot(index);
    if (Math.abs(gx - plot.gx) < 1.3 && Math.abs(gy - plot.gy) < 1.3) throw new Error("That plot is occupied, including retained legacy construction.");
  });
  return { request, milestone, variant, plot, existing };
}

export function placementStatus(world: WorldState, input: unknown): { valid: boolean; reason: string } {
  try { validatePlacement(world, input); return { valid: true, reason: "Eligible land plot" }; }
  catch (error) { return { valid: false, reason: error instanceof Error ? error.message : "Placement is not eligible" }; }
}

export function eligibleCityPlots(world: WorldState, milestoneId: string) {
  const milestone = world.pendingMilestones?.find((item) => item.id === milestoneId);
  const variant = CITY_VARIANTS.find((item) => item.family === milestone?.family);
  if (!variant) return [];
  return CITY_PLOTS.filter((plot) => placementStatus(world, { milestoneId, variantId: variant.id, plotId: plot.id, rotation: 0 }).valid);
}

export function applyMilestonePlacement(world: WorldState, request: PlaceRequest, baseline: RunSummary,
  evidence: OptimizationEvidence, context: GrowthContext) {
  // Replaying an already committed identical placement is a harmless no-op.
  const placed = world.buildings.find((building) => building.milestoneId === request.milestoneId);
  if (placed) {
    if (placed.variantId !== request.variantId || placed.plotId !== request.plotId || placed.rotation !== request.rotation) throw new Error("This milestone was already placed with a different design.");
    return { world, events: [] as GrowthEvent[] };
  }
  const { milestone, variant, plot, existing } = validatePlacement(world, request);
  if (baseline.manifest?.modelVersion !== MODEL_VERSION || evidence.result.manifest?.modelVersion !== MODEL_VERSION) throw new Error("This proof belongs to an earlier model. Its history is retained; rerun the current model before new construction.");
  if (!verifyMilestoneEvidence(milestone, baseline, evidence)) throw new Error("The complete immutable model proof is unavailable or does not validate this milestone. No construction was granted.");
  const building: Building = { id: existing?.id ?? context.id(), gx: plot.gx, gy: plot.gy, kind: variant.kind,
    grownAt: context.now(), runId: baseline.runId,
    milestone: `${variant.label} · level ${milestone.level}. Validated combined-policy model milestone; not field certification or physical construction.`,
    milestoneId: milestone.id, family: milestone.family, variantId: variant.id, plotId: plot.id,
    rotation: request.rotation, level: milestone.level, proof: milestone.proof };
  const event: GrowthEvent = { kind: existing ? "building.upgraded" : "building.grown", runId: baseline.runId,
    building, message: building.milestone };
  return { world: { ...world, buildings: existing ? world.buildings.map((item) => item.id === existing.id ? building : item) : [...world.buildings, building],
    pendingMilestones: world.pendingMilestones?.filter((item) => item.id !== milestone.id) }, events: [event] };
}
