import { MicrogridConfig as ConfigSchema, type LocationId, type MicrogridConfig, type PresetId, type RunSummary } from "@verdant/protocol";

export interface AnalysisInputs {
  locationId: LocationId;
  preset: PresetId;
  config: MicrogridConfig;
  scenarioCount: number;
  siteDataProfileId: string;
}

/** Exact equality key, not a short hash: a collision must never unlock stale evidence. */
export function analysisInputKey(input: AnalysisInputs): string {
  return JSON.stringify([input.locationId, input.preset, input.scenarioCount, input.siteDataProfileId,
    Object.entries(input.config).sort(([a], [b]) => a.localeCompare(b))]);
}

export function inputsForRun(run: RunSummary): AnalysisInputs {
  return { locationId: run.location, preset: run.preset, config: { ...run.config }, scenarioCount: run.n,
    siteDataProfileId: run.siteData?.id ?? "representative-model" };
}

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

export function criticalRiskInterval(failures: number, total: number) {
  if (total <= 0 || failures < 0 || failures > total) return null;
  const p = failures / total, z2 = 1.96 ** 2, denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius = 1.96 * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total) / denominator;
  return { observedPct: p * 100, lowPct: Math.max(0, center - radius) * 100, highPct: Math.min(1, center + radius) * 100 };
}

export function assessRun(run: RunSummary, targetPct: number) {
  const interval = criticalRiskInterval(run.counts.critical, run.n);
  const countValid = Object.values(run.counts).every((count) => Number.isInteger(count) && count >= 0)
    && Object.values(run.counts).reduce((sum, count) => sum + count, 0) === run.n;
  const audited = countValid && run.audit?.status === "PASS" && run.audit.checks.length > 0
    && run.audit.checks.every((check) => check.passed) && run.manifest?.deterministicReplay === true;
  return { interval, audited, withinTarget: audited && !!interval && interval.highPct <= targetPct };
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
