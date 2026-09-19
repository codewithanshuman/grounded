import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ClimateCalibration, ClimateMonth, HistoricalClimateDay, LocationId } from "@verdant/protocol";
import { LOCATIONS, clamp } from "@verdant/sim";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const COORDINATES: Record<LocationId, { latitude: number; longitude: number }> = {
  jaipur: { latitude: 26.9124, longitude: 75.7873 },
  phoenix: { latitude: 33.4484, longitude: -112.074 },
  miami: { latitude: 25.7617, longitude: -80.1918 },
  seattle: { latitude: 47.6062, longitude: -122.3321 },
};
const CACHE_PATH = process.env.GROUNDED_CLIMATE_CACHE_PATH ?? "./climate-cache.json";
const memory = new Map<LocationId, ClimateCalibration>();

try {
  if (existsSync(CACHE_PATH)) {
    const stored = JSON.parse(readFileSync(CACHE_PATH, "utf8")) as Partial<Record<LocationId, ClimateCalibration>>;
    for (const [id, calibration] of Object.entries(stored)) if (calibration) memory.set(id as LocationId, calibration);
  }
} catch {
  // A corrupt optional cache must never stop the resilience engine.
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16).toUpperCase();
}

function qualityFor(calibration: Pick<ClimateCalibration, "source" | "monthly" | "historicalDays">): NonNullable<ClimateCalibration["quality"]> {
  const records = [...calibration.monthly, ...calibration.historicalDays];
  const values = records.flatMap((item) => [item.meanTempC, item.maxTempC, item.solarKWhM2Day, item.cloudPct]);
  const complete = values.filter((value) => Number.isFinite(value) && value !== -999).length;
  return {
    coverageMonths: calibration.monthly.length,
    historicalPeriods: calibration.historicalDays.length,
    fieldCompletenessPct: values.length ? Math.round((complete / values.length) * 1000) / 10 : 0,
    observedFields: ["Mean temperature", "Maximum temperature", "Surface solar irradiance", "Cloud amount"],
    status: calibration.source === "NASA_POWER" ? "verified" : "fallback",
  };
}

function fallback(location: LocationId): ClimateCalibration {
  const base = LOCATIONS[location];
  const coordinates = COORDINATES[location];
  const annualSolar = base.irradianceScale * 5;
  const annualCloud = clamp((base.cloudBase / 0.65) * 100, 5, 85);
  const monthly: ClimateMonth[] = MONTHS.map((month, index) => {
    const seasonal = Math.cos(((index - 5) / 12) * Math.PI * 2);
    const inverseSeason = location === "miami" ? 0.3 : 1;
    return {
      month,
      meanTempC: Math.round((base.baseTemp - 9 + seasonal * 9 * inverseSeason) * 100) / 100,
      maxTempC: Math.round((base.baseTemp - 3 + seasonal * 10 * inverseSeason) * 100) / 100,
      solarKWhM2Day: Math.round(clamp(annualSolar + seasonal * 1.25, 1.2, 8) * 100) / 100,
      cloudPct: Math.round(clamp(annualCloud - seasonal * 10, 3, 92) * 100) / 100,
    };
  });
  const payload = { location, coordinates, monthly };
  const historicalDays: HistoricalClimateDay[] = monthly.map((item, index) => ({
    date: `REFERENCE-${String(index + 1).padStart(2, "0")}`,
    meanTempC: item.meanTempC,
    maxTempC: item.maxTempC,
    solarKWhM2Day: item.solarKWhM2Day,
    cloudPct: item.cloudPct,
  }));
  const calibration: ClimateCalibration = {
    source: "REFERENCE_FALLBACK",
    status: "fallback",
    period: "Bundled representative climatology",
    ...coordinates,
    meanTempC: Math.round(monthly.reduce((sum, item) => sum + item.meanTempC, 0) / 12 * 100) / 100,
    maxTempC: Math.max(...monthly.map((item) => item.maxTempC)),
    solarKWhM2Day: Math.round(monthly.reduce((sum, item) => sum + item.solarKWhM2Day, 0) / 12 * 100) / 100,
    cloudPct: Math.round(monthly.reduce((sum, item) => sum + item.cloudPct, 0) / 12 * 100) / 100,
    fingerprint: fingerprint(payload),
    fetchedAt: Date.now(),
    monthly,
    historicalDays,
  };
  calibration.quality = qualityFor(calibration);
  return calibration;
}

export async function loadClimateCalibration(location: LocationId): Promise<ClimateCalibration> {
  const existing = memory.get(location);
  if (existing?.historicalDays?.length) {
    const cached = {
      ...existing,
      status: existing.source === "NASA_POWER" ? "cached" as const : "fallback" as const,
      period: existing.source === "NASA_POWER"
        ? "NASA POWER climatology + 2023 observed climate replay cohort"
        : existing.period,
    };
    return { ...cached, quality: qualityFor(cached) };
  }

  const coordinates = COORDINATES[location];
  const query = new URLSearchParams({
    parameters: "ALLSKY_SFC_SW_DWN,T2M,T2M_MAX,CLOUD_AMT",
    community: "RE",
    longitude: String(coordinates.longitude),
    latitude: String(coordinates.latitude),
    format: "JSON",
  });
  try {
    const dailyQuery = new URLSearchParams({
      parameters: "ALLSKY_SFC_SW_DWN,T2M,T2M_MAX,CLOUD_AMT",
      community: "RE",
      longitude: String(coordinates.longitude),
      latitude: String(coordinates.latitude),
      start: "20230101",
      end: "20231231",
      format: "JSON",
    });
    const [response, dailyResponse] = await Promise.all([
      fetch(`https://power.larc.nasa.gov/api/temporal/climatology/point?${query}`, { signal: AbortSignal.timeout(12000) }),
      fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?${dailyQuery}`, { signal: AbortSignal.timeout(12000) }),
    ]);
    if (!response.ok || !dailyResponse.ok) throw new Error(`NASA POWER ${response.status}/${dailyResponse.status}`);
    const json = await response.json() as { properties?: { parameter?: Record<string, Record<string, number>> } };
    const dailyJson = await dailyResponse.json() as { properties?: { parameter?: Record<string, Record<string, number>> } };
    const parameters = json.properties?.parameter;
    if (!parameters) throw new Error("NASA POWER response missing parameters");
    const monthly: ClimateMonth[] = MONTHS.map((month) => ({
      month,
      meanTempC: parameters.T2M?.[month],
      maxTempC: parameters.T2M_MAX?.[month],
      solarKWhM2Day: parameters.ALLSKY_SFC_SW_DWN?.[month],
      cloudPct: parameters.CLOUD_AMT?.[month],
    }));
    if (monthly.some((item) => Object.values(item).some((value) => value == null))) throw new Error("NASA POWER response incomplete");
    const daily = dailyJson.properties?.parameter;
    if (!daily) throw new Error("NASA POWER daily response missing parameters");
    const historicalDays: HistoricalClimateDay[] = Object.keys(daily.T2M_MAX ?? {}).map((date) => ({
      date,
      meanTempC: daily.T2M?.[date] ?? -999,
      maxTempC: daily.T2M_MAX?.[date] ?? -999,
      solarKWhM2Day: daily.ALLSKY_SFC_SW_DWN?.[date] ?? -999,
      cloudPct: daily.CLOUD_AMT?.[date] ?? -999,
    })).filter((item) => Object.values(item).every((value) => value != null && value !== -999))
      .sort((a, b) => (b.maxTempC - b.solarKWhM2Day * 1.8 + b.cloudPct * 0.08) - (a.maxTempC - a.solarKWhM2Day * 1.8 + a.cloudPct * 0.08))
      .slice(0, 12);
    if (historicalDays.length < 12) throw new Error("NASA POWER daily backtest cohort incomplete");
    const raw = { location, coordinates, monthly, historicalDays };
    const calibration: ClimateCalibration = {
      source: "NASA_POWER",
      status: "live",
      period: "NASA POWER climatology + 2023 observed climate replay cohort",
      ...coordinates,
      meanTempC: parameters.T2M.ANN,
      maxTempC: parameters.T2M_MAX.ANN,
      solarKWhM2Day: parameters.ALLSKY_SFC_SW_DWN.ANN,
      cloudPct: parameters.CLOUD_AMT.ANN,
      fingerprint: fingerprint(raw),
      fetchedAt: Date.now(),
      monthly,
      historicalDays,
    };
    calibration.quality = qualityFor(calibration);
    memory.set(location, calibration);
    try { writeFileSync(CACHE_PATH, JSON.stringify(Object.fromEntries(memory), null, 2)); } catch { /* cache is optional */ }
    return calibration;
  } catch {
    const calibration = fallback(location);
    memory.set(location, calibration);
    return calibration;
  }
}
