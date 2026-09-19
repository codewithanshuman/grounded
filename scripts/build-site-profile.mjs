import { createReadStream } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { dirname } from "node:path";

const zonePath = process.argv[2];
const solarPath = process.argv[3];
const outagePath = process.argv[4];
const outputPath = process.argv[5];
if (!zonePath || !solarPath || !outagePath || !outputPath) {
  throw new Error("Usage: node scripts/build-site-profile.mjs <zone.csv> <solar.csv> <outages.csv> <output.json>");
}

const parseTime = (value, minutesPerSlot, endOfInterval = false) => {
  const [hourText, minuteText] = value.split(":");
  const minutes = Number(hourText) * 60 + Number(minuteText);
  const raw = Math.round(minutes / minutesPerSlot) - (endOfInterval ? 1 : 0);
  return ((raw % (1440 / minutesPerSlot)) + 1440 / minutesPerSlot) % (1440 / minutesPerSlot);
};
const round = (value, digits = 4) => Number(value.toFixed(digits));
const dateSortKey = (value) => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [day, month, year] = value.split("/").map(Number);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
const splitBlockedHoldout = (keys) => {
  const sorted = [...keys].sort((a, b) => dateSortKey(a).localeCompare(dateSortKey(b)));
  return {
    train: new Set(sorted.filter((_, index) => index % 5 !== 4)),
    holdout: new Set(sorted.filter((_, index) => index % 5 === 4)),
  };
};
const profileFromDays = (dailyValues, keys, slots) => {
  const sums = Array(slots).fill(0);
  const counts = Array(slots).fill(0);
  for (const key of keys) {
    const values = dailyValues.get(key);
    if (!values) continue;
    values.forEach((value, slot) => {
      if (!Number.isFinite(value)) return;
      sums[slot] += value;
      counts[slot]++;
    });
  }
  return sums.map((sum, slot) => counts[slot] ? sum / counts[slot] : 0);
};
const errorMetrics = (predicted, observed, scale = 1) => {
  const errors = predicted.map((value, index) => value - observed[index]);
  return {
    mae: round(errors.reduce((sum, value) => sum + Math.abs(value), 0) / errors.length * scale, 3),
    rmse: round(Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / errors.length) * scale, 3),
  };
};
const quantileFromSorted = (values, q) => {
  const index = q * (values.length - 1);
  const lower = Math.floor(index);
  const fraction = index - lower;
  return values[lower] * (1 - fraction) + values[Math.min(values.length - 1, lower + 1)] * fraction;
};
const ksStatistic = (a, b) => {
  const left = [...a].sort((x, y) => x - y);
  const right = [...b].sort((x, y) => x - y);
  let i = 0;
  let j = 0;
  let max = 0;
  while (i < left.length || j < right.length) {
    const value = Math.min(left[i] ?? Infinity, right[j] ?? Infinity);
    while (i < left.length && left[i] <= value) i++;
    while (j < right.length && right[j] <= value) j++;
    max = Math.max(max, Math.abs(i / left.length - j / right.length));
  }
  return max;
};

async function buildDemandProfile() {
  const input = createInterface({ input: createReadStream(zonePath), crlfDelay: Infinity });
  let header = null;
  const sums = Array(96).fill(0);
  const counts = Array(96).fill(0);
  let firstDate = "";
  let lastDate = "";
  let station = "";
  let peakMW = 0;
  const dailyValues = new Map();
  for await (const line of input) {
    const columns = line.split(",");
    if (!header) { header = columns; continue; }
    station ||= columns[1];
    firstDate ||= columns[2];
    lastDate = columns[2];
    const values = Array(96).fill(Number.NaN);
    for (let index = 4; index < header.length; index++) {
      const value = Number(columns[index]);
      if (!Number.isFinite(value) || value < 0) continue;
      const slot = parseTime(header[index], 15, true);
      sums[slot] += value;
      counts[slot]++;
      values[slot] = value;
      peakMW = Math.max(peakMW, value);
    }
    dailyValues.set(columns[2], values);
  }
  const means = sums.map((sum, index) => sum / Math.max(1, counts[index]));
  const meanMW = means.reduce((sum, value) => sum + value, 0) / means.length;
  const split = splitBlockedHoldout(dailyValues.keys());
  const trainProfile = profileFromDays(dailyValues, split.train, 96);
  const holdoutProfile = profileFromDays(dailyValues, split.holdout, 96);
  const trainMean = trainProfile.reduce((sum, value) => sum + value, 0) / trainProfile.length;
  const holdoutMean = holdoutProfile.reduce((sum, value) => sum + value, 0) / holdoutProfile.length;
  const demandErrors = errorMetrics(trainProfile.map((value) => value / trainMean), holdoutProfile.map((value) => value / holdoutMean), 100);
  return { profile: {
    station,
    firstDate,
    lastDate,
    readings: counts.reduce((sum, value) => sum + value, 0),
    completeSlots: counts.filter((value) => value > 0).length,
    meanMW: round(meanMW, 3),
    peakMW: round(peakMW, 3),
    multiplier15m: means.map((value) => round(value / meanMW, 5)),
  }, validation: { trainDays: split.train.size, holdoutDays: split.holdout.size, maePct: demandErrors.mae, rmsePct: demandErrors.rmse } };
}

async function buildPvProfile() {
  const input = createInterface({ input: createReadStream(solarPath), crlfDelay: Infinity });
  let header = null;
  const energySums = Array(48).fill(0);
  const capacityIntervalSums = Array(48).fill(0);
  let firstDate = "";
  let lastDate = "";
  let readings = 0;
  let customers = new Set();
  const dailyEnergy = new Map();
  const dailyCapacity = new Map();
  for await (const line of input) {
    const columns = line.split(",");
    if (!header) {
      if (columns[0] === "Customer") header = columns;
      continue;
    }
    if (columns[3] !== "GG") continue;
    const capacityKW = Number(columns[1]);
    if (!Number.isFinite(capacityKW) || capacityKW <= 0) continue;
    customers.add(columns[0]);
    firstDate ||= columns[4];
    lastDate = columns[4];
    if (!dailyEnergy.has(columns[4])) dailyEnergy.set(columns[4], Array(48).fill(0));
    if (!dailyCapacity.has(columns[4])) dailyCapacity.set(columns[4], Array(48).fill(0));
    for (let index = 5; index < 53; index++) {
      const energyKWh = Number(columns[index]);
      if (!Number.isFinite(energyKWh) || energyKWh < 0) continue;
      const slot = parseTime(header[index], 30, true);
      energySums[slot] += energyKWh;
      capacityIntervalSums[slot] += capacityKW * 0.5;
      dailyEnergy.get(columns[4])[slot] += energyKWh;
      dailyCapacity.get(columns[4])[slot] += capacityKW * 0.5;
      readings++;
    }
  }
  const halfHourly = energySums.map((sum, index) => sum / Math.max(1e-9, capacityIntervalSums[index]));
  const capacityFactor15m = Array.from({ length: 96 }, (_, slot) => {
    const halfIndex = Math.floor(slot / 2);
    if (slot % 2 === 0) return halfHourly[halfIndex];
    return (halfHourly[halfIndex] + halfHourly[(halfIndex + 1) % 48]) / 2;
  }).map((value) => round(Math.max(0, Math.min(1, value)), 5));
  const dailyFactors = new Map([...dailyEnergy.entries()].map(([date, values]) => [date, values.map((value, slot) => value / Math.max(1e-9, dailyCapacity.get(date)[slot]))]));
  const split = splitBlockedHoldout(dailyFactors.keys());
  const trainProfile = profileFromDays(dailyFactors, split.train, 48);
  const holdoutProfile = profileFromDays(dailyFactors, split.holdout, 48);
  const pvErrors = errorMetrics(trainProfile, holdoutProfile);
  return { profile: {
    firstDate,
    lastDate,
    readings,
    customers: customers.size,
    nativeResolutionMinutes: 30,
    normalizedResolutionMinutes: 15,
    capacityFactor15m,
  }, validation: { trainDays: split.train.size, holdoutDays: split.holdout.size, maeCapacityFactor: pvErrors.mae, rmseCapacityFactor: pvErrors.rmse } };
}

async function buildOutageProfile() {
  const input = createInterface({ input: createReadStream(outagePath), crlfDelay: Infinity });
  let header = null;
  const durationsHours = [];
  const causeCounts = {};
  let customersInterrupted = 0;
  let firstEventDate = "";
  let lastEventDate = "";
  const events = [];
  for await (const line of input) {
    const columns = line.split(",");
    if (!header) { header = columns; continue; }
    const date = columns[2];
    const customers = Number(columns[4]);
    const durationMinutes = Number(columns[5]);
    const reason = columns.slice(6).join(",").trim() || "Unknown";
    if (!date || !Number.isFinite(customers) || customers < 0 || !Number.isFinite(durationMinutes) || durationMinutes <= 0) continue;
    durationsHours.push(durationMinutes / 60);
    events.push({ date, durationHours: durationMinutes / 60 });
    customersInterrupted += Math.round(customers);
    causeCounts[reason] = (causeCounts[reason] ?? 0) + 1;
    if (!firstEventDate || date < firstEventDate) firstEventDate = date;
    if (!lastEventDate || date > lastEventDate) lastEventDate = date;
  }
  durationsHours.sort((a, b) => a - b);
  if (!durationsHours.length) throw new Error("No valid outage events were found");
  const quantile = (q) => quantileFromSorted(durationsHours, q);
  events.sort((a, b) => a.date.localeCompare(b.date));
  const trainDurations = events.filter((_, index) => index % 5 !== 4).map((event) => event.durationHours);
  const holdoutDurations = events.filter((_, index) => index % 5 === 4).map((event) => event.durationHours);
  return { profile: {
    eventCount: durationsHours.length,
    firstEventDate,
    lastEventDate,
    customersInterrupted,
    meanRestorationHours: round(durationsHours.reduce((sum, value) => sum + value, 0) / durationsHours.length, 3),
    medianRestorationHours: round(quantile(0.5), 3),
    p90RestorationHours: round(quantile(0.9), 3),
    p95RestorationHours: round(quantile(0.95), 3),
    durationQuantilesHours: Array.from({ length: 101 }, (_, index) => round(quantile(index / 100), 4)),
    causeCounts: Object.fromEntries(Object.entries(causeCounts).sort((a, b) => b[1] - a[1])),
  }, validation: {
    trainEvents: trainDurations.length,
    holdoutEvents: holdoutDurations.length,
    ksStatistic: round(ksStatistic(trainDurations, holdoutDurations), 4),
    medianShiftHours: round(Math.abs(quantileFromSorted([...trainDurations].sort((a, b) => a - b), 0.5) - quantileFromSorted([...holdoutDurations].sort((a, b) => a - b), 0.5)), 3),
  } };
}

const demandResult = await buildDemandProfile();
const pvResult = await buildPvProfile();
const outageResult = await buildOutageProfile();
const demand = demandResult.profile;
const pv = pvResult.profile;
const outages = outageResult.profile;
const profileWithoutFingerprint = {
  id: "ausgrid-measured-reference-v1",
  label: "Ausgrid measured network reference",
  scope: "PUBLIC_REFERENCE",
  status: "VERIFIED_REFERENCE",
  demand,
  pv,
  reliability: {
    period: `${outages.firstEventDate} to ${outages.lastEventDate}`,
    saidiMinutesPerCustomerYear: 73.09,
    saifiInterruptionsPerCustomerYear: 0.58,
    meanRestorationHours: outages.meanRestorationHours,
    sourceResolution: "individual historical outage events plus annual audited network indices",
    ...outages,
  },
  sources: [
    {
      kind: "DEMAND",
      authority: "Ausgrid",
      title: "Auburn 33/11 kV zone substation FY2025 raw interval demand",
      url: "https://www.ausgrid.com.au/about-us/about-ausgrid/research-data-sets/distribution-zone-substation-data",
      period: `${demand.firstDate} to ${demand.lastDate}`,
      nativeResolutionMinutes: 15,
      measured: true,
    },
    {
      kind: "PV",
      authority: "Ausgrid",
      title: "300 Solar Homes gross-metered PV generation",
      url: "https://data.gov.au/data/dataset/solar-home-electricity-data",
      period: `${pv.firstDate} to ${pv.lastDate}`,
      nativeResolutionMinutes: 30,
      measured: true,
    },
    {
      kind: "OUTAGE",
      authority: "Ausgrid",
      title: `${outages.eventCount.toLocaleString("en-US")} past outage and restoration-duration records`,
      url: "https://data.peclet.com.au/explore/dataset/ausgrid-past-outages/table/",
      period: `${outages.firstEventDate} to ${outages.lastEventDate}`,
      nativeResolutionMinutes: null,
      measured: true,
    },
    {
      kind: "OUTAGE",
      authority: "Ausgrid",
      title: "FY2025 audited SAIDI and SAIFI network reliability indices",
      url: "https://sc-cd.ausgrid.com.au/-/media/Documents/sustainability/FY25-Ausgrid-Business-and-Sustainability-Review.pdf",
      period: "FY2024-25",
      nativeResolutionMinutes: null,
      measured: true,
    },
  ],
  quality: {
    demandCompletenessPct: round(demand.readings / (365 * 96) * 100, 2),
    pvCompletenessPct: round(pv.readings / (pv.customers * 365 * 48) * 100, 2),
    targetResolutionMinutes: 15,
    demandMethod: "Mean measured MW by quarter-hour, normalized to a unit daily load shape",
    pvMethod: "Capacity-weighted gross-metered generation; linear half-hour to quarter-hour interpolation",
    outageMethod: "Empirical event-duration quantiles drive restoration sampling; audited FY2025 SAIFI sets annual outage frequency",
  },
  validation: {
    method: "Blocked temporal holdout: every fifth observed day/event withheld before profile comparison",
    status: demandResult.validation.maePct <= 10 && pvResult.validation.maeCapacityFactor <= 0.05 && outageResult.validation.ksStatistic <= 0.1 ? "PASS" : "REVIEW",
    demand: demandResult.validation,
    pv: pvResult.validation,
    outage: outageResult.validation,
  },
  disclosure: "Measured public reference cohort from the Ausgrid network in New South Wales. It is not Jaipur site telemetry and must not be represented as local commissioning data.",
};
const fingerprint = `SITE-${createHash("sha256").update(JSON.stringify(profileWithoutFingerprint)).digest("hex").slice(0, 12).toUpperCase()}`;
const profile = { ...profileWithoutFingerprint, fingerprint };
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(profile, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, fingerprint, demand: demand.readings, pv: pv.readings, customers: pv.customers, outageEvents: outages.eventCount }, null, 2));
