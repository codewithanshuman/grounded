import { z } from "zod";
import { LocationId, MicrogridConfig, PresetId } from "./index.js";

const config = MicrogridConfig.superRefine((value, context) => {
  if (!Object.values(value).every(Number.isFinite)) context.addIssue({ code: "custom", message: "Every physical parameter must be finite." });
  if (!Number.isInteger(value.homesCount) || !Number.isInteger(value.evCount)) context.addIssue({ code: "custom", message: "Homes and EV chargers must be whole numbers." });
  if (value.batteryCapacityKWh > 0 && value.batteryStartPct < value.batteryMinSocPct) context.addIssue({ code: "custom", message: "Starting battery charge is below the minimum safe charge." });
  if (value.clinicalTier0Pct + value.clinicalTier1Pct + value.clinicalTier2Pct > 100) context.addIssue({ code: "custom", message: "Clinical Tier 0, 1 and 2 shares cannot exceed 100%." });
  if (value.generatorCapacityKW > 0 && value.generatorFuelCapacityKWh <= 0) context.addIssue({ code: "custom", message: "A configured generator needs a positive usable fuel-energy budget." });
});
export const SimulationRequest = z.object({
  location: LocationId, preset: PresetId, config,
  scenarioCount: z.number().int().min(100).max(10_000),
  siteDataProfileId: z.string().min(1).default("ausgrid-measured-reference-v1"),
});
export const SweepRequest = SimulationRequest.omit({ preset: true }).extend({
  scenarioCount: z.number().int().min(100).max(2_000).default(500),
});
export const OptimizationRequest = z.object({
  runId: z.string().min(1), riskTargetPct: z.number().finite().positive().max(100).default(5),
  budgetCapex: z.number().finite().min(0).max(100_000_000).optional(),
});

/** Predetermined cohort size, before seeing results. At most 2,000 modeled
 * evaluations; tighter targets can remain unresolved rather than silently
 * spending unbounded compute or pretending zero failures proves zero risk. */
export function validationCohortSize(targetPct: number, hazardCount: number): number {
  if (!Number.isFinite(targetPct) || targetPct <= 0 || targetPct > 100 || !Number.isInteger(hazardCount) || hazardCount < 1) throw new Error("Invalid validation sampling plan.");
  const clusters = targetPct === 100 ? 1 : Math.ceil(Math.log(0.05) / Math.log(1 - targetPct / 100));
  return Math.min(2_000, Math.max(200, Math.ceil(clusters * hazardCount / 50) * 50));
}
