import type { ClimateCalibration, ClimateMonth, Intervention, LocationId, MicrogridConfig, PresetId, RiskBucket, RiskSurrogate, RunSummary, ScenarioResult, SensitivityResult, SiteDataProfile } from "@verdant/protocol";

/* ============================================================================
 * The energy model. Every quantity the UI ever shows is produced here — no
 * step of this file is decorative. Kept free of any I/O (no fetch, no DOM,
 * no persistence) so it can be unit-tested as pure functions, the same
 * discipline claude-clan-main uses for its worldgen/layout packages.
 * ========================================================================== */

export const DT = 0.25; // hours per simulated step
export const STEPS = 288; // 72h / 15min: three-day compound-event horizon
export const MODEL_VERSION = "2.6.0";

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** Compact deterministic evidence identifier. It is a traceability checksum,
 * not a security primitive: identical model inputs always produce the same ID. */
export function evidenceFingerprint(value: unknown): string {
  const input = stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `GRD-${(hash >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const seedFor = (i: number): number => ((i + 1) * 0x9e3779b1) >>> 0;
export const gaussian = (x: number, peak: number, width: number): number =>
  Math.exp(-((x - peak) ** 2) / (2 * width * width));
export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
export function fmtHour(h: number): string {
  const hh = Math.floor(h) % 24;
  const mm = Math.round((h - Math.floor(h)) * 60);
  const mm2 = mm === 60 ? 0 : mm;
  const hh2 = mm === 60 ? (hh + 1) % 24 : hh;
  const clock = `${String(hh2).padStart(2, "0")}:${String(mm2).padStart(2, "0")}`;
  return h >= 24 ? `D${Math.floor(h / 24) + 1} ${clock}` : clock;
}

/** 95% Wilson score interval for a Monte Carlo event probability. Unlike a
 * naive +/- margin, this remains well behaved near 0% and 100%. */
export function wilsonInterval(successes: number, total: number, z = 1.96): { lowPct: number; highPct: number; marginPct: number } {
  if (total <= 0) return { lowPct: 0, highPct: 0, marginPct: 0 };
  const p = clamp(successes / total, 0, 1);
  const z2 = z * z;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius = (z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)) / denominator;
  const lowPct = Math.max(0, center - radius) * 100;
  const highPct = Math.min(1, center + radius) * 100;
  return {
    lowPct: Math.round(lowPct * 10) / 10,
    highPct: Math.round(highPct * 10) / 10,
    marginPct: Math.round(radius * 1000) / 10,
  };
}

interface SurrogateObservation {
  features: number[];
  failed: boolean;
}

const SURROGATE_FEATURES = [
  { id: "severity", label: "Compound-hazard severity" },
  { id: "outage_duration", label: "Outage duration" },
  { id: "cloud_duration", label: "Cloud-event duration" },
  { id: "solar_energy", label: "Available solar energy" },
  { id: "outage_timing", label: "Outage timing" },
];

const sigmoid = (value: number): number => value >= 0
  ? 1 / (1 + Math.exp(-value))
  : Math.exp(value) / (1 + Math.exp(value));

/** Interpretable diagnostic model trained only after exact dispatch completes.
 * It never controls dispatch or optimization: its job is to approximate the
 * simulator on an untouched temporal seed partition and reveal whether a
 * compact set of physical drivers can explain failure risk. */
export function trainRiskSurrogate(observations: SurrogateObservation[]): RiskSurrogate {
  const training = observations.filter((_, index) => index % 5 !== 4);
  const holdout = observations.filter((_, index) => index % 5 === 4);
  const positives = training.filter((item) => item.failed).length;
  const holdoutPositives = holdout.filter((item) => item.failed).length;
  const eventRatePct = observations.length ? (observations.filter((item) => item.failed).length / observations.length) * 100 : 0;
  const unavailable = positives < 5 || training.length - positives < 5 || holdoutPositives < 2 || holdout.length - holdoutPositives < 2;
  const base = {
    method: "Standardized L2 logistic surrogate · deterministic every-fifth-seed holdout",
    authority: "Advisory explanation only — exact 15-minute dispatch remains the decision authority",
    trainingSize: training.length,
    holdoutSize: holdout.length,
    eventRatePct: Math.round(eventRatePct * 10) / 10,
    disclosure: "The surrogate summarizes simulator behavior; it is not a forecast, dispatch controller or substitute for the physics audit.",
  };
  if (unavailable) return { ...base, status: "UNAVAILABLE", auc: null, brierScore: null, calibrationErrorPct: null, balancedAccuracyPct: null, threshold: null, coefficients: [] };

  const featureCount = SURROGATE_FEATURES.length;
  const means = Array.from({ length: featureCount }, (_, feature) => training.reduce((sum, row) => sum + row.features[feature], 0) / training.length);
  const scales = means.map((mean, feature) => Math.max(1e-6, Math.sqrt(training.reduce((sum, row) => sum + (row.features[feature] - mean) ** 2, 0) / training.length)));
  const normalize = (features: number[]) => features.map((value, index) => (value - means[index]) / scales[index]);
  const weights = new Array(featureCount + 1).fill(0);
  const positiveWeight = Math.min(8, Math.sqrt((training.length - positives) / positives));
  const learningRate = 0.08;
  const regularization = 0.025;
  for (let iteration = 0; iteration < 900; iteration++) {
    const gradient = new Array(weights.length).fill(0);
    for (const row of training) {
      const x = normalize(row.features);
      const probability = sigmoid(weights[0] + x.reduce((sum, value, index) => sum + value * weights[index + 1], 0));
      const sampleWeight = row.failed ? positiveWeight : 1;
      const error = (probability - (row.failed ? 1 : 0)) * sampleWeight;
      gradient[0] += error;
      for (let feature = 0; feature < featureCount; feature++) gradient[feature + 1] += error * x[feature];
    }
    weights[0] -= learningRate * gradient[0] / training.length;
    for (let feature = 1; feature < weights.length; feature++) {
      weights[feature] -= learningRate * (gradient[feature] / training.length + regularization * weights[feature]);
    }
  }
  const priorCorrection = Math.log(positiveWeight);
  const predict = (row: SurrogateObservation) => {
    const x = normalize(row.features);
    return sigmoid(weights[0] + x.reduce((sum, value, index) => sum + value * weights[index + 1], 0) - priorCorrection);
  };
  let bestThreshold = 0.5;
  let bestBalancedAccuracy = -1;
  for (let threshold = 0.02; threshold <= 0.8; threshold += 0.02) {
    let tp = 0, tn = 0, fp = 0, fn = 0;
    for (const row of training) {
      const predicted = predict(row) >= threshold;
      if (row.failed && predicted) tp++; else if (row.failed) fn++;
      else if (predicted) fp++; else tn++;
    }
    const balanced = ((tp / Math.max(1, tp + fn)) + (tn / Math.max(1, tn + fp))) / 2;
    if (balanced > bestBalancedAccuracy) { bestBalancedAccuracy = balanced; bestThreshold = threshold; }
  }
  const scored = holdout.map((row) => ({ probability: predict(row), failed: row.failed }));
  const positiveScores = scored.filter((row) => row.failed).map((row) => row.probability);
  const negativeScores = scored.filter((row) => !row.failed).map((row) => row.probability);
  let comparisons = 0;
  let wins = 0;
  for (const positive of positiveScores) for (const negative of negativeScores) {
    comparisons++;
    wins += positive > negative ? 1 : positive === negative ? 0.5 : 0;
  }
  const auc = comparisons ? wins / comparisons : 0.5;
  const brierScore = scored.reduce((sum, row) => sum + (row.probability - (row.failed ? 1 : 0)) ** 2, 0) / scored.length;
  let calibrationError = 0;
  for (let bin = 0; bin < 5; bin++) {
    const rows = scored.filter((row) => row.probability >= bin / 5 && (bin === 4 ? row.probability <= 1 : row.probability < (bin + 1) / 5));
    if (!rows.length) continue;
    const confidence = rows.reduce((sum, row) => sum + row.probability, 0) / rows.length;
    const observed = rows.filter((row) => row.failed).length / rows.length;
    calibrationError += (rows.length / scored.length) * Math.abs(confidence - observed);
  }
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const row of scored) {
    const predicted = row.probability >= bestThreshold;
    if (row.failed && predicted) tp++; else if (row.failed) fn++;
    else if (predicted) fp++; else tn++;
  }
  const balancedAccuracy = ((tp / Math.max(1, tp + fn)) + (tn / Math.max(1, tn + fp))) / 2;
  const coefficients = SURROGATE_FEATURES.map((feature, index) => ({
    ...feature,
    coefficient: Math.round(weights[index + 1] * 1000) / 1000,
    direction: weights[index + 1] >= 0 ? "increases" as const : "decreases" as const,
  })).sort((a, b) => Math.abs(b.coefficient) - Math.abs(a.coefficient));
  const status = auc >= 0.65 && calibrationError <= 0.2 && balancedAccuracy >= 0.6 ? "PASS" : "REVIEW";
  return {
    ...base,
    status,
    auc: Math.round(auc * 1000) / 1000,
    brierScore: Math.round(brierScore * 1000) / 1000,
    calibrationErrorPct: Math.round(calibrationError * 1000) / 10,
    balancedAccuracyPct: Math.round(balancedAccuracy * 1000) / 10,
    threshold: Math.round(bestThreshold * 100) / 100,
    coefficients,
  };
}

export interface PresetDef {
  id: PresetId;
  label: string;
  tempAdd: number;
  acBoost: number;
  panelDerate: number;
  stormSolarFactor: number;
  outageProbBase: number;
  evAdd: number;
  cloudEventProb: number;
  blurb: string;
}

export const PRESETS: Record<PresetId, PresetDef> = {
  normal: {
    id: "normal", label: "Normal Conditions", tempAdd: 0, acBoost: 1, panelDerate: 1,
    stormSolarFactor: 1, outageProbBase: 0.03, evAdd: 0, cloudEventProb: 0.18,
    blurb: "Typical daily weather. Baseline resilience check.",
  },
  heatwave: {
    id: "heatwave", label: "Extreme Heatwave", tempAdd: 8, acBoost: 1.2, panelDerate: 0.98,
    stormSolarFactor: 1, outageProbBase: 0.1, evAdd: 0, cloudEventProb: 0.35,
    blurb: "+8\u00b0C \u00b7 sustained AC demand \u00b7 PV temperature loss",
  },
  storm: {
    id: "storm", label: "Severe Storm", tempAdd: 0, acBoost: 1, panelDerate: 1,
    stormSolarFactor: 0.25, outageProbBase: 0.4, evAdd: 0, cloudEventProb: 0.88,
    blurb: "-75% solar generation \u00b7 high outage probability",
  },
  evsurge: {
    id: "evsurge", label: "EV Surge", tempAdd: 0, acBoost: 1, panelDerate: 1,
    stormSolarFactor: 1, outageProbBase: 0.05, evAdd: 80, cloudEventProb: 0.18,
    blurb: "+80 EVs \u00b7 sharp 18:00 charging peak",
  },
  extreme: {
    id: "extreme", label: "Extreme Combined Event", tempAdd: 8, acBoost: 1.25, panelDerate: 0.96,
    stormSolarFactor: 0.4, outageProbBase: 0.5, evAdd: 60, cloudEventProb: 0.82,
    blurb: "Heatwave + low generation + outage, at once",
  },
};
export const PRESET_ORDER: PresetId[] = ["normal", "heatwave", "storm", "evsurge", "extreme"];

export interface LocationDef {
  id: LocationId;
  label: string;
  baseTemp: number;
  cloudBase: number;
  irradianceScale: number;
  siteData?: SiteDataProfile;
}
export const LOCATIONS: Record<LocationId, LocationDef> = {
  jaipur: { id: "jaipur", label: "Jaipur, IN", baseTemp: 34, cloudBase: 0.1, irradianceScale: 1.08 },
  phoenix: { id: "phoenix", label: "Phoenix, US", baseTemp: 37, cloudBase: 0.07, irradianceScale: 1.12 },
  miami: { id: "miami", label: "Miami, US", baseTemp: 30, cloudBase: 0.34, irradianceScale: 0.88 },
  seattle: { id: "seattle", label: "Seattle, US", baseTemp: 20, cloudBase: 0.52, irradianceScale: 0.64 },
};

/** Converts a NASA POWER climatology into the compact location parameters the
 * stochastic engine consumes. The hottest monthly mean anchors the stress-day
 * temperature; solar and cloud values scale the synthetic intra-day profiles. */
export function locationFromCalibration(base: LocationDef, calibration?: ClimateCalibration, month?: ClimateMonth): LocationDef {
  if (!calibration) return base;
  const hottest = calibration.monthly.reduce<ClimateMonth | undefined>((best, item) => !best || item.meanTempC > best.meanTempC ? item : best, undefined);
  const climate = month ?? hottest;
  return {
    ...base,
    baseTemp: climate?.meanTempC ?? calibration.meanTempC,
    irradianceScale: clamp((climate?.solarKWhM2Day ?? calibration.solarKWhM2Day) / 5, 0.5, 1.5),
    cloudBase: clamp(((climate?.cloudPct ?? calibration.cloudPct) / 100) * 0.65, 0.04, 0.7),
  };
}

export function locationWithSiteData(base: LocationDef, siteData?: SiteDataProfile): LocationDef {
  return siteData ? { ...base, siteData } : base;
}

export const DEFAULT_CONFIG: MicrogridConfig = {
  solarCapacityKW: 1800,
  batteryCapacityKWh: 12000,
  batteryStartPct: 90,
  hospitalKW: 180,
  homesCount: 420,
  avgHomeKW: 1.4,
  evCount: 60,
  evChargerKW: 7,
  gridMaxImportKW: 1100,
  batteryMaxChargeKW: 1200,
  batteryMaxDischargeKW: 1200,
  batteryRoundTripEfficiencyPct: 90,
  batteryMinSocPct: 5,
  batteryDegradationCostPerKWh: 0.035,
  gridRestorationMeanHours: 4,
  gridEnergyCostPerKWh: 0.11,
  gridCarbonKgPerKWh: 0.71,
};
export const DEFAULT_INTERVENTION: Intervention = { reservePct: 0, evDelayMin: 0, precoolHour: null };

export interface SimStep {
  hour: number;
  temp: number;
  cloud: number;
  solarKW: number;
  gridOnline: boolean;
  resKW: number;
  evKW: number;
  hospKW: number;
  socPct: number;
  shedKW: number;
  criticalShedKW: number;
  gridUsedKW: number;
  batteryDischargeKW: number;
  batteryChargeKW: number;
  curtailedSolarKW: number;
  energyBalanceErrorKWh: number;
  failed: boolean;
}

export interface DetailedResult extends ScenarioResult {
  steps: SimStep[];
}

/**
 * One simulated 24h future. Priority every step is: hospital first (solar ->
 * grid -> battery, battery may dip into its emergency reserve), then
 * non-critical residential+EV load (solar -> grid -> battery down to the
 * reserve floor). Critical shortfall is recorded at every step so reliability
 * duration, recurrence and recovery can be measured across the full horizon.
 */
export function simulateScenario(
  seed: number,
  location: LocationDef,
  presetId: PresetId,
  config: MicrogridConfig,
  intervention: Intervention,
  detailed: boolean,
): DetailedResult {
  const P = PRESETS[presetId];
  const rng = mulberry32(seed);
  const Emax = config.batteryCapacityKWh;
  let E = Emax * (config.batteryStartPct / 100);
  const physicalFloor = Emax * (config.batteryMinSocPct / 100);
  const reserveEnergy = Emax * (intervention.reservePct / 100);
  const evCount = config.evCount + P.evAdd;
  const roundTripEfficiency = config.batteryRoundTripEfficiencyPct / 100;
  const chargeEfficiency = Math.sqrt(roundTripEfficiency);
  const dischargeEfficiency = Math.sqrt(roundTripEfficiency);
  const severity = (rng() + rng() + rng()) / 3;

  const cloudBase = clamp(location.cloudBase + (rng() - 0.5) * 0.1, 0, 0.9);
  const cloudEvent = rng() < P.cloudEventProb;
  const cloudEventStart = 8 + rng() * 48;
  const cloudEventDur = 5 + rng() * 16;
  const measured72HourOutageProbability = location.siteData
    ? 1 - Math.exp(-(location.siteData.reliability.saifiInterruptionsPerCustomerYear * 72) / (365.25 * 24))
    : null;
  const outageProbability = measured72HourOutageProbability == null
    ? P.outageProbBase
    : measured72HourOutageProbability * (P.outageProbBase / PRESETS.normal.outageProbBase);
  const outageOccurs = rng() < clamp(outageProbability * (0.65 + severity), 0, 0.97);
  const outageStart = P.stormSolarFactor < 1 && cloudEvent ? cloudEventStart + rng() * 3 : 10 + rng() * 48;
  const restorationU = rng();
  const observedRestoration = location.siteData?.reliability.durationQuantilesHours;
  const observedIndex = observedRestoration ? restorationU * (observedRestoration.length - 1) : 0;
  const observedLower = observedRestoration ? Math.floor(observedIndex) : 0;
  const observedFraction = observedIndex - observedLower;
  const baseRestorationHours = observedRestoration
    ? observedRestoration[observedLower] * (1 - observedFraction) + observedRestoration[Math.min(observedRestoration.length - 1, observedLower + 1)] * observedFraction
    : -Math.log(Math.max(1e-6, 1 - restorationU)) * (location.siteData?.reliability.meanRestorationHours ?? config.gridRestorationMeanHours);
  const restorationStressMultiplier = observedRestoration
    ? (0.75 + severity * 0.5) * (P.stormSolarFactor < 1 ? 1.35 : 1)
    : (0.7 + severity * 1.4) * (P.stormSolarFactor < 1 ? 1.45 : 1);
  const outageDur = outageOccurs
    ? clamp(baseRestorationHours * restorationStressMultiplier, 0.5, 36)
    : 0;
  const tempBase = location.baseTemp + P.tempAdd;
  const evPeakHour = 18.5 + intervention.evDelayMin / 60;

  let minSocPct = 100;
  let cause = "None";
  let failed = false;
  let failStep = -1;
  let shedEnergyKWh = 0;
  let criticalEnergyUnservedKWh = 0;
  let batteryThroughputKWh = 0;
  let gridEnergyKWh = 0;
  let solarEnergyKWh = 0;
  let maxEnergyBalanceErrorKWh = 0;
  let totalDemandEnergyKWh = 0;
  // Starting SOC has unknown provenance and is deliberately not credited as
  // renewable. Only solar charged during this run enters this tracked pool.
  let renewableStoredE = 0;
  let solarCurtailedKWh = 0;
  let directSolarToLoadKWh = 0;
  let solarChargedBatteryToLoadKWh = 0;
  let criticalLossDurationHours = 0;
  let currentCriticalLossStreakHours = 0;
  let maxCriticalLossStreakHours = 0;
  let lossOfLoadEvents = 0;
  let peakCriticalShortfallKW = 0;
  let previousStepFailed = false;
  const steps: SimStep[] = [];

  for (let t = 0; t < STEPS; t++) {
    const hour = t * DT;
    const dayHour = hour % 24;
    const dayIndex = Math.floor(hour / 24);
    const temp = tempBase - 4 + 9 * gaussian(dayHour, 15, 4.5) + severity * 2 + dayIndex * P.tempAdd * 0.04;

    let cloud = cloudBase + (rng() - 0.5) * 0.04;
    if (cloudEvent) cloud += (0.92 - cloudBase) * gaussian(hour, cloudEventStart + cloudEventDur / 2, cloudEventDur / 3);
    cloud = clamp(cloud, 0, 0.97);

    const measuredPvFactor = location.siteData?.pv.capacityFactor15m[t % 96];
    const irr = measuredPvFactor == null
      ? (dayHour < 5.5 || dayHour > 19.5 ? 0 : gaussian(dayHour, 12.5, 3.2) * location.irradianceScale)
      : measuredPvFactor * location.irradianceScale;
    const estimatedCellTemp = temp + 20 * Math.min(1, irr);
    const tempEff = Math.max(0.65, 1 - Math.max(0, estimatedCellTemp - 25) * 0.0042) * P.panelDerate;
    const measuredCloudAdjustment = measuredPvFactor == null ? 1 - cloud : clamp(1 - Math.max(0, cloud - cloudBase) * 0.9, 0.08, 1);
    const solarKW = config.solarCapacityKW * Math.max(0, irr * measuredCloudAdjustment) * P.stormSolarFactor * tempEff;
    solarEnergyKWh += solarKW * DT;

    const gridOnline = !(outageOccurs && hour >= outageStart && hour <= outageStart + outageDur);
    const gridCapE = (gridOnline ? config.gridMaxImportKW : 0) * DT;

    const resFactor = location.siteData?.demand.multiplier15m[t % 96]
      ?? 0.55 + 0.25 * gaussian(dayHour, 8, 1.4) + 0.35 * gaussian(dayHour, 19.5, 2.0);
    const acFactor = (1 + Math.max(0, temp - 24) * 0.025) * P.acBoost;
    let resKW = config.homesCount * config.avgHomeKW * resFactor * acFactor;
    if (intervention.precoolHour != null) {
      if (dayHour >= intervention.precoolHour && dayHour < intervention.precoolHour + 1.5) resKW *= 1.18;
      if (dayHour >= 15 && dayHour <= 18.5) resKW *= 0.85;
    }
    resKW *= 0.95 + rng() * 0.1;

    const evFactor = 0.05 + 0.55 * gaussian(dayHour, evPeakHour, 1.6);
    const evKW = evCount * config.evChargerKW * evFactor;
    const hospKW = config.hospitalKW * (0.97 + rng() * 0.06);

    const solarGeneratedE = solarKW * DT;
    const hospitalDemandE = hospKW * DT;
    const flexibleDemandE = (resKW + evKW) * DT;
    totalDemandEnergyKWh += hospitalDemandE + flexibleDemandE;
    let solarE = solarGeneratedE;
    let gridE = gridCapE;
    let dischargeDeliveryRemaining = config.batteryMaxDischargeKW * DT;
    let hospNeed = hospitalDemandE;

    const hFromSolar = Math.min(hospNeed, solarE); solarE -= hFromSolar; hospNeed -= hFromSolar;
    const hFromGrid = Math.min(hospNeed, gridE); gridE -= hFromGrid; hospNeed -= hFromGrid;
    gridEnergyKWh += hFromGrid;
    const hFromBattery = Math.min(hospNeed, Math.max(0, E - physicalFloor) * dischargeEfficiency, dischargeDeliveryRemaining);
    const hBatteryWithdrawal = hFromBattery / dischargeEfficiency;
    const hRenewableWithdrawal = E > 0 ? Math.min(renewableStoredE, hBatteryWithdrawal * (renewableStoredE / E)) : 0;
    renewableStoredE -= hRenewableWithdrawal;
    solarChargedBatteryToLoadKWh += hRenewableWithdrawal * dischargeEfficiency;
    E -= hBatteryWithdrawal;
    batteryThroughputKWh += hBatteryWithdrawal;
    dischargeDeliveryRemaining -= hFromBattery;
    hospNeed -= hFromBattery;
    directSolarToLoadKWh += hFromSolar;

    const stepFailed = hospNeed > 1e-6;
    if (stepFailed) {
      criticalEnergyUnservedKWh += hospNeed;
      criticalLossDurationHours += DT;
      currentCriticalLossStreakHours += DT;
      maxCriticalLossStreakHours = Math.max(maxCriticalLossStreakHours, currentCriticalLossStreakHours);
      peakCriticalShortfallKW = Math.max(peakCriticalShortfallKW, hospNeed / DT);
      if (!previousStepFailed) lossOfLoadEvents++;
      if (!failed) { failed = true; failStep = t; }
      if (!gridOnline) cause = "Grid outage";
      else if (temp > tempBase + 2.5) cause = "Heat-driven demand";
      else if (solarKW < config.solarCapacityKW * 0.15 && dayHour > 7 && dayHour < 18) cause = "Low solar generation";
      else cause = "EV charging";
    } else {
      currentCriticalLossStreakHours = 0;
    }
    previousStepFailed = stepFailed;

    let ncNeed = flexibleDemandE;
    const ncFromSolar = Math.min(ncNeed, solarE); solarE -= ncFromSolar; ncNeed -= ncFromSolar;
    const ncFromGrid = Math.min(ncNeed, gridE); gridE -= ncFromGrid; ncNeed -= ncFromGrid;
    gridEnergyKWh += ncFromGrid;
    const flexibleFloor = Math.max(physicalFloor, reserveEnergy);
    const ncFromBattery = Math.min(ncNeed, Math.max(0, E - flexibleFloor) * dischargeEfficiency, dischargeDeliveryRemaining);
    const ncBatteryWithdrawal = ncFromBattery / dischargeEfficiency;
    const ncRenewableWithdrawal = E > 0 ? Math.min(renewableStoredE, ncBatteryWithdrawal * (renewableStoredE / E)) : 0;
    renewableStoredE -= ncRenewableWithdrawal;
    solarChargedBatteryToLoadKWh += ncRenewableWithdrawal * dischargeEfficiency;
    E -= ncBatteryWithdrawal;
    batteryThroughputKWh += ncBatteryWithdrawal;
    ncNeed -= ncFromBattery;
    shedEnergyKWh += Math.max(0, ncNeed);
    directSolarToLoadKWh += ncFromSolar;

    let batteryChargeInput = 0;
    if (solarE > 0) {
      batteryChargeInput = Math.min(solarE, config.batteryMaxChargeKW * DT, Math.max(0, Emax - E) / chargeEfficiency);
      const stored = batteryChargeInput * chargeEfficiency;
      E += stored;
      renewableStoredE += stored;
      batteryThroughputKWh += stored;
      solarE -= batteryChargeInput;
    }
    E = clamp(E, 0, Emax);
    renewableStoredE = clamp(renewableStoredE, 0, E);

    const gridUsedE = hFromGrid + ncFromGrid;
    const batteryDeliveredE = hFromBattery + ncFromBattery;
    const hospitalServedE = hospitalDemandE - Math.max(0, hospNeed);
    const flexibleServedE = flexibleDemandE - Math.max(0, ncNeed);
    const curtailedSolarE = Math.max(0, solarE);
    solarCurtailedKWh += curtailedSolarE;
    const energyBalanceErrorKWh = Math.abs(
      solarGeneratedE + gridUsedE + batteryDeliveredE -
      hospitalServedE - flexibleServedE - batteryChargeInput - curtailedSolarE,
    );
    maxEnergyBalanceErrorKWh = Math.max(maxEnergyBalanceErrorKWh, energyBalanceErrorKWh);

    const socPct = Emax > 0 ? (E / Emax) * 100 : 0;
    if (socPct < minSocPct) {
      minSocPct = socPct;
      if (!gridOnline) cause = "Grid outage";
      else if (temp > tempBase + 2.5) cause = "Heat-driven demand";
      else if (solarKW < config.solarCapacityKW * 0.15 && dayHour > 7 && dayHour < 18) cause = "Low solar generation";
      else cause = "EV charging";
    }
    if (detailed) {
      steps.push({
        hour, temp, cloud, solarKW, gridOnline, resKW, evKW, hospKW, socPct,
        shedKW: Math.max(0, ncNeed) / DT,
        criticalShedKW: Math.max(0, hospNeed) / DT,
        gridUsedKW: gridUsedE / DT,
        batteryDischargeKW: batteryDeliveredE / DT,
        batteryChargeKW: batteryChargeInput / DT,
        curtailedSolarKW: curtailedSolarE / DT,
        energyBalanceErrorKWh,
        failed: stepFailed,
      });
    }
  }

  const bucket: RiskBucket = failed ? "critical" : minSocPct <= 15 ? "high" : minSocPct <= 40 ? "moderate" : "safe";
  const operationalCost = gridEnergyKWh * config.gridEnergyCostPerKWh + batteryThroughputKWh * config.batteryDegradationCostPerKWh;
  const carbonKg = gridEnergyKWh * config.gridCarbonKgPerKWh;
  const renewableServedKWh = directSolarToLoadKWh + solarChargedBatteryToLoadKWh;
  const avoidedGridCarbonKg = renewableServedKWh * config.gridCarbonKgPerKWh;
  const energyBalanceErrorPct = totalDemandEnergyKWh > 0 ? (maxEnergyBalanceErrorKWh / totalDemandEnergyKWh) * 100 : 0;
  return {
    seed, failed, failStep, minSocPct, cause, bucket, shedEnergyKWh, criticalEnergyUnservedKWh,
    batteryThroughputKWh, gridEnergyKWh, solarEnergyKWh, operationalCost, carbonKg,
    energyBalanceMaxErrorKWh: maxEnergyBalanceErrorKWh, energyBalanceErrorPct,
    criticalLossDurationHours, maxCriticalLossStreakHours, lossOfLoadEvents, peakCriticalShortfallKW,
    solarCurtailedKWh, directSolarToLoadKWh, solarChargedBatteryToLoadKWh, renewableServedKWh,
    avoidedGridCarbonKg, hazardSeverity: severity,
    outageStartHour: outageOccurs ? outageStart : null, outageDurationHours: outageDur,
    cloudEventStartHour: cloudEvent ? cloudEventStart : null, cloudEventDurationHours: cloudEvent ? cloudEventDur : 0,
    steps,
  };
}

export interface MonteCarloResult {
  n: number;
  location: LocationDef;
  preset: PresetId;
  config: MicrogridConfig;
  intervention: Intervention;
  counts: { safe: number; moderate: number; high: number; critical: number };
  causeCounts: Record<string, number>;
  failures: ScenarioResult[];
  surrogate: RiskSurrogate;
  metrics: {
    meanFlexibleUnservedKWh: number;
    meanCriticalUnservedKWh: number;
    meanOperationalCost: number;
    meanCarbonKg: number;
    p95CriticalUnservedKWh: number;
    meanCriticalLossHours: number;
    p95CriticalLossHours: number;
    meanTotalUnservedKWh: number;
    cvar95TotalUnservedKWh: number;
    meanSolarCurtailmentKWh: number;
    meanRenewableServedKWh: number;
    meanAvoidedGridCarbonKg: number;
    solarCapturePct: number;
    criticalRiskPct: number;
    criticalRiskWilsonLowPct: number;
    criticalRiskWilsonHighPct: number;
    criticalRiskMarginPct: number;
    probabilityAnyUnservedPct: number;
    p99TotalUnservedKWh: number;
    cvar99TotalUnservedKWh: number;
    meanLossOfLoadEvents: number;
    meanPeakCriticalShortfallKW: number;
    maxEnergyBalanceErrorKWh: number;
    energyBalanceErrorPct: number;
  };
  audit: {
    countConserved: boolean;
    finiteOutputs: boolean;
    socBounds: boolean;
    deterministicReplay: boolean;
  };
}

export function runMonteCarlo(
  n: number,
  location: LocationDef,
  preset: PresetId,
  config: MicrogridConfig,
  intervention: Intervention,
  seedOffset = 0,
): MonteCarloResult {
  const counts = { safe: 0, moderate: 0, high: 0, critical: 0 };
  const causeCounts: Record<string, number> = {};
  const failures: ScenarioResult[] = [];
  let totalFlexibleUnservedKWh = 0;
  let totalCriticalUnservedKWh = 0;
  let totalOperationalCost = 0;
  let totalCarbonKg = 0;
  let totalCriticalLossHours = 0;
  let totalSolarCurtailmentKWh = 0;
  let totalRenewableServedKWh = 0;
  let totalAvoidedGridCarbonKg = 0;
  let totalSolarGeneratedKWh = 0;
  let anyUnservedCount = 0;
  let totalLossOfLoadEvents = 0;
  let totalPeakCriticalShortfallKW = 0;
  let maxEnergyBalanceErrorKWh = 0;
  let energyBalanceErrorPct = 0;
  let finiteOutputs = true;
  let socBounds = true;
  const criticalUnserved: number[] = [];
  const criticalLossHours: number[] = [];
  const totalUnserved: number[] = [];
  const surrogateObservations: SurrogateObservation[] = [];
  for (let i = 0; i < n; i++) {
    const r = simulateScenario(seedFor(i + seedOffset), location, preset, config, intervention, false);
    counts[r.bucket]++;
    if (r.bucket === "high" || r.bucket === "critical") {
      causeCounts[r.cause] = (causeCounts[r.cause] ?? 0) + 1;
    }
    totalFlexibleUnservedKWh += r.shedEnergyKWh;
    totalCriticalUnservedKWh += r.criticalEnergyUnservedKWh;
    totalOperationalCost += r.operationalCost;
    totalCarbonKg += r.carbonKg;
    totalCriticalLossHours += r.criticalLossDurationHours;
    totalSolarCurtailmentKWh += r.solarCurtailedKWh;
    totalRenewableServedKWh += r.renewableServedKWh;
    totalAvoidedGridCarbonKg += r.avoidedGridCarbonKg;
    totalSolarGeneratedKWh += r.solarEnergyKWh;
    if (r.shedEnergyKWh + r.criticalEnergyUnservedKWh > 1e-6) anyUnservedCount++;
    totalLossOfLoadEvents += r.lossOfLoadEvents;
    totalPeakCriticalShortfallKW += r.peakCriticalShortfallKW;
    maxEnergyBalanceErrorKWh = Math.max(maxEnergyBalanceErrorKWh, r.energyBalanceMaxErrorKWh);
    energyBalanceErrorPct = Math.max(energyBalanceErrorPct, r.energyBalanceErrorPct);
    finiteOutputs = finiteOutputs && [r.minSocPct, r.shedEnergyKWh, r.criticalEnergyUnservedKWh, r.operationalCost, r.carbonKg, r.criticalLossDurationHours, r.solarCurtailedKWh, r.renewableServedKWh].every(Number.isFinite);
    socBounds = socBounds && r.minSocPct >= 0 && r.minSocPct <= 100;
    criticalUnserved.push(r.criticalEnergyUnservedKWh);
    criticalLossHours.push(r.criticalLossDurationHours);
    totalUnserved.push(r.shedEnergyKWh + r.criticalEnergyUnservedKWh);
    surrogateObservations.push({
      failed: r.failed,
      features: [
        r.hazardSeverity,
        r.outageDurationHours,
        r.cloudEventDurationHours,
        r.solarEnergyKWh,
        r.outageStartHour ?? 72,
      ],
    });
    if (r.failed) {
      const { steps: _steps, ...rest } = r;
      failures.push(rest);
    }
  }
  failures.sort((a, b) => a.failStep - b.failStep);
  criticalUnserved.sort((a, b) => a - b);
  criticalLossHours.sort((a, b) => a - b);
  totalUnserved.sort((a, b) => a - b);
  const p95Index = Math.min(criticalUnserved.length - 1, Math.max(0, Math.ceil(criticalUnserved.length * 0.95) - 1));
  const tailStart = Math.max(0, Math.floor(totalUnserved.length * 0.95));
  const tail = totalUnserved.slice(tailStart);
  const cvar95TotalUnservedKWh = tail.length ? tail.reduce((sum, value) => sum + value, 0) / tail.length : 0;
  const p99Index = Math.min(totalUnserved.length - 1, Math.max(0, Math.ceil(totalUnserved.length * 0.99) - 1));
  const tail99Start = Math.max(0, Math.floor(totalUnserved.length * 0.99));
  const tail99 = totalUnserved.slice(tail99Start);
  const cvar99TotalUnservedKWh = tail99.length ? tail99.reduce((sum, value) => sum + value, 0) / tail99.length : 0;
  const round1 = (value: number) => Math.round(value * 10) / 10;
  const criticalInterval = wilsonInterval(counts.critical, n);
  const firstSeed = seedFor(seedOffset);
  const replayA = simulateScenario(firstSeed, location, preset, config, intervention, false);
  const replayB = simulateScenario(firstSeed, location, preset, config, intervention, false);
  const deterministicReplay = evidenceFingerprint(replayA) === evidenceFingerprint(replayB);
  return {
    n, location, preset, config, intervention, counts, causeCounts, failures,
    surrogate: trainRiskSurrogate(surrogateObservations),
    metrics: {
      meanFlexibleUnservedKWh: round1(totalFlexibleUnservedKWh / n),
      meanCriticalUnservedKWh: round1(totalCriticalUnservedKWh / n),
      meanOperationalCost: Math.round((totalOperationalCost / n) * 100) / 100,
      meanCarbonKg: round1(totalCarbonKg / n),
      p95CriticalUnservedKWh: round1(criticalUnserved[p95Index] ?? 0),
      meanCriticalLossHours: round1(totalCriticalLossHours / n),
      p95CriticalLossHours: round1(criticalLossHours[p95Index] ?? 0),
      meanTotalUnservedKWh: round1(totalUnserved.reduce((sum, value) => sum + value, 0) / n),
      cvar95TotalUnservedKWh: round1(cvar95TotalUnservedKWh),
      meanSolarCurtailmentKWh: round1(totalSolarCurtailmentKWh / n),
      meanRenewableServedKWh: round1(totalRenewableServedKWh / n),
      meanAvoidedGridCarbonKg: round1(totalAvoidedGridCarbonKg / n),
      solarCapturePct: totalSolarGeneratedKWh > 0 ? round1(clamp((1 - totalSolarCurtailmentKWh / totalSolarGeneratedKWh) * 100, 0, 100)) : 0,
      criticalRiskPct: round1((counts.critical / n) * 100),
      criticalRiskWilsonLowPct: criticalInterval.lowPct,
      criticalRiskWilsonHighPct: criticalInterval.highPct,
      criticalRiskMarginPct: criticalInterval.marginPct,
      probabilityAnyUnservedPct: round1((anyUnservedCount / n) * 100),
      p99TotalUnservedKWh: round1(totalUnserved[p99Index] ?? 0),
      cvar99TotalUnservedKWh: round1(cvar99TotalUnservedKWh),
      meanLossOfLoadEvents: Math.round((totalLossOfLoadEvents / n) * 100) / 100,
      meanPeakCriticalShortfallKW: round1(totalPeakCriticalShortfallKW / n),
      maxEnergyBalanceErrorKWh,
      energyBalanceErrorPct,
    },
    audit: {
      countConserved: Object.values(counts).reduce((sum, count) => sum + count, 0) === n,
      finiteOutputs,
      socBounds,
      deterministicReplay,
    },
  };
}

/** Transparent local stress sensitivity: each driver is worsened in isolation
 * on the same seeds, and its increase in critical-event probability is
 * normalized into a contribution share. */
export function analyzeSensitivity(
  location: LocationDef,
  preset: PresetId,
  config: MicrogridConfig,
  sampleSize = 300,
): SensitivityResult {
  const baseline = runMonteCarlo(sampleSize, location, preset, config, DEFAULT_INTERVENTION);
  const baselineCriticalPct = (baseline.counts.critical / sampleSize) * 100;
  const perturbations: Array<{ id: string; label: string; apply: (value: MicrogridConfig) => MicrogridConfig }> = [
    { id: "restoration", label: "Outage restoration", apply: (value) => ({ ...value, gridRestorationMeanHours: value.gridRestorationMeanHours * 1.5 }) },
    { id: "solar", label: "Solar availability", apply: (value) => ({ ...value, solarCapacityKW: value.solarCapacityKW * 0.75 }) },
    { id: "heat", label: "Heat-driven demand", apply: (value) => ({ ...value, avgHomeKW: value.avgHomeKW * 1.2 }) },
    { id: "initial_soc", label: "Initial battery state", apply: (value) => ({ ...value, batteryStartPct: Math.max(value.batteryMinSocPct, value.batteryStartPct - 20) }) },
    { id: "ev", label: "EV coincidence", apply: (value) => ({ ...value, evCount: Math.round(value.evCount * 1.4) }) },
    { id: "grid", label: "Grid import capacity", apply: (value) => ({ ...value, gridMaxImportKW: value.gridMaxImportKW * 0.75 }) },
  ];
  const deltas = perturbations.map((item) => {
    const result = runMonteCarlo(sampleSize, location, preset, item.apply(config), DEFAULT_INTERVENTION);
    const criticalPct = (result.counts.critical / sampleSize) * 100;
    return { id: item.id, label: item.label, deltaCriticalPct: Math.round(Math.max(0, criticalPct - baselineCriticalPct) * 10) / 10 };
  });
  const total = deltas.reduce((sum, item) => sum + item.deltaCriticalPct, 0);
  const ranked = [...deltas].sort((a, b) => b.deltaCriticalPct - a.deltaCriticalPct);
  const factorA = ranked[0];
  const factorB = ranked[1];
  const perturbationA = perturbations.find((item) => item.id === factorA?.id);
  const perturbationB = perturbations.find((item) => item.id === factorB?.id);
  const combined = perturbationA && perturbationB
    ? runMonteCarlo(sampleSize, location, preset, perturbationB.apply(perturbationA.apply(config)), DEFAULT_INTERVENTION)
    : null;
  const combinedCriticalPct = combined ? (combined.counts.critical / sampleSize) * 100 : baselineCriticalPct;
  const additiveExpectedPct = baselineCriticalPct + (factorA?.deltaCriticalPct ?? 0) + (factorB?.deltaCriticalPct ?? 0);
  return {
    method: "Paired deterministic stress sensitivity with a second-order interaction replay for the two dominant drivers",
    sampleSize,
    baselineCriticalPct: Math.round(baselineCriticalPct * 10) / 10,
    factors: deltas.map((item) => ({
      ...item,
      contributionPct: total > 0 ? Math.round((item.deltaCriticalPct / total) * 1000) / 10 : Math.round((100 / deltas.length) * 10) / 10,
    })).sort((a, b) => b.contributionPct - a.contributionPct),
    interaction: factorA && factorB ? {
      factorAId: factorA.id,
      factorALabel: factorA.label,
      factorBId: factorB.id,
      factorBLabel: factorB.label,
      combinedCriticalPct: Math.round(combinedCriticalPct * 10) / 10,
      additiveExpectedPct: Math.round(additiveExpectedPct * 10) / 10,
      interactionDeltaPct: Math.round((combinedCriticalPct - additiveExpectedPct) * 10) / 10,
    } : undefined,
  };
}

/* --------------------------------- optimizer -------------------------------
 * Coarse grid-search over the three levers the brief highlights, scored on a
 * sample of the same seeded futures used for the baseline run so the
 * comparison is apples-to-apples, then validated on the full population by
 * the caller (apps/server re-runs runMonteCarlo with the winning params).
 * ---------------------------------------------------------------------- */
export const RESERVE_OPTS = [0, 5, 10, 15, 20, 25, 30];
export const DELAY_OPTS = [0, 30, 60, 90, 120, 150, 180];
export const PRECOOL_OPTS: (number | null)[] = [null, 11, 11.75, 12.75, 13.5];

export interface StrategyCandidate {
  intervention: Intervention;
  criticalCount: number;
  highCount: number;
  disruptionScore: number;
  riskPct: number;
  resilienceScore: number;
  meanUnservedKWh: number;
  meanOperationalCost: number;
  meanCarbonKg: number;
}

export interface OptimizationSearch {
  best: StrategyCandidate;
  evaluatedStrategies: number;
  sampleSize: number;
  seedOffset: number;
  hazardCount: number;
  frontier: StrategyCandidate[];
  selectionReason: string;
}

export interface ValidationCohort {
  label: string;
  seedOffset: number;
  sampleSize: number;
  beforeCriticalPct: number;
  afterCriticalPct: number;
  improvementPct: number;
  preventedFailures: number;
  introducedFailures: number;
  persistentFailures: number;
  pairedNetBenefitPct: number;
  pairedPValue: number;
  afterWilsonHighPct: number;
  passed: boolean;
}

export interface AssumptionShockResult {
  label: string;
  beforeCritical: number;
  afterCritical: number;
  preventedFailures: number;
  introducedFailures: number;
  improvementPct: number;
  passed: boolean;
}

export interface PolicyBenchmark {
  label: string;
  criticalPct: number;
  meanUnservedKWh: number;
  meanOperationalCost: number;
  meanCarbonKg: number;
}

export interface JointStressCell {
  label: string;
  beforeCritical: number;
  afterCritical: number;
  preventedFailures: number;
  introducedFailures: number;
  residualCriticalPct: number;
  improvementPct: number;
  passed: boolean;
}

export interface JointStressEnvelope {
  dimensions: string[];
  evaluatedCells: number;
  sampleSizePerCell: number;
  passingCells: number;
  zeroRegressionCells: number;
  minimumImprovementPct: number;
  worstCell: JointStressCell;
}

export interface OptimizerValidation {
  cohortCount: number;
  passedCohorts: number;
  recommendationStable: boolean;
  cohorts: ValidationCohort[];
  benchmarks: PolicyBenchmark[];
  worstCaseImprovementPct: number;
  assumptionShocks: string[];
  shockResults: AssumptionShockResult[];
  zeroRegressionCohorts: number;
  statisticallyResolvedCohorts: number;
  jointStressEnvelope: JointStressEnvelope;
}

/** Exact two-sided McNemar test over discordant paired outcomes. This asks
 * whether prevented and introduced failures are plausibly symmetric without
 * assuming a normal approximation. */
function exactMcNemarPValue(preventedFailures: number, introducedFailures: number): number {
  const discordant = preventedFailures + introducedFailures;
  if (discordant === 0) return 1;
  const lowerTail = Math.min(preventedFailures, introducedFailures);
  let probability = Math.pow(0.5, discordant);
  let cumulative = probability;
  for (let index = 1; index <= lowerTail; index++) {
    probability *= (discordant - index + 1) / index;
    cumulative += probability;
  }
  return Math.min(1, cumulative * 2);
}

function pairedCriticalTransitions(
  location: LocationDef,
  config: MicrogridConfig,
  intervention: Intervention,
  sampleSize: number,
  seedOffset: number,
  hazards: PresetId[],
): { beforeCritical: number; afterCritical: number; preventedFailures: number; introducedFailures: number; persistentFailures: number } {
  let beforeCritical = 0;
  let afterCritical = 0;
  let preventedFailures = 0;
  let introducedFailures = 0;
  let persistentFailures = 0;
  for (let index = 0; index < sampleSize; index++) {
    const hazard = hazards[index % hazards.length] ?? hazards[0] ?? "extreme";
    const cohortIndex = Math.floor(index / hazards.length) + seedOffset;
    const seed = seedFor(cohortIndex);
    const beforeFailed = simulateScenario(seed, location, hazard, config, DEFAULT_INTERVENTION, false).failed;
    const afterFailed = simulateScenario(seed, location, hazard, config, intervention, false).failed;
    if (beforeFailed) beforeCritical++;
    if (afterFailed) afterCritical++;
    if (beforeFailed && !afterFailed) preventedFailures++;
    else if (!beforeFailed && afterFailed) introducedFailures++;
    else if (beforeFailed && afterFailed) persistentFailures++;
  }
  return { beforeCritical, afterCritical, preventedFailures, introducedFailures, persistentFailures };
}

function evaluateAcrossHazards(
  location: LocationDef,
  config: MicrogridConfig,
  intervention: Intervention,
  sampleSize: number,
  seedOffset: number,
  hazards: PresetId[],
): StrategyCandidate {
  let criticalCount = 0;
  let highCount = 0;
  let totalUnservedKWh = 0;
  let totalOperationalCost = 0;
  let totalCarbonKg = 0;
  for (let i = 0; i < sampleSize; i++) {
    const hazard = hazards[i % hazards.length] ?? hazards[0] ?? "extreme";
    const cohortIndex = Math.floor(i / hazards.length) + seedOffset;
    const result = simulateScenario(seedFor(cohortIndex), location, hazard, config, intervention, false);
    if (result.bucket === "critical") criticalCount++;
    else if (result.bucket === "high") highCount++;
    totalUnservedKWh += result.shedEnergyKWh + result.criticalEnergyUnservedKWh;
    totalOperationalCost += result.operationalCost;
    totalCarbonKg += result.carbonKg;
  }
  const disruptionScore = intervention.reservePct / 5 + intervention.evDelayMin / 30 + (intervention.precoolHour != null ? 2 : 0);
  const riskPct = ((criticalCount + highCount * 0.45) / sampleSize) * 100;
  return {
    intervention, criticalCount, highCount, disruptionScore,
    riskPct: Math.round(riskPct * 10) / 10,
    resilienceScore: Math.round((100 - riskPct) * 10) / 10,
    meanUnservedKWh: Math.round((totalUnservedKWh / sampleSize) * 10) / 10,
    meanOperationalCost: Math.round((totalOperationalCost / sampleSize) * 100) / 100,
    meanCarbonKg: Math.round((totalCarbonKg / sampleSize) * 10) / 10,
  };
}

/**
 * Evaluates the complete intervention grid and retains the non-dominated
 * risk/disruption frontier. This makes the recommendation auditable: callers
 * can show both the winning strategy and the credible alternatives that trade
 * a little resilience for less disruption.
 */
export function analyzeInterventions(
  location: LocationDef,
  preset: PresetId,
  config: MicrogridConfig,
  sampleSize: number,
  seedOffset = 0,
  hazardSet: PresetId[] = [preset],
): OptimizationSearch {
  const candidates: StrategyCandidate[] = [];
  for (const reservePct of RESERVE_OPTS) {
    for (const evDelayMin of DELAY_OPTS) {
      for (const precoolHour of PRECOOL_OPTS) {
        const intervention: Intervention = { reservePct, evDelayMin, precoolHour };
        candidates.push(evaluateAcrossHazards(location, config, intervention, sampleSize, seedOffset, hazardSet));
      }
    }
  }

  const ranked = [...candidates].sort((a, b) =>
    a.criticalCount - b.criticalCount ||
    a.highCount - b.highCount ||
    a.meanUnservedKWh - b.meanUnservedKWh ||
    a.meanOperationalCost - b.meanOperationalCost ||
    a.meanCarbonKg - b.meanCarbonKg ||
    a.disruptionScore - b.disruptionScore,
  );
  const frontier = candidates
    .filter((candidate) => !candidates.some((other) =>
      other !== candidate &&
      other.riskPct <= candidate.riskPct &&
      other.disruptionScore <= candidate.disruptionScore &&
      other.meanOperationalCost <= candidate.meanOperationalCost &&
      other.meanUnservedKWh <= candidate.meanUnservedKWh &&
      other.meanCarbonKg <= candidate.meanCarbonKg &&
      (other.riskPct < candidate.riskPct || other.disruptionScore < candidate.disruptionScore || other.meanOperationalCost < candidate.meanOperationalCost || other.meanUnservedKWh < candidate.meanUnservedKWh || other.meanCarbonKg < candidate.meanCarbonKg),
    ))
    .sort((a, b) => a.disruptionScore - b.disruptionScore || a.riskPct - b.riskPct)
    .slice(0, 12);

  const best = ranked[0];
  return {
    best,
    evaluatedStrategies: candidates.length,
    sampleSize,
    seedOffset,
    hazardCount: hazardSet.length,
    frontier: frontier.some((candidate) => candidate === best) ? frontier : [best, ...frontier].slice(0, 12),
    selectionReason: `Lowest critical failure count (${best.criticalCount}), then high-risk count (${best.highCount}), unserved energy, operating cost, grid carbon, and disruption across ${hazardSet.length} hazards.`,
  };
}

/** Independent evidence that the chosen policy generalizes. Three disjoint
 * cohorts, four disclosed one-at-a-time shocks and an 81-cell full-factorial
 * compound stress envelope are evaluated after selection. */
export function validateIntervention(
  location: LocationDef,
  config: MicrogridConfig,
  intervention: Intervention,
  seedOffset: number,
  sampleSize = 300,
  hazards: PresetId[] = PRESET_ORDER,
): OptimizerValidation {
  const cohorts: ValidationCohort[] = [];
  const stride = Math.ceil(sampleSize / hazards.length) + 17;
  for (let index = 0; index < 3; index++) {
    const offset = seedOffset + index * stride;
    const paired = pairedCriticalTransitions(location, config, intervention, sampleSize, offset, hazards);
    const beforePct = (paired.beforeCritical / sampleSize) * 100;
    const afterPct = (paired.afterCritical / sampleSize) * 100;
    const improvementPct = beforePct > 0 ? (1 - afterPct / beforePct) * 100 : afterPct === 0 ? 100 : 0;
    const afterInterval = wilsonInterval(paired.afterCritical, sampleSize);
    cohorts.push({
      label: `Holdout ${String.fromCharCode(65 + index)}`,
      seedOffset: offset,
      sampleSize,
      beforeCriticalPct: Math.round(beforePct * 10) / 10,
      afterCriticalPct: Math.round(afterPct * 10) / 10,
      improvementPct: Math.round(improvementPct * 10) / 10,
      preventedFailures: paired.preventedFailures,
      introducedFailures: paired.introducedFailures,
      persistentFailures: paired.persistentFailures,
      pairedNetBenefitPct: Math.round(((paired.preventedFailures - paired.introducedFailures) / sampleSize) * 1000) / 10,
      pairedPValue: exactMcNemarPValue(paired.preventedFailures, paired.introducedFailures),
      afterWilsonHighPct: afterInterval.highPct,
      passed: paired.afterCritical <= paired.beforeCritical && paired.preventedFailures >= paired.introducedFailures,
    });
  }

  const benchmarkInterventions: Array<{ label: string; intervention: Intervention }> = [
    { label: "No intervention", intervention: DEFAULT_INTERVENTION },
    { label: "Reserve only", intervention: { reservePct: intervention.reservePct, evDelayMin: 0, precoolHour: null } },
    { label: "EV delay only", intervention: { reservePct: 0, evDelayMin: intervention.evDelayMin, precoolHour: null } },
    { label: "Pre-cooling only", intervention: { reservePct: 0, evDelayMin: 0, precoolHour: intervention.precoolHour } },
    { label: "Grounded policy", intervention },
  ];
  const benchmarks = benchmarkInterventions.map((item) => {
    const result = evaluateAcrossHazards(location, config, item.intervention, sampleSize, seedOffset + stride * 3, hazards);
    return {
      label: item.label,
      criticalPct: Math.round((result.criticalCount / sampleSize) * 1000) / 10,
      meanUnservedKWh: result.meanUnservedKWh,
      meanOperationalCost: result.meanOperationalCost,
      meanCarbonKg: result.meanCarbonKg,
    };
  });

  const shocks: Array<{ label: string; config: MicrogridConfig }> = [
    { label: "+20% restoration time", config: { ...config, gridRestorationMeanHours: config.gridRestorationMeanHours * 1.2 } },
    { label: "+10% community demand", config: { ...config, avgHomeKW: config.avgHomeKW * 1.1 } },
    { label: "−10% solar capacity", config: { ...config, solarCapacityKW: config.solarCapacityKW * 0.9 } },
    { label: "−10 battery SOC points", config: { ...config, batteryStartPct: Math.max(config.batteryMinSocPct, config.batteryStartPct - 10) } },
  ];
  let worstCaseImprovementPct = 100;
  let shockStable = true;
  const shockResults: AssumptionShockResult[] = [];
  for (const shock of shocks) {
    const paired = pairedCriticalTransitions(location, shock.config, intervention, sampleSize, seedOffset + stride * 4, hazards);
    const improvement = paired.beforeCritical > 0 ? (1 - paired.afterCritical / paired.beforeCritical) * 100 : paired.afterCritical === 0 ? 100 : 0;
    const passed = paired.afterCritical <= paired.beforeCritical && paired.preventedFailures >= paired.introducedFailures;
    worstCaseImprovementPct = Math.min(worstCaseImprovementPct, improvement);
    shockStable = shockStable && passed;
    shockResults.push({
      label: shock.label,
      beforeCritical: paired.beforeCritical,
      afterCritical: paired.afterCritical,
      preventedFailures: paired.preventedFailures,
      introducedFailures: paired.introducedFailures,
      improvementPct: Math.round(improvement * 10) / 10,
      passed,
    });
  }

  const restorationMultipliers = [1, 1.25, 1.5];
  const demandMultipliers = [1, 1.1, 1.2];
  const solarMultipliers = [1, 0.9, 0.8];
  const socPenalties = [0, 10, 20];
  const envelopeSampleSize = Math.min(sampleSize, 60);
  const envelopeSeedOffset = seedOffset + stride * 5;
  const stressCells: JointStressCell[] = [];
  for (const restorationMultiplier of restorationMultipliers) {
    for (const demandMultiplier of demandMultipliers) {
      for (const solarMultiplier of solarMultipliers) {
        for (const socPenalty of socPenalties) {
          const stressedConfig: MicrogridConfig = {
            ...config,
            gridRestorationMeanHours: config.gridRestorationMeanHours * restorationMultiplier,
            avgHomeKW: config.avgHomeKW * demandMultiplier,
            solarCapacityKW: config.solarCapacityKW * solarMultiplier,
            batteryStartPct: Math.max(config.batteryMinSocPct, config.batteryStartPct - socPenalty),
          };
          const paired = pairedCriticalTransitions(
            location,
            stressedConfig,
            intervention,
            envelopeSampleSize,
            envelopeSeedOffset,
            hazards,
          );
          const improvement = paired.beforeCritical > 0
            ? (1 - paired.afterCritical / paired.beforeCritical) * 100
            : paired.afterCritical === 0 ? 100 : 0;
          const passed = paired.afterCritical <= paired.beforeCritical && paired.preventedFailures >= paired.introducedFailures;
          stressCells.push({
            label: `restore ×${restorationMultiplier.toFixed(2)} · demand +${Math.round((demandMultiplier - 1) * 100)}% · solar −${Math.round((1 - solarMultiplier) * 100)}% · SOC −${socPenalty}`,
            beforeCritical: paired.beforeCritical,
            afterCritical: paired.afterCritical,
            preventedFailures: paired.preventedFailures,
            introducedFailures: paired.introducedFailures,
            residualCriticalPct: Math.round((paired.afterCritical / envelopeSampleSize) * 1000) / 10,
            improvementPct: Math.round(improvement * 10) / 10,
            passed,
          });
        }
      }
    }
  }
  const worstCell = [...stressCells].sort((left, right) =>
    left.improvementPct - right.improvementPct ||
    right.afterCritical - left.afterCritical ||
    right.introducedFailures - left.introducedFailures,
  )[0];
  const jointStressEnvelope: JointStressEnvelope = {
    dimensions: ["Restoration time", "Community demand", "Solar capacity", "Starting battery SOC"],
    evaluatedCells: stressCells.length,
    sampleSizePerCell: envelopeSampleSize,
    passingCells: stressCells.filter((cell) => cell.passed).length,
    zeroRegressionCells: stressCells.filter((cell) => cell.introducedFailures === 0).length,
    minimumImprovementPct: worstCell.improvementPct,
    worstCell,
  };
  const passedCohorts = cohorts.filter((cohort) => cohort.passed).length;
  return {
    cohortCount: cohorts.length,
    passedCohorts,
    recommendationStable: passedCohorts === cohorts.length && shockStable && jointStressEnvelope.passingCells === jointStressEnvelope.evaluatedCells,
    cohorts,
    benchmarks,
    worstCaseImprovementPct: Math.round(worstCaseImprovementPct * 10) / 10,
    assumptionShocks: shocks.map((shock) => shock.label),
    shockResults,
    zeroRegressionCohorts: cohorts.filter((cohort) => cohort.introducedFailures === 0).length,
    statisticallyResolvedCohorts: cohorts.filter((cohort) => cohort.pairedPValue < 0.05).length,
    jointStressEnvelope,
  };
}

export function optimizeIntervention(
  location: LocationDef,
  preset: PresetId,
  config: MicrogridConfig,
  sampleSize: number,
): Intervention {
  return analyzeInterventions(location, preset, config, sampleSize).best.intervention;
}

export interface FailureExplanation {
  constraint: string;
  explanation: string;
  failureHour: number;
  outageStartHour: number | null;
  restorationGapHours: number;
  batteryAtFailurePct: number;
  criticalShortfallKW: number;
  unservedCriticalEnergyKWh: number;
  minimumPolicy: Intervention | null;
  minimumPolicyLabel: string;
}

/** Turns a critical trace into an auditable constraint diagnosis, then searches
 * the existing policy grid for the least-disruptive policy that saves that
 * exact future. No new random variables are introduced. */
export function explainFailure(
  result: DetailedResult,
  location: LocationDef,
  preset: PresetId,
  config: MicrogridConfig,
): FailureExplanation | null {
  if (!result.failed || result.failStep < 0) return null;
  const step = result.steps[result.failStep];
  if (!step) return null;
  let outageStartHour: number | null = null;
  if (!step.gridOnline) {
    let cursor = result.failStep;
    while (cursor > 0 && !result.steps[cursor - 1]?.gridOnline) cursor--;
    outageStartHour = result.steps[cursor]?.hour ?? null;
  }
  const restoration = result.steps.slice(result.failStep + 1).find((item) => item.gridOnline);
  const restorationGapHours = !step.gridOnline ? Math.max(0, (restoration?.hour ?? 72) - step.hour) : 0;
  const atPowerCeiling = step.batteryDischargeKW >= config.batteryMaxDischargeKW * 0.99 && step.socPct > config.batteryMinSocPct + 1;
  const constraint = atPowerCeiling
    ? "Battery discharge-power ceiling"
    : !step.gridOnline && step.socPct <= config.batteryMinSocPct + 1
      ? "Restoration exceeded protected battery autonomy"
      : !step.gridOnline
        ? "Concurrent grid outage and supply deficit"
        : "Available supply below critical-load requirement";

  const candidates: Array<{ intervention: Intervention; score: number }> = [];
  for (const reservePct of RESERVE_OPTS) for (const evDelayMin of DELAY_OPTS) for (const precoolHour of PRECOOL_OPTS) {
    candidates.push({ intervention: { reservePct, evDelayMin, precoolHour }, score: reservePct / 5 + evDelayMin / 30 + (precoolHour != null ? 2 : 0) });
  }
  candidates.sort((a, b) => a.score - b.score || a.intervention.reservePct - b.intervention.reservePct);
  const minimumPolicy = candidates.find((candidate) => !simulateScenario(result.seed, location, preset, config, candidate.intervention, false).failed)?.intervention ?? null;
  const minimumPolicyLabel = minimumPolicy
    ? `${minimumPolicy.reservePct}% protected reserve · ${minimumPolicy.evDelayMin}m EV delay · ${minimumPolicy.precoolHour == null ? "pre-cooling off" : `pre-cooling ${fmtHour(minimumPolicy.precoolHour)}`}`
    : "No operating-policy combination in the disclosed search space prevents this future";
  const explanation = `${constraint} at ${fmtHour(step.hour)}. Battery was ${step.socPct.toFixed(1)}% and ${step.criticalShedKW.toFixed(1)} kW of hospital demand was unserved${restorationGapHours > 0 ? `, with grid restoration still ${restorationGapHours.toFixed(1)} hours away` : ""}.`;
  return {
    constraint,
    explanation,
    failureHour: step.hour,
    outageStartHour,
    restorationGapHours,
    batteryAtFailurePct: step.socPct,
    criticalShortfallKW: step.criticalShedKW,
    unservedCriticalEnergyKWh: result.criticalEnergyUnservedKWh,
    minimumPolicy,
    minimumPolicyLabel,
  };
}

/* ------------------------------ narrative builder --------------------------
 * Turns a detailed step trace into the "Failure #1847"-style event chain.
 * ---------------------------------------------------------------------- */
export interface NarrativeEvent {
  hour: number;
  label: string;
}

export function buildNarrative(steps: SimStep[], presetId: PresetId, location: LocationDef): NarrativeEvent[] {
  if (!steps || steps.length === 0) return [];
  const events: NarrativeEvent[] = [];
  const tempBase = location.baseTemp + PRESETS[presetId].tempAdd;
  const flags = { heat: false, demand: false, cloud: false, solarDrop: false, gridLost: false, b50: false, b25: false, b10: false };
  for (const s of steps) {
    if (!flags.heat && s.temp > tempBase + 3) {
      events.push({ hour: s.hour, label: PRESETS[presetId].label.includes("Heat") ? "Heatwave intensifies" : "Temperature spikes" });
      flags.heat = true;
    }
    if (!flags.cloud && s.cloud > 0.55) { events.push({ hour: s.hour, label: "Cloud cover increases" }); flags.cloud = true; }
    if (!flags.solarDrop && s.solarKW < 40 && s.hour > 9 && s.hour < 17) { events.push({ hour: s.hour, label: "Solar production collapses" }); flags.solarDrop = true; }
    if (!flags.gridLost && !s.gridOnline) { events.push({ hour: s.hour, label: "Grid connection lost" }); flags.gridLost = true; }
    if (!flags.b50 && s.socPct <= 50) { events.push({ hour: s.hour, label: "Battery = 50%" }); flags.b50 = true; }
    if (!flags.b25 && s.socPct <= 25) { events.push({ hour: s.hour, label: "Battery = 25%" }); flags.b25 = true; }
    if (!flags.b10 && s.socPct <= 10) { events.push({ hour: s.hour, label: "Battery = 10%" }); flags.b10 = true; }
    if (!flags.demand && s.resKW + s.evKW > (steps[0].resKW + steps[0].evKW) * 1.3 && s.hour > 6) {
      events.push({ hour: s.hour, label: "Residential + EV demand surges" });
      flags.demand = true;
    }
    if (s.failed) {
      events.push({ hour: s.hour, label: "Critical-load threshold crossed \u2014 hospital backup unavailable" });
      break;
    }
  }
  events.sort((a, b) => a.hour - b.hour);
  return events;
}

/** Converts a MonteCarloResult into the wire-format RunSummary (adds ids/timestamps). */
export function toRunSummary(runId: string, mc: MonteCarloResult, calibration?: ClimateCalibration, sensitivity?: SensitivityResult, seedOffset = 0, siteData?: SiteDataProfile): RunSummary {
  const precisionTargetPct = mc.n >= 500 ? 5 : 10;
  const checks = [
    { id: "energy_balance", label: "Energy conserved each timestep", passed: mc.metrics.energyBalanceErrorPct < 0.000001, value: `${mc.metrics.maxEnergyBalanceErrorKWh.toExponential(2)} kWh max error` },
    { id: "population", label: "Every future classified exactly once", passed: mc.audit.countConserved, value: `${mc.n}/${mc.n} futures accounted` },
    { id: "soc_bounds", label: "Battery state remained within physical bounds", passed: mc.audit.socBounds, value: "0–100% enforced" },
    { id: "finite", label: "All engineering outputs are finite", passed: mc.audit.finiteOutputs, value: "NaN/∞ scan complete" },
    { id: "replay", label: "Identical seed reproduces identical outcome", passed: mc.audit.deterministicReplay, value: "paired checksum match" },
    { id: "statistical_precision", label: "Monte Carlo uncertainty is quantified", passed: mc.n >= 100 && mc.metrics.criticalRiskMarginPct <= precisionTargetPct, value: `95% Wilson margin ±${mc.metrics.criticalRiskMarginPct.toFixed(2)} pts · target ≤${precisionTargetPct}` },
  ];
  if (siteData) checks.push({
    id: "site_data",
    label: "Measured operational profile passed quality gates",
    passed: siteData.quality.demandCompletenessPct >= 95 && siteData.quality.pvCompletenessPct >= 95 && siteData.demand.completeSlots === 96 && siteData.status !== "REVIEW" && (siteData.validation?.status ?? "PASS") === "PASS" && (siteData.scope === "COMMISSIONED_SITE" || siteData.reliability.eventCount == null || siteData.reliability.eventCount >= 100),
    value: `${siteData.quality.demandCompletenessPct.toFixed(1)}% demand · ${siteData.quality.pvCompletenessPct.toFixed(1)}% PV${siteData.reliability.eventCount ? ` · ${siteData.reliability.eventCount.toLocaleString()} outages` : ""}${siteData.validation ? ` · holdout ${siteData.validation.status}` : ""}`,
  });
  const manifestInput = {
    modelVersion: MODEL_VERSION,
    location: mc.location.id,
    preset: mc.preset,
    config: mc.config,
    intervention: mc.intervention,
    scenarioCount: mc.n,
    seedOffset,
    calibrationFingerprint: calibration?.fingerprint ?? "REFERENCE",
    siteDataFingerprint: siteData?.fingerprint ?? "REPRESENTATIVE_MODEL",
  };
  return {
    runId,
    n: mc.n,
    location: mc.location.id,
    preset: mc.preset,
    config: mc.config,
    intervention: mc.intervention,
    counts: mc.counts,
    causeCounts: mc.causeCounts,
    failures: mc.failures,
    calibration,
    siteData,
    sensitivity,
    surrogate: mc.surrogate,
    metrics: mc.metrics,
    audit: {
      status: checks.every((check) => check.passed) ? "PASS" : "REVIEW",
      maxEnergyBalanceErrorKWh: mc.metrics.maxEnergyBalanceErrorKWh,
      energyBalanceErrorPct: mc.metrics.energyBalanceErrorPct,
      checks,
    },
    manifest: {
      runFingerprint: evidenceFingerprint(manifestInput),
      modelVersion: MODEL_VERSION,
      engine: "Grounded correlated dispatch Monte Carlo",
      horizonHours: STEPS * DT,
      timestepMinutes: DT * 60,
      seedOffset,
      seedScheme: "mulberry32 / golden-ratio indexed seeds",
      scenarioCount: mc.n,
      calibrationFingerprint: calibration?.fingerprint ?? "REFERENCE",
      siteDataFingerprint: siteData?.fingerprint,
      deterministicReplay: mc.audit.deterministicReplay,
    },
    createdAt: Date.now(),
  };
}
