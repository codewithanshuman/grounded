import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteDataProfile, type SiteDataProfile as SiteDataProfileType } from "@verdant/protocol";
import { z } from "zod";

const MAX_CSV_CHARS = 8_000_000;
const PROFILE_DIRECTORY = process.env.SITE_PROFILE_DIR ?? fileURLToPath(new URL("../../../data/site-profiles/", import.meta.url));

export const CommissionSiteBody = z.object({
  siteName: z.string().trim().min(2).max(80),
  timezone: z.string().trim().min(1).max(80).default("Asia/Kolkata"),
  pvCapacityKW: z.number().positive().max(1_000_000),
  demandFileName: z.string().trim().min(1).max(180),
  pvFileName: z.string().trim().min(1).max(180),
  outageFileName: z.string().trim().min(1).max(180),
  demandCsv: z.string().min(20).max(MAX_CSV_CHARS),
  pvCsv: z.string().min(20).max(MAX_CSV_CHARS),
  outageCsv: z.string().min(20).max(MAX_CSV_CHARS),
});
export type CommissionSiteInput = z.infer<typeof CommissionSiteBody>;

type IntervalRow = { timestamp: number; dateKey: string; slot: number; value: number };
type OutageRow = { startedAt: number; restoredAt: number; durationHours: number; cause: string };

const round = (value: number, digits = 4) => Number(value.toFixed(digits));
const clamp = (value: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, value));
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value.trim());
      value = "";
    } else value += character;
  }
  values.push(value.trim());
  return values;
}

function parseCsv(text: string): { headers: string[]; records: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) throw new Error("CSV must contain a header and at least one data row");
  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
  return { headers, records: lines.slice(1).map(parseCsvLine) };
}

function columnIndex(headers: string[], accepted: string[]): number {
  const index = headers.findIndex((header) => accepted.includes(header));
  if (index < 0) throw new Error(`Missing required column. Expected one of: ${accepted.join(", ")}`);
  return index;
}

function zonedParts(timestamp: number, timezone: string): { dateKey: string; slot: number } {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = formatterCache.get(timezone) ?? new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    formatterCache.set(timezone, formatter);
  } catch {
    throw new Error(`Unknown IANA timezone: ${timezone}`);
  }
  const parts = Object.fromEntries(formatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  return { dateKey: `${parts.year}-${parts.month}-${parts.day}`, slot: hour * 4 + Math.floor(minute / 15) };
}

function parseIntervals(csv: string, timezone: string, valueColumns: string[]): IntervalRow[] {
  const { headers, records } = parseCsv(csv);
  const timestampIndex = columnIndex(headers, ["timestamp", "datetime", "date_time", "time"]);
  const valueIndex = columnIndex(headers, valueColumns);
  const deduplicated = new Map<number, IntervalRow>();
  for (const record of records) {
    const timestamp = Date.parse(record[timestampIndex]);
    const value = Number(record[valueIndex]);
    if (!Number.isFinite(timestamp) || !Number.isFinite(value) || value < 0) continue;
    const { dateKey, slot } = zonedParts(timestamp, timezone);
    deduplicated.set(timestamp, { timestamp, dateKey, slot, value });
  }
  const rows = [...deduplicated.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length < 96) throw new Error("Each interval file needs at least 96 valid timestamped readings");
  return rows;
}

function parseOutages(csv: string): OutageRow[] {
  const { headers, records } = parseCsv(csv);
  const startIndex = columnIndex(headers, ["outage_started_at", "started_at", "start_time", "start"]);
  const restoredIndex = columnIndex(headers, ["restored_at", "restoration_time", "end_time", "end"]);
  const causeIndex = headers.findIndex((header) => ["cause", "reason", "event_cause"].includes(header));
  const rows: OutageRow[] = [];
  for (const record of records) {
    const startedAt = Date.parse(record[startIndex]);
    const restoredAt = Date.parse(record[restoredIndex]);
    if (!Number.isFinite(startedAt) || !Number.isFinite(restoredAt) || restoredAt <= startedAt) continue;
    rows.push({ startedAt, restoredAt, durationHours: (restoredAt - startedAt) / 3_600_000, cause: causeIndex >= 0 ? record[causeIndex] || "Unknown" : "Unknown" });
  }
  if (!rows.length) throw new Error("Outage CSV needs at least one valid start/restoration pair");
  return rows.sort((a, b) => a.startedAt - b.startedAt);
}

function profileFromIntervals(rows: IntervalRow[]): number[] {
  const sums = Array(96).fill(0);
  const counts = Array(96).fill(0);
  rows.forEach((row) => { sums[row.slot] += row.value; counts[row.slot]++; });
  return sums.map((sum, slot) => counts[slot] ? sum / counts[slot] : 0);
}

function splitRows(rows: IntervalRow[]): { train: IntervalRow[]; holdout: IntervalRow[]; trainDays: number; holdoutDays: number } {
  const dates = [...new Set(rows.map((row) => row.dateKey))].sort();
  const holdoutDates = new Set(dates.filter((_, index) => index % 5 === 4));
  return {
    train: rows.filter((row) => !holdoutDates.has(row.dateKey)),
    holdout: rows.filter((row) => holdoutDates.has(row.dateKey)),
    trainDays: dates.length - holdoutDates.size,
    holdoutDays: holdoutDates.size,
  };
}

function errors(predicted: number[], observed: number[], scale = 1): { mae: number; rmse: number } {
  const values = predicted.map((value, index) => value - observed[index]);
  return {
    mae: round(values.reduce((sum, value) => sum + Math.abs(value), 0) / values.length * scale, 3),
    rmse: round(Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0) / values.length) * scale, 3),
  };
}

function quantile(sorted: number[], q: number): number {
  const index = q * (sorted.length - 1);
  const lower = Math.floor(index);
  const fraction = index - lower;
  return sorted[lower] * (1 - fraction) + sorted[Math.min(sorted.length - 1, lower + 1)] * fraction;
}

function ksStatistic(leftValues: number[], rightValues: number[]): number {
  if (!leftValues.length || !rightValues.length) return 1;
  const left = [...leftValues].sort((a, b) => a - b);
  const right = [...rightValues].sort((a, b) => a - b);
  let i = 0; let j = 0; let max = 0;
  while (i < left.length || j < right.length) {
    const value = Math.min(left[i] ?? Infinity, right[j] ?? Infinity);
    while (i < left.length && left[i] <= value) i++;
    while (j < right.length && right[j] <= value) j++;
    max = Math.max(max, Math.abs(i / left.length - j / right.length));
  }
  return max;
}

function completeness(rows: IntervalRow[]): number {
  const expected = Math.floor((rows.at(-1)!.timestamp - rows[0].timestamp) / 900_000) + 1;
  return round(clamp(rows.length / Math.max(1, expected) * 100, 0, 100), 2);
}

export function createCommissionedSiteProfile(input: CommissionSiteInput): SiteDataProfileType {
  const demandRows = parseIntervals(input.demandCsv, input.timezone, ["demand_kw", "load_kw", "power_kw", "kw"]);
  const pvRows = parseIntervals(input.pvCsv, input.timezone, ["pv_kw", "generation_kw", "solar_kw", "power_kw", "kw"]);
  const outageRows = parseOutages(input.outageCsv);
  const demandProfileKW = profileFromIntervals(demandRows);
  const meanDemandKW = demandProfileKW.reduce((sum, value) => sum + value, 0) / 96;
  const pvProfileKW = profileFromIntervals(pvRows);
  const demandSplit = splitRows(demandRows);
  const pvSplit = splitRows(pvRows);
  const demandTrain = profileFromIntervals(demandSplit.train);
  const demandHoldout = profileFromIntervals(demandSplit.holdout);
  const demandTrainMean = demandTrain.reduce((sum, value) => sum + value, 0) / 96;
  const demandHoldoutMean = demandHoldout.reduce((sum, value) => sum + value, 0) / 96;
  const demandError = errors(demandTrain.map((value) => value / Math.max(1e-9, demandTrainMean)), demandHoldout.map((value) => value / Math.max(1e-9, demandHoldoutMean)), 100);
  const pvTrain = profileFromIntervals(pvSplit.train).map((value) => clamp(value / input.pvCapacityKW, 0, 1));
  const pvHoldout = profileFromIntervals(pvSplit.holdout).map((value) => clamp(value / input.pvCapacityKW, 0, 1));
  const pvError = errors(pvTrain, pvHoldout);
  const durations = outageRows.map((row) => row.durationHours).sort((a, b) => a - b);
  const outageTrain = outageRows.filter((_, index) => index % 5 !== 4).map((row) => row.durationHours);
  const outageHoldout = outageRows.filter((_, index) => index % 5 === 4).map((row) => row.durationHours);
  const outageKs = ksStatistic(outageTrain, outageHoldout);
  const spanYears = Math.max(1, (outageRows.at(-1)!.startedAt - outageRows[0].startedAt) / (365.25 * 86_400_000));
  const causeCounts: Record<string, number> = {};
  outageRows.forEach((row) => { causeCounts[row.cause] = (causeCounts[row.cause] ?? 0) + 1; });
  const demandCompletenessPct = completeness(demandRows);
  const pvCompletenessPct = completeness(pvRows);
  const validationStatus = demandSplit.holdoutDays >= 6 && pvSplit.holdoutDays >= 6 && demandError.mae <= 15 && pvError.mae <= 0.1 && (outageRows.length < 30 || outageKs <= 0.35) ? "PASS" : "REVIEW";
  const status = demandCompletenessPct >= 95 && pvCompletenessPct >= 95 && demandSplit.trainDays + demandSplit.holdoutDays >= 30 && outageRows.length >= 1 && validationStatus === "PASS" ? "VERIFIED_SITE" : "REVIEW";
  const firstDemand = new Date(demandRows[0].timestamp).toISOString();
  const lastDemand = new Date(demandRows.at(-1)!.timestamp).toISOString();
  const firstPv = new Date(pvRows[0].timestamp).toISOString();
  const lastPv = new Date(pvRows.at(-1)!.timestamp).toISOString();
  const firstOutage = new Date(outageRows[0].startedAt).toISOString();
  const lastOutage = new Date(outageRows.at(-1)!.startedAt).toISOString();
  const profileWithoutIdentity = {
    label: `${input.siteName} commissioned data`, scope: "COMMISSIONED_SITE" as const, status,
    demand: { station: input.siteName, firstDate: firstDemand, lastDate: lastDemand, readings: demandRows.length, completeSlots: demandProfileKW.filter((value) => value > 0).length, meanMW: round(meanDemandKW / 1000, 4), peakMW: round(Math.max(...demandRows.map((row) => row.value)) / 1000, 4), multiplier15m: demandProfileKW.map((value) => round(value / Math.max(1e-9, meanDemandKW), 5)) },
    pv: { firstDate: firstPv, lastDate: lastPv, readings: pvRows.length, customers: 1, nativeResolutionMinutes: 15, normalizedResolutionMinutes: 15 as const, capacityFactor15m: pvProfileKW.map((value) => round(clamp(value / input.pvCapacityKW, 0, 1), 5)) },
    reliability: {
      period: `${firstOutage.slice(0, 10)} to ${lastOutage.slice(0, 10)}`,
      saidiMinutesPerCustomerYear: round(outageRows.reduce((sum, row) => sum + row.durationHours * 60, 0) / spanYears, 3),
      saifiInterruptionsPerCustomerYear: round(outageRows.length / spanYears, 3),
      meanRestorationHours: round(durations.reduce((sum, value) => sum + value, 0) / durations.length, 3),
      sourceResolution: "uploaded event-level site outage/restoration log",
      eventCount: outageRows.length, firstEventDate: firstOutage, lastEventDate: lastOutage,
      customersInterrupted: outageRows.length,
      medianRestorationHours: round(quantile(durations, 0.5), 3), p90RestorationHours: round(quantile(durations, 0.9), 3), p95RestorationHours: round(quantile(durations, 0.95), 3),
      durationQuantilesHours: Array.from({ length: 101 }, (_, index) => round(quantile(durations, index / 100), 4)), causeCounts,
    },
    sources: [
      { kind: "DEMAND" as const, authority: input.siteName, title: "Commissioned 15-minute demand meter export", fileName: input.demandFileName, period: `${firstDemand.slice(0, 10)} to ${lastDemand.slice(0, 10)}`, nativeResolutionMinutes: 15, measured: true },
      { kind: "PV" as const, authority: input.siteName, title: "Commissioned 15-minute PV inverter export", fileName: input.pvFileName, period: `${firstPv.slice(0, 10)} to ${lastPv.slice(0, 10)}`, nativeResolutionMinutes: 15, measured: true },
      { kind: "OUTAGE" as const, authority: input.siteName, title: "Commissioned outage and restoration event log", fileName: input.outageFileName, period: `${firstOutage.slice(0, 10)} to ${lastOutage.slice(0, 10)}`, nativeResolutionMinutes: null, measured: true },
    ],
    quality: { demandCompletenessPct, pvCompletenessPct, targetResolutionMinutes: 15 as const, demandMethod: "Observed site demand grouped by local quarter-hour", pvMethod: "Observed inverter kW divided by commissioned array capacity", outageMethod: "Empirical event-duration quantiles and observed annual event frequency" },
    validation: {
      method: "Blocked temporal holdout: every fifth observed day/event withheld before profile comparison", status: validationStatus,
      demand: { trainDays: demandSplit.trainDays, holdoutDays: demandSplit.holdoutDays, maePct: demandError.mae, rmsePct: demandError.rmse },
      pv: { trainDays: pvSplit.trainDays, holdoutDays: pvSplit.holdoutDays, maeCapacityFactor: pvError.mae, rmseCapacityFactor: pvError.rmse },
      outage: { trainEvents: outageTrain.length, holdoutEvents: outageHoldout.length, ksStatistic: round(outageKs, 4), medianShiftHours: outageHoldout.length ? round(Math.abs(quantile([...outageTrain].sort((a, b) => a - b), 0.5) - quantile([...outageHoldout].sort((a, b) => a - b), 0.5)), 3) : 0 },
    },
    disclosure: `Commissioned from files uploaded for ${input.siteName}. Quality status is ${status}; Grounded does not independently certify meter calibration or ownership.`,
  };
  const fingerprint = `SITE-${createHash("sha256").update(JSON.stringify(profileWithoutIdentity)).digest("hex").slice(0, 12).toUpperCase()}`;
  const slug = input.siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "site";
  return SiteDataProfile.parse({ id: `${slug}-${fingerprint.slice(5).toLowerCase()}`, fingerprint, ...profileWithoutIdentity });
}

export async function persistCommissionedProfile(profile: SiteDataProfileType): Promise<void> {
  await mkdir(PROFILE_DIRECTORY, { recursive: true });
  await writeFile(join(PROFILE_DIRECTORY, `${profile.id}.json`), `${JSON.stringify(profile, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function loadCommissionedProfiles(): Promise<SiteDataProfileType[]> {
  try {
    const names = (await readdir(PROFILE_DIRECTORY)).filter((name) => name.endsWith(".json"));
    const profiles = await Promise.all(names.map(async (name) => SiteDataProfile.parse(JSON.parse(await readFile(join(PROFILE_DIRECTORY, name), "utf8")))));
    return profiles.sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
