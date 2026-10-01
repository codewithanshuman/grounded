import { MicrogridConfig as ConfigSchema, type LocationId, type MicrogridConfig, type PresetId, type RunSummary } from "@verdant/protocol";

export { analysisInputKey, inputsForRun, criticalRiskInterval, assessRun, type AnalysisInputs } from "@verdant/sim/decisionReadiness";
import { inputsForRun, type AnalysisInputs } from "@verdant/sim/decisionReadiness";

export function changedRunInputs(run: RunSummary, input: AnalysisInputs): string[] {
  const recorded = inputsForRun(run);
  return [
    recorded.locationId !== input.locationId && "region",
    recorded.preset !== input.preset && "hazard",
    recorded.scenarioCount !== input.scenarioCount && "population",
    recorded.siteDataProfileId !== input.siteDataProfileId && "data source",
    Object.keys(recorded.config).some((key) => recorded.config[key as keyof MicrogridConfig] !== input.config[key as keyof MicrogridConfig]) && "system configuration",
  ].filter((item): item is string => Boolean(item));
}

export function inputIssues(input: AnalysisInputs): string[] {
  const parsed = ConfigSchema.safeParse(input.config);
  const issues = parsed.success ? [] : parsed.error.issues.map((issue) => `${String(issue.path[0])}: ${issue.message}`);
  if (!Number.isInteger(input.scenarioCount) || input.scenarioCount < 500 || input.scenarioCount > 10_000) issues.push("Choose a population between 500 and 10,000 whole futures.");
  if (!Number.isInteger(input.config.homesCount) || !Number.isInteger(input.config.evCount)) issues.push("Homes and EV chargers must be whole numbers.");
  if (input.config.batteryCapacityKWh > 0 && input.config.batteryStartPct < input.config.batteryMinSocPct) issues.push("Starting charge must be at or above the minimum safe charge.");
  return issues;
}

/** Serial UI operation tickets. Late responses cannot own a different input/account context. */
export class AnalysisGate {
  private serial = 0;
  private active: { id: number; context: string } | null = null;
  begin(context: string) {
    if (this.active) return null;
    this.active = { id: ++this.serial, context };
    return this.active;
  }
  accepts(ticket: { id: number; context: string }, currentContext: string) {
    return this.active?.id === ticket.id && ticket.context === currentContext;
  }
  finish(ticket: { id: number; context: string }) {
    if (this.active?.id !== ticket.id) return false;
    this.active = null;
    return true;
  }
  invalidate() { this.active = null; this.serial++; }
}
