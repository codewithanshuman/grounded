import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SiteDataProfile, type SiteDataProfile as SiteDataProfileType } from "@verdant/protocol";
import { z } from "zod";

const MAX_CSV_CHARS = 8_000_000;
const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;
const OffsetTimestamp = z.string().datetime({ offset: true });
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
  outageObservationWindow: z.object({
    startedAt: OffsetTimestamp,
    endedAt: OffsetTimestamp,
    // The uploader attests that no observed days/events have been omitted.
    // This is not independent verification of the log or permission to publish it.
    continuousCoverage: z.literal(true),
  }).refine((window) => Date.parse(window.endedAt) > Date.parse(window.startedAt), "Outage observation end must be later than start"),
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

function parseCsv(text: string, allowEmpty = false): { headers: string[]; records: string[][] } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length || (!allowEmpty && lines.length < 2)) throw new Error("CSV must contain a header and at least one data row");
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
    if (!OffsetTimestamp.safeParse(record[timestampIndex]).success || !Number.isFinite(timestamp) || timestamp % 900_000 !== 0 || !record[valueIndex]?.trim() || !Number.isFinite(value) || value < 0) {
      throw new Error("Every interval requires an offset-aware quarter-hour timestamp and a finite nonnegative measurement; invalid rows cannot be silently omitted");
    }
    if (deduplicated.has(timestamp)) throw new Error("Duplicate interval timestamps require review; they cannot be silently overwritten");
    const { dateKey, slot } = zonedParts(timestamp, timezone);
    deduplicated.set(timestamp, { timestamp, dateKey, slot, value });
  }
  const rows = [...deduplicated.values()].sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length < 96) throw new Error("Each interval file needs at least 96 valid timestamped readings");
  return rows;
}

function parseOutages(csv: string, window: CommissionSiteInput["outageObservationWindow"]): OutageRow[] {
  const { headers, records } = parseCsv(csv, true);
  const startIndex = columnIndex(headers, ["outage_started_at", "started_at", "start_time", "start"]);
  const restoredIndex = columnIndex(headers, ["restored_at", "restoration_time", "end_time", "end"]);
  const causeIndex = headers.findIndex((header) => ["cause", "reason", "event_cause"].includes(header));
  const rows: OutageRow[] = [];
  for (const record of records) {
    const startedAt = Date.parse(record[startIndex]);
    const restoredAt = Date.parse(record[restoredIndex]);
    if (!OffsetTimestamp.safeParse(record[startIndex]).success || !OffsetTimestamp.safeParse(record[restoredIndex]).success || !Number.isFinite(startedAt) || !Number.isFinite(restoredAt) || restoredAt <= startedAt) {
      throw new Error("Every outage row requires valid offset-aware timestamps and a restoration later than start; invalid rows cannot be silently omitted");
    }
    if (startedAt < Date.parse(window.startedAt) || startedAt >= Date.parse(window.endedAt) || restoredAt > Date.parse(window.endedAt)) {
      throw new Error("Every outage must start and restore within the declared observation window; boundary-censored events require a separately reviewed model");
    }
    rows.push({ startedAt, restoredAt, durationHours: (restoredAt - startedAt) / 3_600_000, cause: causeIndex >= 0 ? record[causeIndex] || "Unknown" : "Unknown" });
  }
  rows.sort((a, b) => a.startedAt - b.startedAt);
  if (rows.some((row, index) => index > 0 && row.startedAt < rows[index - 1].restoredAt)) {
    throw new Error("Site supply-point outage events must not overlap or be duplicated");
  }
  return rows;
}

// Lanczos log-gamma and regularized upper-gamma CDF let the exact count interval
// remain stable for large logs without factorial overflow or normal approximations.
function logGamma(value: number): number {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531, -176.6150291621406, 12.507343278686905, -0.13857109526572012, 9.984369578019572e-6, 1.5056327351493116e-7];
  const x = value - 1;
  let sum = 0.99999999999980993;
  coefficients.forEach((coefficient, index) => { sum += coefficient / (x + index + 1); });
  const t = x + coefficients.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(sum);
}

function gammaUpperCdf(shape: number, value: number): number {
  if (value === 0) return 1;
  const scale = Math.exp(-value + shape * Math.log(value) - logGamma(shape));
  if (value < shape + 1) {
    let term = 1 / shape;
    let sum = term;
    for (let iteration = 1; iteration <= 10_000; iteration++) {
      term *= value / (shape + iteration);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-14) return clamp(1 - sum * scale, 0, 1);
    }
  } else {
    const floor = 1e-300;
    let b = value + 1 - shape;
    let c = 1 / floor;
    let d = 1 / Math.max(floor, b);
    let product = d;
    for (let iteration = 1; iteration <= 10_000; iteration++) {
      const coefficient = -iteration * (iteration - shape);
      b += 2;
      d = coefficient * d + b;
      if (Math.abs(d) < floor) d = floor;
      c = b + coefficient / c;
      if (Math.abs(c) < floor) c = floor;
      d = 1 / d;
      const delta = d * c;
      product *= delta;
      if (Math.abs(delta - 1) < 1e-14) return clamp(scale * product, 0, 1);
    }
  }
  throw new Error("Exact outage-count interval failed to converge; cannot commission uncertainty estimates");
}

function gammaQuantile(shape: number, upperProbability: number): number {
  let lower = 0;
  let upper = Math.max(1, shape * 2);
  while (gammaUpperCdf(shape, upper) > upperProbability) upper *= 2;
  for (let iteration = 0; iteration < 90; iteration++) {
    const midpoint = (lower + upper) / 2;
    if (gammaUpperCdf(shape, midpoint) > upperProbability) lower = midpoint;
    else upper = midpoint;
  }
  return (lower + upper) / 2;
}

export function outageFrequencyInterval95(events: number, exposureYears: number): { lowerInterruptionsPerYear: number; upperInterruptionsPerYear: number } {
  if (!Number.isInteger(events) || events < 0 || !Number.isFinite(exposureYears) || exposureYears <= 0) throw new Error("Outage uncertainty requires a nonnegative integer count and positive observation exposure");
  // Garwood equal-tailed 95% limits: gamma(.025,n), gamma(.975,n+1).
  // https://www.statsdirect.com/help/rates/poisson_rate_ci.htm
  return {
    lowerInterruptionsPerYear: events === 0 ? 0 : gammaQuantile(events, 0.975) / exposureYears,
    upperInterruptionsPerYear: gammaQuantile(events + 1, 0.025) / exposureYears,
  };
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

/** Only retain complete local days: a repeated/missing DST slot is not silently
 * interpolated. Demand and PV must share the exact 96 UTC timestamps. */
function pairedMeasuredDays(input: CommissionSiteInput, demandRows: IntervalRow[], pvRows: IntervalRow[]): SiteDataProfileType["empiricalDays"] {
  function completeDays(rows: IntervalRow[]) {
    const grouped = new Map<string, IntervalRow[]>();
    rows.forEach((row) => grouped.set(row.dateKey, [...(grouped.get(row.dateKey) ?? []), row]));
    const complete = new Map<string, IntervalRow[]>();
    const excluded: string[] = [];
    for (const [date, values] of grouped) {
      const ordered = [...values].sort((a, b) => a.slot - b.slot);
      if (ordered.length === 96 && ordered.every((row, slot) => row.slot === slot && (slot === 0 || row.timestamp - ordered[slot - 1].timestamp === 900_000))) complete.set(date, ordered);
      else excluded.push(date);
    }
    return { complete, excluded: excluded.sort() };
  }
  const demand = completeDays(demandRows);
  const pv = completeDays(pvRows);
  const dates = [...new Set([...demand.complete.keys(), ...pv.complete.keys()])].sort();
  const pairedDates = dates.filter((date) => demand.complete.has(date) && pv.complete.has(date)
    && demand.complete.get(date)!.every((row, index) => row.timestamp === pv.complete.get(date)![index].timestamp));
  if (!pairedDates.length) throw new Error("No complete paired local demand/PV day remains. Supply matching 96-slot days; incomplete or daylight-saving days are not interpolated.");
  const hash = (value: string) => createHash("sha256").update(value).digest("hex");
  const trainingDates = pairedDates.filter((_, index) => index % 5 !== 4);
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const demandMeans = trainingDates.map((date) => mean(demand.complete.get(date)!.map((row) => row.value))).sort((a, b) => a - b);
  const pvMeans = trainingDates.map((date) => mean(pv.complete.get(date)!.map((row) => row.value))).sort((a, b) => a - b);
  const days = pairedDates.map((date, index) => {
    const demandKW = demand.complete.get(date)!.map((row) => row.value);
    const pvKW = pv.complete.get(date)!.map((row) => row.value);
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    return { date, demandKW, pvKW, fingerprint: hash(JSON.stringify({ date, demandKW, pvKW })), dayOfWeek,
      dayType: dayOfWeek === 0 || dayOfWeek === 6 ? "WEEKEND" as const : "WEEKDAY" as const,
      highLoad: mean(demandKW) > quantile(demandMeans, 0.75), lowPvOutput: mean(pvKW) < quantile(pvMeans, 0.25),
      partition: index % 5 === 4 ? "HOLDOUT" as const : "TRAIN" as const };
  });
  const excludedUnpairedDates = dates.filter((date) => !pairedDates.includes(date));
  const normalizationMeanDemandKW = mean(days.filter((day) => day.partition === "TRAIN").flatMap((day) => day.demandKW));
  const dataset = { timezone: input.timezone, inverterCapacityKW: input.pvCapacityKW, normalizationMeanDemandKW, days };
  return { version: 1, resolutionMinutes: 15, ...dataset, datasetSha256: hash(JSON.stringify(dataset)),
    demandSourceSha256: hash(input.demandCsv), pvSourceSha256: hash(input.pvCsv),
    trainingDays: trainingDates.length, holdoutDays: pairedDates.length - trainingDates.length,
    excludedIncompleteDemandDates: demand.excluded, excludedIncompletePvDates: pv.excluded, excludedUnpairedDates,
    classification: "Local weekday/weekend from the declared timezone; high load means daily mean above training-day Q75; low PV means daily energy below training-day Q25. Low PV is not an observed cloud/weather label.",
    disclosure: "Paired local days retain measured demand/PV covariance. Every fifth complete paired date is withheld from scenario sampling. Complete consecutive three-day training blocks are preferred; independent paired-day draws are disclosed when unavailable. Profiles scale observed demand to configured flexible load and PV to configured inverter capacity; stress overlays are simulated, not additional observed telemetry. Missing and DST days are excluded without interpolation; no claims of seasonal coverage or independent field validation." };
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
  // Also validate direct library callers, not only the HTTP boundary.
  input = CommissionSiteBody.parse(input);
  const demandRows = parseIntervals(input.demandCsv, input.timezone, ["demand_kw", "load_kw", "power_kw", "kw"]);
  const pvRows = parseIntervals(input.pvCsv, input.timezone, ["pv_kw", "generation_kw", "solar_kw", "power_kw", "kw"]);
  if (pvRows.some((row) => row.value > input.pvCapacityKW)) throw new Error("PV measurements exceed the declared inverter capacity; verify units, installed capacity and sensor export before commissioning");
  const outageRows = parseOutages(input.outageCsv, input.outageObservationWindow);
  const empiricalDays = pairedMeasuredDays(input, demandRows, pvRows);
  const demandProfileKW = profileFromIntervals(demandRows);
  const meanDemandKW = demandProfileKW.reduce((sum, value) => sum + value, 0) / 96;
  const pvProfileKW = profileFromIntervals(pvRows);
  const pairedPartitions = new Map(empiricalDays!.days.map((day) => [day.date, day.partition]));
  const splitPairedRows = (rows: IntervalRow[]) => ({
    train: rows.filter((row) => pairedPartitions.get(row.dateKey) === "TRAIN"),
    holdout: rows.filter((row) => pairedPartitions.get(row.dateKey) === "HOLDOUT"),
    trainDays: empiricalDays!.trainingDays, holdoutDays: empiricalDays!.holdoutDays,
  });
  const demandSplit = splitPairedRows(demandRows);
  const pvSplit = splitPairedRows(pvRows);
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
  const observedMs = Date.parse(input.outageObservationWindow.endedAt) - Date.parse(input.outageObservationWindow.startedAt);
  const spanYears = observedMs / YEAR_MS;
  const observationDays = observedMs / DAY_MS;
  const frequencyInterval95 = outageFrequencyInterval95(outageRows.length, spanYears);
  const causeCounts: Record<string, number> = {};
  outageRows.forEach((row) => { causeCounts[row.cause] = (causeCounts[row.cause] ?? 0) + 1; });
  const demandCompletenessPct = completeness(demandRows);
  const pvCompletenessPct = completeness(pvRows);
  const demandStatus = meanDemandKW > 0 && demandCompletenessPct >= 95 && demandSplit.trainDays + demandSplit.holdoutDays >= 30 && demandSplit.holdoutDays >= 6 && demandError.mae <= 15 ? "VERIFIED" as const : "REVIEW" as const;
  const pvStatus = pvRows.some((row) => row.value > 0) && pvCompletenessPct >= 95 && pvSplit.trainDays + pvSplit.holdoutDays >= 30 && pvSplit.holdoutDays >= 6 && pvError.mae <= 0.1 ? "VERIFIED" as const : "REVIEW" as const;
  const sufficientReliabilityHistory = observationDays >= 365.25 && outageRows.length >= 30 && outageHoldout.length >= 6;
  const reliabilityStatus = !sufficientReliabilityHistory ? "INSUFFICIENT_HISTORY" as const : outageKs <= 0.35 ? "VERIFIED" as const : "REVIEW" as const;
  const status = demandStatus === "VERIFIED" && pvStatus === "VERIFIED" && reliabilityStatus === "VERIFIED" ? "VERIFIED_SITE" : demandStatus === "VERIFIED" || pvStatus === "VERIFIED" || reliabilityStatus === "VERIFIED" ? "PARTIALLY_VERIFIED" : "REVIEW";
  const validationStatus = status === "VERIFIED_SITE" ? "PASS" : "REVIEW";
  const limitations = [
    "Quality gates validate uploaded data internally; they do not independently certify meter calibration, ownership, complete event reporting or field safety.",
    "Frequency interval assumes stationary independent Poisson interruptions at one site supply point; it excludes reporting bias, climate trends and event clustering.",
  ];
  if (!sufficientReliabilityHistory) limitations.push(`Reliability history is insufficient: ${round(observationDays, 2)} observation days and ${outageRows.length} events; at least 365.25 days and 30 events with 6 holdouts are required for joint frequency/duration verification. Use a disclosed reference prior, not the sparse site estimate, for simulation.`);
  if (!outageRows.length) limitations.push("Zero recorded outages is not zero risk. No empirical restoration-duration distribution can be fitted from this log.");
  if (reliabilityStatus === "REVIEW") limitations.push("The outage-duration holdout differs from the fitted history; reliability calibration requires review before model use.");
  const firstDemand = new Date(demandRows[0].timestamp).toISOString();
  const lastDemand = new Date(demandRows.at(-1)!.timestamp).toISOString();
  const firstPv = new Date(pvRows[0].timestamp).toISOString();
  const lastPv = new Date(pvRows.at(-1)!.timestamp).toISOString();
  const firstOutage = outageRows.length ? new Date(outageRows[0].startedAt).toISOString() : undefined;
  const lastOutage = outageRows.length ? new Date(outageRows.at(-1)!.startedAt).toISOString() : undefined;
  const observationStart = new Date(input.outageObservationWindow.startedAt).toISOString();
  const observationEnd = new Date(input.outageObservationWindow.endedAt).toISOString();
  const profileWithoutIdentity = {
    label: `${input.siteName} commissioned data`, scope: "COMMISSIONED_SITE" as const, status,
    evidence: { demand: demandStatus, pv: pvStatus, reliability: reliabilityStatus, overall: status === "VERIFIED_SITE" ? "VERIFIED" : status, limitations },
    demand: { station: input.siteName, firstDate: firstDemand, lastDate: lastDemand, readings: demandRows.length, completeSlots: demandProfileKW.filter((value) => value > 0).length, meanMW: meanDemandKW / 1000, peakMW: round(demandRows.reduce((peak, row) => Math.max(peak, row.value), 0) / 1000, 4), multiplier15m: demandProfileKW.map((value) => round(value / Math.max(1e-9, meanDemandKW), 5)) },
    pv: { firstDate: firstPv, lastDate: lastPv, readings: pvRows.length, customers: 1, nativeResolutionMinutes: 15, normalizedResolutionMinutes: 15 as const, capacityFactor15m: pvProfileKW.map((value) => round(clamp(value / input.pvCapacityKW, 0, 1), 5)) },
    empiricalDays,
    reliability: {
      period: `${observationStart} to ${observationEnd} (end exclusive)`,
      saidiMinutesPerCustomerYear: round(outageRows.reduce((sum, row) => sum + row.durationHours * 60, 0) / spanYears, 3),
      saifiInterruptionsPerCustomerYear: outageRows.length / spanYears,
      meanRestorationHours: durations.length ? round(durations.reduce((sum, value) => sum + value, 0) / durations.length, 3) : 0,
      sourceResolution: "uploaded event-level single-supply-point site outage/restoration log with declared continuous observation exposure",
      eventCount: outageRows.length, firstEventDate: firstOutage, lastEventDate: lastOutage,
      customersInterrupted: outageRows.length,
      ...(durations.length ? { medianRestorationHours: round(quantile(durations, 0.5), 3), p90RestorationHours: round(quantile(durations, 0.9), 3), p95RestorationHours: round(quantile(durations, 0.95), 3), durationQuantilesHours: Array.from({ length: 101 }, (_, index) => round(quantile(durations, index / 100), 4)) } : {}),
      causeCounts,
      observationWindow: { startedAt: observationStart, endedAt: observationEnd, durationDays: observationDays, durationYears: spanYears, continuousCoverage: true as const },
      frequencyInterval95: { method: "EXACT_POISSON" as const, ...frequencyInterval95, assumptions: "Equal-tailed nominal 95% Garwood count interval divided by declared continuous observation years; stationary independent Poisson events and complete reporting at a single site supply point." },
    },
    sources: [
      { kind: "DEMAND" as const, authority: input.siteName, title: "Commissioned 15-minute demand meter export", fileName: input.demandFileName, period: `${firstDemand.slice(0, 10)} to ${lastDemand.slice(0, 10)}`, nativeResolutionMinutes: 15, measured: true },
      { kind: "PV" as const, authority: input.siteName, title: "Commissioned 15-minute PV inverter export", fileName: input.pvFileName, period: `${firstPv.slice(0, 10)} to ${lastPv.slice(0, 10)}`, nativeResolutionMinutes: 15, measured: true },
      { kind: "OUTAGE" as const, authority: input.siteName, title: "Commissioned outage and restoration event log", fileName: input.outageFileName, period: `${observationStart} to ${observationEnd}`, nativeResolutionMinutes: null, measured: true },
    ],
    quality: { demandCompletenessPct, pvCompletenessPct, targetResolutionMinutes: 15 as const, demandMethod: "Observed site demand grouped by local quarter-hour", pvMethod: "Observed inverter kW divided by commissioned array capacity", outageMethod: "Completed event-duration quantiles; count and interrupted minutes divided by explicit observation exposure with exact Poisson frequency limits; sparse histories remain insufficient" },
    validation: {
      method: "Every fifth complete paired local day withheld from scenario sampling and compared with the training profile; every fifth outage event withheld for duration comparison. Seeded policy holdouts are not independent measured-day validation.", status: validationStatus,
      demand: { trainDays: demandSplit.trainDays, holdoutDays: demandSplit.holdoutDays, maePct: demandError.mae, rmsePct: demandError.rmse },
      pv: { trainDays: pvSplit.trainDays, holdoutDays: pvSplit.holdoutDays, maeCapacityFactor: pvError.mae, rmseCapacityFactor: pvError.rmse },
      outage: { trainEvents: outageTrain.length, holdoutEvents: outageHoldout.length, ksStatistic: round(outageKs, 4), medianShiftHours: outageHoldout.length ? round(Math.abs(quantile([...outageTrain].sort((a, b) => a - b), 0.5) - quantile([...outageHoldout].sort((a, b) => a - b), 0.5)), 3) : 0 },
    },
    disclosure: `Commissioned from files uploaded for ${input.siteName}. Load ${demandStatus}; PV ${pvStatus}; reliability ${reliabilityStatus}; overall ${status}. ${limitations.join(" ")}`,
  };
  const fingerprint = `SITE-${createHash("sha256").update(JSON.stringify(profileWithoutIdentity)).digest("hex").slice(0, 12).toUpperCase()}`;
  const slug = input.siteName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 42) || "site";
  return SiteDataProfile.parse({ id: `${slug}-${fingerprint.slice(5).toLowerCase()}`, fingerprint, ...profileWithoutIdentity });
}

export async function persistCommissionedProfile(profile: SiteDataProfileType, directory = PROFILE_DIRECTORY): Promise<void> {
  profile = SiteDataProfile.parse(profile);
  if (profile.scope !== "COMMISSIONED_SITE" || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(profile.id)) throw new Error("Only safe, commissioned site identities can be persisted");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${profile.id}.json`), `${JSON.stringify(profile, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
}

export async function loadCommissionedProfiles(directory = PROFILE_DIRECTORY): Promise<SiteDataProfileType[]> {
  try {
    const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.name.endsWith(".json"));
    const profiles: SiteDataProfileType[] = [];
    for (const entry of entries) {
      try {
        // Do not follow symlinks/junctions to telemetry outside the profile store.
        if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Not a regular profile file");
        const profile = SiteDataProfile.parse(JSON.parse(await readFile(join(directory, entry.name), "utf8")));
        if (profile.scope !== "COMMISSIONED_SITE" || !/^[a-z0-9][a-z0-9_-]{0,127}$/.test(profile.id) || entry.name !== `${profile.id}.json`) throw new Error("Profile identity does not match its file");
        profiles.push(profile);
      } catch {
        // Retain the original untouched for explicit review/recommissioning.
        // Never log JSON, validation paths, site names or private measurements.
        console.warn(`Skipping invalid commissioned profile: ${entry.name}`);
      }
    }
    return profiles.sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
