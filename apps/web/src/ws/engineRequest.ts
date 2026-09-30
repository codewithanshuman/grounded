import { LocationId, MicrogridConfig, PresetId } from "@verdant/protocol";

export function parseAnalysisRequest(args: Record<string, unknown>, sweep = false) {
  const location = LocationId.parse(args.location);
  const preset = sweep ? "normal" as const : PresetId.parse(args.preset);
  const config = MicrogridConfig.parse(args.config);
  const scenarioCount = args.scenarioCount ?? (sweep ? 500 : undefined);
  if (typeof scenarioCount !== "number" || !Number.isInteger(scenarioCount) || scenarioCount < 1 || scenarioCount > 10_000) throw new Error("Scenario count must be a whole number between 1 and 10,000.");
  if (!Number.isInteger(config.homesCount) || !Number.isInteger(config.evCount)) throw new Error("Homes and EV chargers must be whole numbers.");
  if (config.batteryCapacityKWh > 0 && config.batteryStartPct < config.batteryMinSocPct) throw new Error("Starting battery charge is below the minimum safe charge.");
  return { location, preset, config, scenarioCount };
}

export const isAnalysisOperation = (op: string) => op === "simulate" || op === "sweep" || op === "optimize";
