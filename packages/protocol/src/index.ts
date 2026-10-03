import { z } from "zod";
import { CityProofSummary, CityRotation, EvidenceFamily, EvidenceMilestone } from "./city.js";

/* ============================================================================
 * Shared types between apps/server, apps/web, and every package. Mirrors
 * claude-clan-main's packages/protocol: one source of truth for schemas *and*
 * for the geometry constants both the layout logic and the renderer need, so
 * they can never drift apart.
 * ========================================================================== */

export const PresetId = z.enum(["normal", "heatwave", "storm", "evsurge", "extreme"]);
export type PresetId = z.infer<typeof PresetId>;

export const LocationId = z.enum(["jaipur", "phoenix", "miami", "seattle"]);
export type LocationId = z.infer<typeof LocationId>;

export const MicrogridConfig = z.object({
  solarCapacityKW: z.number().min(0),
  batteryCapacityKWh: z.number().min(0),
  batteryStartPct: z.number().min(0).max(100),
  hospitalKW: z.number().min(0),
  homesCount: z.number().min(0),
  avgHomeKW: z.number().min(0),
  evCount: z.number().min(0),
  evChargerKW: z.number().min(0),
  gridMaxImportKW: z.number().min(0),
  batteryMaxChargeKW: z.number().min(0).default(1200),
  batteryMaxDischargeKW: z.number().min(0).default(1200),
  batteryRoundTripEfficiencyPct: z.number().min(50).max(100).default(90),
  batteryMinSocPct: z.number().min(0).max(40).default(5),
  batteryDegradationCostPerKWh: z.number().min(0).default(0.035),
  gridRestorationMeanHours: z.number().min(0.25).max(72).default(4),
  gridEnergyCostPerKWh: z.number().min(0).default(0.11),
  gridCarbonKgPerKWh: z.number().min(0).default(0.71),
  generatorCapacityKW: z.number().min(0).default(0),
  generatorFuelCapacityKWh: z.number().min(0).default(0),
  generatorStartDelayMinutes: z.number().min(0).max(120).default(5),
  generatorStartFailurePct: z.number().min(0).max(100).default(2),
  generatorForcedOutagePctPerHour: z.number().min(0).max(100).default(0.2),
  generatorFuelCostPerKWh: z.number().min(0).default(0.28),
  generatorCarbonKgPerKWh: z.number().min(0).default(0.74),
  clinicalTier0Pct: z.number().min(0).max(100).default(30),
  clinicalTier1Pct: z.number().min(0).max(100).default(40),
  clinicalTier2Pct: z.number().min(0).max(100).default(20),
  demandControlPct: z.number().min(0).max(50).default(0),
});
export type MicrogridConfig = z.infer<typeof MicrogridConfig>;

export const Intervention = z.object({
  reservePct: z.number().min(0).max(100),
  evDelayMin: z.number().min(0),
  precoolHour: z.number().min(0).max(24).nullable(),
});
export type Intervention = z.infer<typeof Intervention>;

export const RiskBucket = z.enum(["safe", "moderate", "high", "critical"]);
export type RiskBucket = z.infer<typeof RiskBucket>;

export const ScenarioResult = z.object({
  seed: z.number(),
  failed: z.boolean(),
  failStep: z.number(),
  minSocPct: z.number(),
  cause: z.string(),
  bucket: RiskBucket,
  shedEnergyKWh: z.number(),
  criticalEnergyUnservedKWh: z.number(),
  batteryThroughputKWh: z.number(),
  gridEnergyKWh: z.number(),
  solarEnergyKWh: z.number(),
  operationalCost: z.number(),
  carbonKg: z.number(),
  energyBalanceMaxErrorKWh: z.number(),
  energyBalanceErrorPct: z.number(),
  criticalLossDurationHours: z.number(),
  maxCriticalLossStreakHours: z.number(),
  lossOfLoadEvents: z.number(),
  peakCriticalShortfallKW: z.number(),
  solarCurtailedKWh: z.number(),
  directSolarToLoadKWh: z.number(),
  solarChargedBatteryToLoadKWh: z.number(),
  renewableServedKWh: z.number(),
  avoidedGridCarbonKg: z.number(),
  hazardSeverity: z.number(),
  outageStartHour: z.number().nullable(),
  outageDurationHours: z.number(),
  cloudEventStartHour: z.number().nullable(),
  cloudEventDurationHours: z.number(),
  generatorEnergyKWh: z.number().nonnegative().optional(),
  generatorFuelRemainingKWh: z.number().nonnegative().optional(),
  generatorStarts: z.number().int().nonnegative().optional(),
  generatorFailedStart: z.boolean().optional(),
  clinicalService: z.object({
    tier0UnservedKWh: z.number().nonnegative(),
    tier1UnservedKWh: z.number().nonnegative(),
    tier2UnservedKWh: z.number().nonnegative(),
    tier3UnservedKWh: z.number().nonnegative(),
  }).optional(),
  scenarioConditioning: z.object({
    method: z.literal("CONDITIONAL_DEPENDENCY_V1"),
    measuredHighLoadShare: z.number().min(0).max(1),
    measuredLowPvShare: z.number().min(0).max(1),
    outageProbability: z.number().min(0).max(1),
    restorationStressMultiplier: z.number().nonnegative(),
    disclosure: z.string(),
  }).optional(),
  profileSampling: z.object({
    mode: z.enum(["PAIRED_EMPIRICAL_DAYS", "AVERAGE_REFERENCE_PROFILE", "REPRESENTATIVE_ENGINEERING"]),
    method: z.enum(["CONSECUTIVE_3DAY_BLOCK", "INDEPENDENT_DAY_WITH_REPLACEMENT", "REPEATED_AVERAGE_DAY", "SYNTHETIC_PROFILES"]),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    sourceDates: z.string().array().max(3),
    dayFingerprints: z.string().array().max(3),
    disclosure: z.string(),
  }).optional(),
});
export type ScenarioResult = z.infer<typeof ScenarioResult>;

export const ClimateMonth = z.object({
  month: z.string(),
  meanTempC: z.number(),
  maxTempC: z.number(),
  solarKWhM2Day: z.number(),
  cloudPct: z.number(),
});
export type ClimateMonth = z.infer<typeof ClimateMonth>;

export const HistoricalClimateDay = z.object({
  date: z.string(),
  meanTempC: z.number(),
  maxTempC: z.number(),
  solarKWhM2Day: z.number(),
  cloudPct: z.number(),
});
export type HistoricalClimateDay = z.infer<typeof HistoricalClimateDay>;

export const ClimateCalibration = z.object({
  source: z.enum(["NASA_POWER", "REFERENCE_FALLBACK"]),
  status: z.enum(["live", "cached", "fallback"]),
  period: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  meanTempC: z.number(),
  maxTempC: z.number(),
  solarKWhM2Day: z.number(),
  cloudPct: z.number(),
  fingerprint: z.string(),
  fetchedAt: z.number(),
  monthly: z.array(ClimateMonth),
  historicalDays: z.array(HistoricalClimateDay).default([]),
  quality: z.object({
    coverageMonths: z.number(),
    historicalPeriods: z.number(),
    fieldCompletenessPct: z.number(),
    observedFields: z.array(z.string()),
    status: z.enum(["verified", "fallback"]),
  }).optional(),
});
export type ClimateCalibration = z.infer<typeof ClimateCalibration>;

export const SiteDataSource = z.object({
  kind: z.enum(["DEMAND", "PV", "OUTAGE"]),
  authority: z.string(),
  title: z.string(),
  url: z.string().url().optional(),
  fileName: z.string().optional(),
  period: z.string(),
  nativeResolutionMinutes: z.number().positive().nullable(),
  measured: z.boolean(),
});
export type SiteDataSource = z.infer<typeof SiteDataSource>;

export const MeasuredSiteDay = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  demandKW: z.number().finite().nonnegative().array().length(96),
  pvKW: z.number().finite().nonnegative().array().length(96),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  dayOfWeek: z.number().int().min(0).max(6),
  dayType: z.enum(["WEEKDAY", "WEEKEND"]),
  highLoad: z.boolean(),
  lowPvOutput: z.boolean(),
  partition: z.enum(["TRAIN", "HOLDOUT"]),
});
export type MeasuredSiteDay = z.infer<typeof MeasuredSiteDay>;

export const SiteDataProfile = z.object({
  id: z.string(),
  label: z.string(),
  scope: z.enum(["PUBLIC_REFERENCE", "COMMISSIONED_SITE"]),
  status: z.enum(["VERIFIED_REFERENCE", "VERIFIED_SITE", "PARTIALLY_VERIFIED", "REVIEW"]),
  // Separate fitted interval evidence from outage-frequency/duration evidence.
  // Optional for historical public references; commissioned VERIFIED_SITE requires it.
  evidence: z.object({
    demand: z.enum(["VERIFIED", "REVIEW"]),
    pv: z.enum(["VERIFIED", "REVIEW"]),
    reliability: z.enum(["VERIFIED", "INSUFFICIENT_HISTORY", "REVIEW"]),
    overall: z.enum(["VERIFIED", "PARTIALLY_VERIFIED", "REVIEW"]),
    limitations: z.array(z.string()),
  }).optional(),
  demand: z.object({
    station: z.string(),
    firstDate: z.string(),
    lastDate: z.string(),
    readings: z.number().int().nonnegative(),
    completeSlots: z.number().int().min(0).max(96),
    meanMW: z.number().nonnegative(),
    peakMW: z.number().nonnegative(),
    multiplier15m: z.array(z.number().nonnegative()).length(96),
  }),
  pv: z.object({
    firstDate: z.string(),
    lastDate: z.string(),
    readings: z.number().int().nonnegative(),
    customers: z.number().int().nonnegative(),
    nativeResolutionMinutes: z.number().positive(),
    normalizedResolutionMinutes: z.literal(15),
    capacityFactor15m: z.array(z.number().min(0).max(1)).length(96),
  }),
  empiricalDays: z.object({
    version: z.literal(1), resolutionMinutes: z.literal(15), timezone: z.string(),
    inverterCapacityKW: z.number().finite().positive(), normalizationMeanDemandKW: z.number().finite().nonnegative(),
    demandSourceSha256: z.string().regex(/^[a-f0-9]{64}$/), pvSourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
    days: MeasuredSiteDay.array().min(1).max(5000),
    trainingDays: z.number().int().nonnegative(), holdoutDays: z.number().int().nonnegative(),
    excludedIncompleteDemandDates: z.string().array().max(5000),
    excludedIncompletePvDates: z.string().array().max(5000),
    excludedUnpairedDates: z.string().array().max(10000),
    classification: z.string(), disclosure: z.string(),
  }).optional(),
  reliability: z.object({
    period: z.string(),
    saidiMinutesPerCustomerYear: z.number().nonnegative(),
    saifiInterruptionsPerCustomerYear: z.number().nonnegative(),
    meanRestorationHours: z.number().nonnegative(),
    sourceResolution: z.string(),
    eventCount: z.number().int().nonnegative().optional(),
    firstEventDate: z.string().optional(),
    lastEventDate: z.string().optional(),
    customersInterrupted: z.number().int().nonnegative().optional(),
    medianRestorationHours: z.number().nonnegative().optional(),
    p90RestorationHours: z.number().nonnegative().optional(),
    p95RestorationHours: z.number().nonnegative().optional(),
    durationQuantilesHours: z.array(z.number().nonnegative()).min(2).optional(),
    causeCounts: z.record(z.string(), z.number().int().nonnegative()).optional(),
    observationWindow: z.object({
      startedAt: z.string().datetime({ offset: true }),
      endedAt: z.string().datetime({ offset: true }),
      durationDays: z.number().positive(),
      durationYears: z.number().positive(),
      continuousCoverage: z.literal(true),
    }).optional(),
    frequencyInterval95: z.object({
      method: z.literal("EXACT_POISSON"),
      lowerInterruptionsPerYear: z.number().nonnegative(),
      upperInterruptionsPerYear: z.number().positive(),
      assumptions: z.string(),
    }).optional(),
  }),
  sources: z.array(SiteDataSource).min(3),
  quality: z.object({
    demandCompletenessPct: z.number().min(0).max(100),
    pvCompletenessPct: z.number().min(0).max(100),
    targetResolutionMinutes: z.literal(15),
    demandMethod: z.string(),
    pvMethod: z.string(),
    outageMethod: z.string(),
  }),
  validation: z.object({
    method: z.string(),
    status: z.enum(["PASS", "REVIEW"]),
    demand: z.object({
      trainDays: z.number().int().nonnegative(),
      holdoutDays: z.number().int().nonnegative(),
      maePct: z.number().nonnegative(),
      rmsePct: z.number().nonnegative(),
    }),
    pv: z.object({
      trainDays: z.number().int().nonnegative(),
      holdoutDays: z.number().int().nonnegative(),
      maeCapacityFactor: z.number().nonnegative(),
      rmseCapacityFactor: z.number().nonnegative(),
    }),
    outage: z.object({
      trainEvents: z.number().int().nonnegative(),
      holdoutEvents: z.number().int().nonnegative(),
      ksStatistic: z.number().min(0).max(1),
      medianShiftHours: z.number().nonnegative(),
    }),
  }).optional(),
  disclosure: z.string(),
  fingerprint: z.string(),
}).superRefine((profile, context) => {
  const empirical = profile.empiricalDays;
  if (empirical) {
    const dates = empirical.days.map((day) => day.date);
    if (new Set(dates).size !== dates.length || dates.some((date, index) => index > 0 && date <= dates[index - 1])) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["empiricalDays", "days"], message: "Paired measured days must have unique ascending local dates" });
    }
    if (empirical.trainingDays !== empirical.days.filter((day) => day.partition === "TRAIN").length
      || empirical.holdoutDays !== empirical.days.filter((day) => day.partition === "HOLDOUT").length
      || empirical.trainingDays < 1) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["empiricalDays"], message: "Measured-day train/holdout counts must match the retained day ledger, with at least one training day" });
    }
    empirical.days.forEach((day, index) => {
      const calendarDate = new Date(`${day.date}T00:00:00Z`);
      const validDate = Number.isFinite(calendarDate.valueOf()) && calendarDate.toISOString().slice(0, 10) === day.date;
      if (!validDate || calendarDate.getUTCDay() !== day.dayOfWeek
        || day.dayType !== (day.dayOfWeek === 0 || day.dayOfWeek === 6 ? "WEEKEND" : "WEEKDAY")
        || day.pvKW.some((value) => value > empirical.inverterCapacityKW)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["empiricalDays", "days", index], message: "Measured-day calendar metadata or inverter-capacity bound is inconsistent" });
      }
    });
  }
  const window = profile.reliability.observationWindow;
  if (window) {
    const elapsedDays = (Date.parse(window.endedAt) - Date.parse(window.startedAt)) / 86_400_000;
    if (elapsedDays <= 0 || Math.abs(elapsedDays - window.durationDays) > 1e-6 || Math.abs(elapsedDays / 365.25 - window.durationYears) > 1e-9) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reliability", "observationWindow"], message: "Observation exposure must match a positive start/end window" });
    }
  }
  const interval = profile.reliability.frequencyInterval95;
  if (interval && (interval.lowerInterruptionsPerYear > profile.reliability.saifiInterruptionsPerCustomerYear || interval.upperInterruptionsPerYear < profile.reliability.saifiInterruptionsPerCustomerYear)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["reliability", "frequencyInterval95"], message: "Frequency interval must contain the observed annual frequency" });
  }
  if (profile.scope === "COMMISSIONED_SITE" && window && profile.reliability.eventCount != null) {
    const expectedRate = profile.reliability.eventCount / window.durationYears;
    if (Math.abs(expectedRate - profile.reliability.saifiInterruptionsPerCustomerYear) > 1e-8 * Math.max(1, expectedRate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["reliability", "saifiInterruptionsPerCustomerYear"], message: "Site frequency must equal completed event count divided by declared observation years" });
    }
  }
  if (profile.scope === "COMMISSIONED_SITE" && profile.status === "VERIFIED_SITE") {
    if (!window || window.durationDays < 365.25 || !interval || (profile.reliability.eventCount ?? 0) < 30 || profile.evidence?.demand !== "VERIFIED" || profile.evidence?.pv !== "VERIFIED" || profile.evidence?.reliability !== "VERIFIED" || profile.evidence?.overall !== "VERIFIED" || profile.validation?.status !== "PASS") {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["status"], message: "VERIFIED_SITE requires verified load/PV and reliability, at least one year of explicit exposure, 30 events and passing holdouts" });
    }
  }
  if (profile.scope === "COMMISSIONED_SITE" && profile.evidence) {
    const evidence = profile.evidence;
    const expectedOverall = evidence.demand === "VERIFIED" && evidence.pv === "VERIFIED" && evidence.reliability === "VERIFIED" ? "VERIFIED" : evidence.demand === "VERIFIED" || evidence.pv === "VERIFIED" || evidence.reliability === "VERIFIED" ? "PARTIALLY_VERIFIED" : "REVIEW";
    if (evidence.overall !== expectedOverall || profile.status !== (expectedOverall === "VERIFIED" ? "VERIFIED_SITE" : expectedOverall)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "overall"], message: "Combined operational status must match its separately assessed evidence dimensions" });
    }
    const demandCheck = profile.validation?.demand;
    if (evidence.demand === "VERIFIED" && (profile.quality.demandCompletenessPct < 95 || profile.demand.meanMW <= 0 || !demandCheck || demandCheck.trainDays + demandCheck.holdoutDays < 30 || demandCheck.holdoutDays < 6 || demandCheck.maePct > 15)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "demand"], message: "Verified load evidence requires adequate coverage, signal and withheld-day fit" });
    }
    const pvCheck = profile.validation?.pv;
    if (evidence.pv === "VERIFIED" && (profile.quality.pvCompletenessPct < 95 || !profile.pv.capacityFactor15m.some((value) => value > 0) || !pvCheck || pvCheck.trainDays + pvCheck.holdoutDays < 30 || pvCheck.holdoutDays < 6 || pvCheck.maeCapacityFactor > 0.1)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "pv"], message: "Verified PV evidence requires adequate coverage, signal and withheld-day fit" });
    }
    const outageCheck = profile.validation?.outage;
    if (evidence.reliability === "VERIFIED" && (!window || window.durationDays < 365.25 || !interval || (profile.reliability.eventCount ?? 0) < 30 || !outageCheck || outageCheck.holdoutEvents < 6 || outageCheck.trainEvents + outageCheck.holdoutEvents !== profile.reliability.eventCount || outageCheck.ksStatistic > 0.35)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["evidence", "reliability"], message: "Verified reliability requires sufficient explicit exposure and a passing held-out duration comparison" });
    }
  }
});
export type SiteDataProfile = z.infer<typeof SiteDataProfile>;

export const SensitivityFactor = z.object({
  id: z.string(),
  label: z.string(),
  deltaCriticalPct: z.number(),
  contributionPct: z.number(),
});
export const SensitivityResult = z.object({
  method: z.string(),
  sampleSize: z.number(),
  baselineCriticalPct: z.number(),
  factors: z.array(SensitivityFactor),
  interaction: z.object({
    factorAId: z.string(),
    factorALabel: z.string(),
    factorBId: z.string(),
    factorBLabel: z.string(),
    combinedCriticalPct: z.number(),
    additiveExpectedPct: z.number(),
    interactionDeltaPct: z.number(),
  }).optional(),
});
export type SensitivityResult = z.infer<typeof SensitivityResult>;

export const RiskSurrogate = z.object({
  status: z.enum(["PASS", "REVIEW", "UNAVAILABLE"]),
  method: z.string(),
  authority: z.string(),
  trainingSize: z.number().int().nonnegative(),
  holdoutSize: z.number().int().nonnegative(),
  eventRatePct: z.number().min(0).max(100),
  auc: z.number().min(0).max(1).nullable(),
  brierScore: z.number().min(0).max(1).nullable(),
  calibrationErrorPct: z.number().min(0).max(100).nullable(),
  balancedAccuracyPct: z.number().min(0).max(100).nullable(),
  threshold: z.number().min(0).max(1).nullable(),
  coefficients: z.array(z.object({
    id: z.string(),
    label: z.string(),
    coefficient: z.number(),
    direction: z.enum(["increases", "decreases"]),
  })),
  disclosure: z.string(),
});
export type RiskSurrogate = z.infer<typeof RiskSurrogate>;

export const RunMetrics = z.object({
  meanFlexibleUnservedKWh: z.number(),
  meanCriticalUnservedKWh: z.number(),
  meanOperationalCost: z.number(),
  meanCarbonKg: z.number(),
  p95CriticalUnservedKWh: z.number(),
  maxEnergyBalanceErrorKWh: z.number().optional(),
  energyBalanceErrorPct: z.number().optional(),
  meanCriticalLossHours: z.number().optional(),
  p95CriticalLossHours: z.number().optional(),
  meanTotalUnservedKWh: z.number().optional(),
  cvar95TotalUnservedKWh: z.number().optional(),
  meanSolarCurtailmentKWh: z.number().optional(),
  meanRenewableServedKWh: z.number().optional(),
  meanAvoidedGridCarbonKg: z.number().optional(),
  solarCapturePct: z.number().optional(),
  criticalRiskPct: z.number().optional(),
  criticalRiskWilsonLowPct: z.number().optional(),
  criticalRiskWilsonHighPct: z.number().optional(),
  criticalRiskMarginPct: z.number().optional(),
  probabilityAnyUnservedPct: z.number().optional(),
  p99TotalUnservedKWh: z.number().optional(),
  cvar99TotalUnservedKWh: z.number().optional(),
  meanLossOfLoadEvents: z.number().optional(),
  meanPeakCriticalShortfallKW: z.number().optional(),
  meanGeneratorEnergyKWh: z.number().optional(),
  meanTier0UnservedKWh: z.number().optional(),
  meanTier1UnservedKWh: z.number().optional(),
  meanTier2UnservedKWh: z.number().optional(),
  meanTier3UnservedKWh: z.number().optional(),
});
export type RunMetrics = z.infer<typeof RunMetrics>;

export const InvariantCheck = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  value: z.string(),
});
export type InvariantCheck = z.infer<typeof InvariantCheck>;

export const RunAudit = z.object({
  status: z.enum(["PASS", "REVIEW"]),
  maxEnergyBalanceErrorKWh: z.number(),
  energyBalanceErrorPct: z.number(),
  checks: z.array(InvariantCheck),
});
export type RunAudit = z.infer<typeof RunAudit>;

export const ReproducibilityManifest = z.object({
  runFingerprint: z.string(),
  modelVersion: z.string(),
  engine: z.string(),
  horizonHours: z.number(),
  timestepMinutes: z.number(),
  seedOffset: z.number(),
  seedScheme: z.string(),
  scenarioCount: z.number(),
  calibrationFingerprint: z.string(),
  siteDataFingerprint: z.string().optional(),
  deterministicReplay: z.boolean(),
  operationalProfileMode: z.enum(["PAIRED_EMPIRICAL_DAYS", "AVERAGE_REFERENCE_PROFILE", "REPRESENTATIVE_ENGINEERING"]).optional(),
  empiricalDatasetSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
});
export type ReproducibilityManifest = z.infer<typeof ReproducibilityManifest>;

export const RunSummary = z.object({
  runId: z.string(),
  n: z.number(),
  location: LocationId,
  preset: PresetId,
  config: MicrogridConfig,
  intervention: Intervention,
  counts: z.object({ safe: z.number(), moderate: z.number(), high: z.number(), critical: z.number() }),
  causeCounts: z.record(z.string(), z.number()),
  failures: z.array(ScenarioResult),
  calibration: ClimateCalibration.optional(),
  siteData: SiteDataProfile.optional(),
  sensitivity: SensitivityResult.optional(),
  surrogate: RiskSurrogate.optional(),
  metrics: RunMetrics.optional(),
  audit: RunAudit.optional(),
  manifest: ReproducibilityManifest.optional(),
  operationalSampling: z.object({
    mode: z.enum(["PAIRED_EMPIRICAL_DAYS", "AVERAGE_REFERENCE_PROFILE", "REPRESENTATIVE_ENGINEERING"]),
    method: z.enum(["CONSECUTIVE_3DAY_BLOCK", "INDEPENDENT_DAY_WITH_REPLACEMENT", "REPEATED_AVERAGE_DAY", "SYNTHETIC_PROFILES"]),
    datasetSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    sourceDateDrawCounts: z.record(z.string(), z.number().int().nonnegative()),
    availableTrainingDays: z.number().int().nonnegative(),
    disclosure: z.string(),
  }).optional(),
  createdAt: z.number(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const ClimateSweepScenario = z.object({
  preset: PresetId,
  label: z.string(),
  n: z.number(),
  counts: z.object({ safe: z.number(), moderate: z.number(), high: z.number(), critical: z.number() }),
  resilienceScore: z.number(),
  criticalPct: z.number(),
  dominantCause: z.string(),
});
export type ClimateSweepScenario = z.infer<typeof ClimateSweepScenario>;

export const ClimateSweepResult = z.object({
  location: LocationId,
  scenarioCount: z.number(),
  robustScore: z.number(),
  weakestPreset: PresetId,
  scenarios: z.array(ClimateSweepScenario),
  calibration: ClimateCalibration.optional(),
  createdAt: z.number(),
});
export type ClimateSweepResult = z.infer<typeof ClimateSweepResult>;

/* --------------------------- the resilience forest -------------------------
 * The gamified layer: every completed simulation run plants a tree in a
 * persistent world; hitting a resilience milestone grows a building. This is
 * VERDANT's version of claude-clan's "buildings grow as the code grows" —
 * here the thing that grows is the community's demonstrated resilience.
 * ---------------------------------------------------------------------- */

export const GrowthKind = z.enum(["tree.planted", "building.grown", "building.upgraded", "milestone.earned", "tree.withered"]);
export type GrowthKind = z.infer<typeof GrowthKind>;

/** Species/tier communicate at a glance how good the run that caused them was. */
export const TreeSpecies = z.enum(["sapling", "oak", "flowering", "ancient"]);
export type TreeSpecies = z.infer<typeof TreeSpecies>;

export const BuildingKind = z.enum(["watchtower", "reservoir", "solarHall", "resilienceHall"]);
export type BuildingKind = z.infer<typeof BuildingKind>;

export const Tree = z.object({
  id: z.string(),
  gx: z.number(),
  gy: z.number(),
  species: TreeSpecies,
  plantedAt: z.number(),
  runId: z.string(),
});
export type Tree = z.infer<typeof Tree>;

export const Building = z.object({
  id: z.string(),
  gx: z.number(),
  gy: z.number(),
  kind: BuildingKind,
  grownAt: z.number(),
  runId: z.string(),
  milestone: z.string(),
  milestoneId: z.string().optional(), family: EvidenceFamily.optional(), variantId: z.string().optional(),
  plotId: z.string().optional(), rotation: CityRotation.optional(), level: z.number().int().min(1).max(3).optional(),
  proof: CityProofSummary.optional(),
});
export type Building = z.infer<typeof Building>;

export const GrowthEvent = z.object({
  kind: GrowthKind,
  runId: z.string(),
  tree: Tree.optional(),
  building: Building.optional(),
  pendingMilestone: EvidenceMilestone.optional(),
  message: z.string(),
});
export type GrowthEvent = z.infer<typeof GrowthEvent>;

export const WorldState = z.object({
  trees: z.array(Tree),
  buildings: z.array(Building),
  totalRuns: z.number(),
  totalFuturesSimulated: z.number(),
  bestImprovementPct: z.number(),
  pendingMilestones: z.array(EvidenceMilestone).optional(),
  cityProofReceipts: z.array(z.string()).optional(),
});
export type WorldState = z.infer<typeof WorldState>;

/* ------------------------------ WS wire protocol ---------------------------- */

export const ClientMessage = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("simulate"),
    location: LocationId,
    preset: PresetId,
    config: MicrogridConfig,
    scenarioCount: z.number().min(100).max(20000),
  }),
  z.object({
    type: z.literal("optimize"),
    runId: z.string(),
    riskTargetPct: z.number().finite().gt(0).max(100).default(5),
  }),
]);
export type ClientMessage = z.infer<typeof ClientMessage>;

export const ServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("world"), world: WorldState }),
  z.object({ type: z.literal("run.completed"), summary: RunSummary }),
  z.object({ type: z.literal("optimize.completed"), runId: z.string(), intervention: Intervention, result: RunSummary }),
  z.object({ type: z.literal("growth"), event: GrowthEvent }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type ServerMessage = z.infer<typeof ServerMessage>;

/* ------------------------- shared isometric geometry ------------------------
 * Same projection convention as claude-clan-main: [u, v, z] tile coordinates,
 * u+v is depth (the sort key), u-v is screen x. Both packages/sim's forest
 * layout and apps/web's renderer import these so they can never disagree
 * about where a tree actually sits.
 * ---------------------------------------------------------------------- */
export const HALF_W = 48;
export const HALF_H = 24;
/** Side length, in tiles, of the square forest grid new growth is placed on. */
export const FOREST_GRID_SIZE = 24;
/** Trees/buildings are placed on a spiral so early growth clusters near the
 * centre and the forest visibly expands outward as more runs accumulate. */
export const FOREST_CENTER = FOREST_GRID_SIZE / 2;
