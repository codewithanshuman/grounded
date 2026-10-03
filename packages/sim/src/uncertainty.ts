import type { Intervention, MicrogridConfig, PresetId } from "@verdant/protocol";
import { PRESET_ORDER, runMonteCarlo, type LocationDef } from "./index.js";

export interface EpistemicUncertaintyResult {
  id: string;
  label: string;
  lowAssumption: string;
  highAssumption: string;
  criticalRiskRangePct: number;
  cvar95RangeKWh: number;
  decisionValueScore: number;
  recommendedMeasurement: string;
}

export interface ValueOfInformationAnalysis {
  model: "GROUNDED_VOI_PRIORITY_V1";
  aleatoric: {
    method: "SEEDED_MONTE_CARLO";
    sources: string[];
    sampleSizePerHazard: number;
    hazards: PresetId[];
  };
  epistemic: EpistemicUncertaintyResult[];
  topPriority: EpistemicUncertaintyResult;
  disclosure: string;
}

export interface ValueOfInformationOptions {
  sampleSizePerHazard?: number;
  seedOffset?: number;
  hazards?: PresetId[];
}

type ConfigRange = {
  id: string;
  label: string;
  lowAssumption: string;
  highAssumption: string;
  recommendedMeasurement: string;
  low: (config: MicrogridConfig) => MicrogridConfig;
  high: (config: MicrogridConfig) => MicrogridConfig;
};

function aggregate(location: LocationDef, hazards: PresetId[], config: MicrogridConfig,
  intervention: Intervention, sampleSize: number, seedOffset: number) {
  const results = hazards.map((hazard, index) => runMonteCarlo(sampleSize, location, hazard, config,
    intervention, seedOffset + index * sampleSize));
  return {
    criticalRiskPct: Math.max(...results.map((result) => result.metrics.criticalRiskPct)),
    cvar95KWh: results.reduce((sum, result) => sum + result.metrics.cvar95TotalUnservedKWh, 0) / results.length,
  };
}

/** Ranks parameter uncertainty by decision sensitivity on identical seeds.
 * This is a screening value, not monetized EVPI and not an uncertainty proof. */
export function analyzeValueOfInformation(location: LocationDef, preset: PresetId, config: MicrogridConfig,
  intervention: Intervention, options: ValueOfInformationOptions = {}): ValueOfInformationAnalysis {
  const sampleSizePerHazard = options.sampleSizePerHazard ?? 24;
  const seedOffset = options.seedOffset ?? 180_000;
  const hazards = options.hazards ?? [...PRESET_ORDER];
  if (!Number.isInteger(sampleSizePerHazard) || sampleSizePerHazard < 20 || sampleSizePerHazard > 1_000 || !hazards.length) {
    throw new Error("Value-of-information analysis needs 20–1,000 futures per hazard and at least one hazard.");
  }
  const ranges: ConfigRange[] = [
    { id: "restoration", label: "Restoration duration", lowAssumption: "0.7× configured mean", highAssumption: "1.5× configured mean",
      recommendedMeasurement: "Retain complete outage start/restoration timestamps across at least one full year.",
      low: (value) => ({ ...value, gridRestorationMeanHours: Math.max(.25, value.gridRestorationMeanHours * .7) }),
      high: (value) => ({ ...value, gridRestorationMeanHours: Math.min(72, value.gridRestorationMeanHours * 1.5) }) },
    { id: "demand", label: "Demand growth", lowAssumption: "0.9× mean demand", highAssumption: "1.2× mean demand",
      recommendedMeasurement: "Collect interval load with service labels through peak-season operating days.",
      low: (value) => ({ ...value, avgHomeKW: value.avgHomeKW * .9, hospitalKW: value.hospitalKW * .95 }),
      high: (value) => ({ ...value, avgHomeKW: value.avgHomeKW * 1.2, hospitalKW: value.hospitalKW * 1.1 }) },
    { id: "pv_yield", label: "PV yield", lowAssumption: "0.8× installed output", highAssumption: "1.05× installed output",
      recommendedMeasurement: "Export inverter AC production aligned to irradiance and module-temperature observations.",
      low: (value) => ({ ...value, solarCapacityKW: value.solarCapacityKW * .8 }),
      high: (value) => ({ ...value, solarCapacityKW: value.solarCapacityKW * 1.05 }) },
    { id: "battery_usable", label: "Usable battery capacity", lowAssumption: "0.85× nameplate", highAssumption: "1.0× nameplate",
      recommendedMeasurement: "Run a supervised capacity test and retain BMS SOC, power and temperature telemetry.",
      low: (value) => ({ ...value, batteryCapacityKWh: value.batteryCapacityKWh * .85 }),
      high: (value) => value },
    { id: "generator_reliability", label: "Generator start reliability", lowAssumption: "0% failed starts", highAssumption: "at least 10% failed starts",
      recommendedMeasurement: "Retain witnessed start tests, runtime failures, fuel level and refuelling records.",
      low: (value) => ({ ...value, generatorStartFailurePct: 0, generatorForcedOutagePctPerHour: 0 }),
      high: (value) => ({ ...value, generatorStartFailurePct: Math.max(10, value.generatorStartFailurePct),
        generatorForcedOutagePctPerHour: Math.max(1, value.generatorForcedOutagePctPerHour) }) },
    { id: "clinical_load", label: "Clinical service demand", lowAssumption: "0.9× clinical load", highAssumption: "1.2× clinical load",
      recommendedMeasurement: "Submeter life-safety and clinical circuits and validate the tier register with facility staff.",
      low: (value) => ({ ...value, hospitalKW: value.hospitalKW * .9 }),
      high: (value) => ({ ...value, hospitalKW: value.hospitalKW * 1.2 }) },
  ];
  const epistemic = ranges.map((range) => {
    const low = aggregate(location, hazards, range.low(config), intervention, sampleSizePerHazard, seedOffset);
    const high = aggregate(location, hazards, range.high(config), intervention, sampleSizePerHazard, seedOffset);
    const criticalRiskRangePct = Math.abs(high.criticalRiskPct - low.criticalRiskPct);
    const cvar95RangeKWh = Math.abs(high.cvar95KWh - low.cvar95KWh);
    const decisionValueScore = Math.round((criticalRiskRangePct * 10 + Math.log10(1 + cvar95RangeKWh) * 8) * 10) / 10;
    return { id: range.id, label: range.label, lowAssumption: range.lowAssumption,
      highAssumption: range.highAssumption, criticalRiskRangePct, cvar95RangeKWh,
      decisionValueScore, recommendedMeasurement: range.recommendedMeasurement };
  }).sort((a, b) => b.decisionValueScore - a.decisionValueScore || a.id.localeCompare(b.id));
  const topPriority = epistemic[0];
  if (!topPriority) throw new Error("Value-of-information analysis produced no uncertainty dimension.");
  return {
    model: "GROUNDED_VOI_PRIORITY_V1",
    aleatoric: {
      method: "SEEDED_MONTE_CARLO", sampleSizePerHazard, hazards,
      sources: ["weather realization", "paired operational-day selection", "outage occurrence and restoration", "load noise", "generator failure"],
    },
    epistemic, topPriority,
    disclosure: "Ranks which uncertain model input most changes modeled risk on identical seeds. The score is a sensitivity-based information priority, not monetized EVPI, a confidence interval or proof that collecting the data changes reality.",
  };
}
