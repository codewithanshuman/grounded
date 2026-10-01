import { describe, expect, it } from "vitest";
import { SiteDataProfile } from "@verdant/protocol";
import { createCommissionedSiteProfile } from "../../../apps/server/src/site-data";
import { DEFAULT_CONFIG, DEFAULT_INTERVENTION, LOCATIONS, MODEL_VERSION, locationWithSiteData, runMonteCarlo, sampleMeasuredDays, seedFor, simulateScenario, toRunSummary } from "../src/index";
import { replayEvidence } from "../src/proofReplay";
import { StoredEvidence } from "@verdant/protocol/evidence";

function profile() {
  const demand = ["timestamp,demand_kw"], pv = ["timestamp,pv_kw"];
  for (let day = 0; day < 20; day++) for (let slot = 0; slot < 96; slot++) {
    const timestamp = new Date(Date.UTC(2025, 0, 1) + (day * 96 + slot) * 900_000).toISOString();
    demand.push(`${timestamp},${100 + day * 5 + slot}`);
    pv.push(`${timestamp},${day + slot / 10}`);
  }
  return createCommissionedSiteProfile({ siteName: "Synthetic test only", timezone: "UTC", pvCapacityKW: 100,
    demandFileName: "demand.csv", pvFileName: "pv.csv", outageFileName: "outage.csv", demandCsv: demand.join("\n"), pvCsv: pv.join("\n"), outageCsv: "outage_started_at,restored_at,cause",
    outageObservationWindow: { startedAt: "2025-01-01T00:00:00Z", endedAt: "2025-01-21T00:00:00Z", continuousCoverage: true } });
}

describe("Paired measured-day operational sampling", () => {
  it("retains exact paired trajectories, provenance and shared training partitions", () => {
    const data = profile().empiricalDays!;
    expect(data.days).toHaveLength(20);
    expect(data.trainingDays).toBe(16); expect(data.holdoutDays).toBe(4);
    expect(data.days[2].demandKW[42]).toBe(152); expect(data.days[2].pvKW[42]).toBe(6.2);
    expect(data.days[4].partition).toBe("HOLDOUT");
    expect(data.datasetSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(data.classification).toContain("not an observed cloud/weather label");
    expect(SiteDataProfile.safeParse(profile()).success).toBe(true);
  });
  it("draws consecutive three-day blocks deterministically and never uses holdout dates", () => {
    const site = profile();
    const unique = new Set<string>();
    for (let index = 0; index < 100; index++) {
      const days = sampleMeasuredDays(seedFor(index), site);
      expect(days).toEqual(sampleMeasuredDays(seedFor(index), site));
      days.forEach((day) => { expect(day.partition).toBe("TRAIN"); unique.add(day.date); });
      expect(Date.parse(days[2].date) - Date.parse(days[0].date)).toBe(2 * 86_400_000);
    }
    expect(unique.size).toBeGreaterThan(5);
  });
  it("uses the same day/slot data for baseline, intervention and hazard comparisons", () => {
    const site = profile(), location = locationWithSiteData(LOCATIONS.jaipur, site);
    const before = simulateScenario(seedFor(8), location, "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION, true);
    const after = simulateScenario(seedFor(8), location, "extreme", DEFAULT_CONFIG, { reservePct: 80, evDelayMin: 120, precoolHour: 12 }, true);
    expect(before.profileSampling).toEqual(after.profileSampling);
    const days = sampleMeasuredDays(seedFor(8), site);
    before.steps.forEach((step, index) => {
      expect(step.sourceDate).toBe(days[Math.floor(index / 96)].date);
      expect(step.measuredDemandKW).toBe(days[Math.floor(index / 96)].demandKW[index % 96]);
      expect(step.measuredPvKW).toBe(days[Math.floor(index / 96)].pvKW[index % 96]);
      expect(step.measuredDemandKW).toBe(after.steps[index].measuredDemandKW);
    });
    expect(before.energyBalanceMaxErrorKWh).toBeLessThan(1e-8);
  });
  it("carries battery SOC across midnight instead of resetting daily", () => {
    const location = locationWithSiteData(LOCATIONS.jaipur, profile());
    const result = simulateScenario(seedFor(1), location, "normal", { ...DEFAULT_CONFIG, solarCapacityKW: 0, gridMaxImportKW: 0, batteryCapacityKWh: 10000, batteryMaxDischargeKW: 1000, hospitalKW: 1, homesCount: 0, evCount: 0 }, DEFAULT_INTERVENTION, true);
    expect(result.steps[96].socPct).toBeLessThan(result.steps[95].socPct);
    expect(result.steps[192].socPct).toBeLessThan(result.steps[191].socPct);
    expect(result.steps[96].socPct).not.toBe(DEFAULT_CONFIG.batteryStartPct);
  });
  it("discloses independent-day fallback when no consecutive training block exists", () => {
    const site = profile();
    site.empiricalDays!.days = site.empiricalDays!.days.filter((_, index) => index % 3 === 0).map((day) => ({ ...day, partition: "TRAIN" }));
    site.empiricalDays!.trainingDays = site.empiricalDays!.days.length; site.empiricalDays!.holdoutDays = 0;
    const mc = runMonteCarlo(100, locationWithSiteData(LOCATIONS.jaipur, site), "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION);
    expect(mc.operationalSampling.method).toBe("INDEPENDENT_DAY_WITH_REPLACEMENT");
    expect(mc.operationalSampling.disclosure).toContain("inter-day persistence is not preserved");
    expect(Object.values(mc.operationalSampling.sourceDateDrawCounts).reduce((sum, count) => sum + count, 0)).toBe(300);
  });
  it("labels averaged-profile fallback and binds actual trajectories into run identity", () => {
    const site = profile(), changed = structuredClone(site);
    changed.empiricalDays!.days[0].demandKW[0] += 10;
    const run = (data: ReturnType<typeof profile>) => toRunSummary("test", runMonteCarlo(100, locationWithSiteData(LOCATIONS.jaipur, data), "normal", DEFAULT_CONFIG, DEFAULT_INTERVENTION), undefined, undefined, 0, data);
    expect(run(site).manifest!.runFingerprint).not.toBe(run(changed).manifest!.runFingerprint);
    const average = { ...site, empiricalDays: undefined };
    expect(run(average).operationalSampling).toMatchObject({ mode: "AVERAGE_REFERENCE_PROFILE", method: "REPEATED_AVERAGE_DAY", sourceDateDrawCounts: {} });
  });
  it("replays a saved measured-day run including its complete source-date ledger", () => {
    const site = profile();
    const baseline = toRunSummary("measured-replay", runMonteCarlo(100, locationWithSiteData(LOCATIONS.jaipur, site), "extreme", DEFAULT_CONFIG, DEFAULT_INTERVENTION), undefined, undefined, 0, site);
    const proof = StoredEvidence.parse({ schemaVersion: 1, recordId: "550e8400-e29b-41d4-a716-446655440000", ownerScope: "test-only", savedAt: Date.now(), modelVersion: MODEL_VERSION, riskTargetPct: 5, baseline, optimization: null });
    expect(replayEvidence(proof).status).toBe("PASS");
  });
});
