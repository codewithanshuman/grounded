import { describe, expect, it } from "vitest";
import { ClimateCalibration, SiteDataProfile } from "@verdant/protocol";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, LOCATIONS, locationFromCalibration, locationWithSiteData, runMonteCarlo, simulateScenario, toRunSummary } from "@verdant/sim";
import measuredJson from "../../../data/ausgrid-measured-reference.json";
import climateJson from "../../server/climate-cache.json";
import { replayLocation } from "../src/lib/runReplay";
import { isAnalysisOperation, parseAnalysisRequest } from "../src/ws/engineRequest";

describe("Browser engine integrity", () => {
  it("validates physical inputs, request size and hazard before computing", () => {
    const args = { location: "jaipur", preset: "storm", config: DEFAULT_CONFIG, scenarioCount: 500 };
    expect(parseAnalysisRequest(args).scenarioCount).toBe(500);
    expect(() => parseAnalysisRequest({ ...args, scenarioCount: Infinity })).toThrow();
    expect(() => parseAnalysisRequest({ ...args, scenarioCount: 10001 })).toThrow();
    expect(() => parseAnalysisRequest({ ...args, preset: "invented" })).toThrow();
    expect(() => parseAnalysisRequest({ ...args, config: { ...DEFAULT_CONFIG, homesCount: 2.5 } })).toThrow();
    expect(() => parseAnalysisRequest({ ...args, config: { ...DEFAULT_CONFIG, batteryStartPct: 0 } })).toThrow();
  });
  it("identifies all heavyweight operations", () => {
    expect(["simulate", "sweep", "optimize"].every(isAnalysisOperation)).toBe(true);
    expect(isAnalysisOperation("profiles")).toBe(false);
  });
  it("replays measured-profile failures with the original energy and time results", () => {
    const profile = SiteDataProfile.parse(measuredJson);
    const climate = ClimateCalibration.parse(climateJson.jaipur);
    const config = { ...DEFAULT_CONFIG, batteryCapacityKWh: 600, gridMaxImportKW: 100 };
    const location = locationFromCalibration(locationWithSiteData(LOCATIONS.jaipur, profile), climate);
    const mc = runMonteCarlo(20, location, "extreme", config, DEFAULT_INTERVENTION);
    const run = toRunSummary("measured-replay", mc, climate, undefined, 0, profile);
    expect(run.failures.length).toBeGreaterThan(0);
    for (const recorded of run.failures) {
      const replayed = simulateScenario(recorded.seed, replayLocation(run), run.preset, run.config, run.intervention, true);
      expect(replayed.failStep).toBe(recorded.failStep);
      expect(replayed.criticalEnergyUnservedKWh).toBeCloseTo(recorded.criticalEnergyUnservedKWh, 9);
      expect(replayed.operationalCost).toBeCloseTo(recorded.operationalCost, 9);
    }
  });
});
