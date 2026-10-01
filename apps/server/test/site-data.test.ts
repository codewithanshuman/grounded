import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SiteDataProfile } from "@verdant/protocol";
import { CommissionSiteBody, createCommissionedSiteProfile, loadCommissionedProfiles, outageFrequencyInterval95, persistCommissionedProfile } from "../src/site-data.js";

function intervalCsv(kind: "demand" | "pv"): string {
  const header = kind === "demand" ? "timestamp,demand_kw" : "timestamp,pv_kw";
  const rows = [header];
  const start = Date.UTC(2025, 0, 1);
  for (let step = 0; step < 40 * 96; step++) {
    const timestamp = new Date(start + step * 15 * 60_000).toISOString();
    const hour = (step % 96) / 4;
    const value = kind === "demand"
      ? 380 + 90 * Math.exp(-((hour - 19) ** 2) / 12) + (step % 5)
      : Math.max(0, 500 * Math.sin(Math.PI * (hour - 6) / 12));
    rows.push(`${timestamp},${value.toFixed(3)}`);
  }
  return rows.join("\n");
}

function outageCsv(): string {
  const rows = ["outage_started_at,restored_at,cause"];
  for (let index = 0; index < 10; index++) {
    const start = Date.UTC(2024, index, 2, 10);
    rows.push(`${new Date(start).toISOString()},${new Date(start + (60 + index * 12) * 60_000).toISOString()},Grid fault`);
  }
  return rows.join("\n");
}

const input = {
  siteName: "Jaipur Community Clinic",
  timezone: "UTC",
  pvCapacityKW: 500,
  demandFileName: "demand.csv",
  pvFileName: "pv.csv",
  outageFileName: "outages.csv",
  demandCsv: intervalCsv("demand"),
  pvCsv: intervalCsv("pv"),
  outageCsv: outageCsv(),
  outageObservationWindow: { startedAt: "2024-01-01T00:00:00Z", endedAt: "2025-01-01T00:00:00Z", continuousCoverage: true as const },
};

const oneOutage = "outage_started_at,restored_at,cause\n2025-01-15T10:00:00Z,2025-01-15T12:00:00Z,Grid fault";
const thirtyDayWindow = { startedAt: "2025-01-01T00:00:00Z", endedAt: "2025-01-31T00:00:00Z", continuousCoverage: true as const };

function longOutageCsv(): string {
  const rows = ["outage_started_at,restored_at,cause"];
  for (let index = 0; index < 40; index++) {
    const start = Date.UTC(2024, 0, 3) + index * 8 * 86_400_000;
    rows.push(`${new Date(start).toISOString()},${new Date(start + (60 + index % 4 * 6) * 60_000).toISOString()},Grid fault`);
  }
  return rows.join("\n");
}

describe("site data commissioning", () => {
  it("excludes incomplete paired dates without inventing replacement measurements", () => {
    const rows = input.pvCsv.split("\n");
    rows.splice(43, 1);
    const profile = createCommissionedSiteProfile({ ...input, pvCsv: rows.join("\n") });
    expect(profile.empiricalDays!.excludedIncompletePvDates).toEqual(["2025-01-01"]);
    expect(profile.empiricalDays!.excludedUnpairedDates).toEqual(["2025-01-01"]);
    expect(profile.empiricalDays!.days).toHaveLength(39);
    expect(profile.empiricalDays!.days.some((day) => day.date === "2025-01-01")).toBe(false);
    const demandOneDay = input.demandCsv.split("\n").slice(0, 97).join("\n");
    const pvOtherDay = [input.pvCsv.split("\n")[0], ...input.pvCsv.split("\n").slice(97, 193)].join("\n");
    expect(() => createCommissionedSiteProfile({ ...input, demandCsv: demandOneDay, pvCsv: pvOtherDay })).toThrow(/No complete paired local/);
  });

  it("excludes the shortened local daylight-saving day and retains adjacent complete days", () => {
    const demand = ["timestamp,demand_kw"], pv = ["timestamp,pv_kw"];
    const start = Date.parse("2025-03-08T05:00:00Z");
    const end = Date.parse("2025-03-11T04:00:00Z");
    for (let time = start; time < end; time += 900_000) {
      const timestamp = new Date(time).toISOString();
      demand.push(`${timestamp},300`); pv.push(`${timestamp},100`);
    }
    const profile = createCommissionedSiteProfile({ ...input, timezone: "America/New_York", demandCsv: demand.join("\n"), pvCsv: pv.join("\n") });
    expect(profile.empiricalDays!.days.map((day) => day.date)).toEqual(["2025-03-08", "2025-03-10"]);
    expect(profile.empiricalDays!.excludedIncompleteDemandDates).toEqual(["2025-03-09"]);
    expect(profile.empiricalDays!.excludedIncompletePvDates).toEqual(["2025-03-09"]);
    expect(profile.empiricalDays!.days.every((day) => day.demandKW.length === 96 && day.pvKW.length === 96)).toBe(true);
    expect(profile.status).toBe("REVIEW");
  });

  it("separates verified interval telemetry from insufficient reliability history", () => {
    const profile = createCommissionedSiteProfile(input);
    expect(profile.scope).toBe("COMMISSIONED_SITE");
    expect(profile.status).toBe("PARTIALLY_VERIFIED");
    expect(profile.evidence).toMatchObject({ demand: "VERIFIED", pv: "VERIFIED", reliability: "INSUFFICIENT_HISTORY", overall: "PARTIALLY_VERIFIED" });
    expect(profile.demand.completeSlots).toBe(96);
    expect(profile.pv.capacityFactor15m).toHaveLength(96);
    expect(profile.reliability.durationQuantilesHours).toHaveLength(101);
    expect(profile.validation?.status).toBe("REVIEW");
    expect(profile.fingerprint).toMatch(/^SITE-[A-F0-9]{12}$/);
  });

  it("is deterministic for identical commissioned inputs", () => {
    expect(createCommissionedSiteProfile(input).fingerprint).toBe(createCommissionedSiteProfile(input).fingerprint);
  });

  it("rejects missing timestamp/value contracts", () => {
    expect(() => createCommissionedSiteProfile({ ...input, demandCsv: "date,value\n2025-01-01,10" })).toThrow(/timestamp/i);
  });

  it("annualizes one event over its actual 30-day exposure, never an artificial full year", () => {
    const profile = createCommissionedSiteProfile({ ...input, outageCsv: oneOutage, outageObservationWindow: thirtyDayWindow });
    expect(profile.reliability.saifiInterruptionsPerCustomerYear).toBeCloseTo(365.25 / 30, 10);
    expect(profile.reliability.saidiMinutesPerCustomerYear).toBeCloseTo(120 * 365.25 / 30, 3);
    expect(profile.reliability.observationWindow?.durationDays).toBe(30);
    expect(profile.reliability.frequencyInterval95?.lowerInterruptionsPerYear).toBeCloseTo(0.0253178079842899 * 365.25 / 30, 7);
    expect(profile.reliability.frequencyInterval95?.upperInterruptionsPerYear).toBeCloseTo(5.5716433909389 * 365.25 / 30, 7);
    expect(profile.status).not.toBe("VERIFIED_SITE");
    expect(profile.evidence?.reliability).toBe("INSUFFICIENT_HISTORY");
  });

  it("uses declared exposure, not the spacing of first and last outage", () => {
    const short = createCommissionedSiteProfile({ ...input, outageCsv: oneOutage, outageObservationWindow: thirtyDayWindow });
    const long = createCommissionedSiteProfile({ ...input, outageCsv: oneOutage, outageObservationWindow: { ...thirtyDayWindow, endedAt: "2026-01-01T00:00:00Z" } });
    expect(long.reliability.saifiInterruptionsPerCustomerYear).toBeCloseTo(365.25 / 365, 10);
    expect(long.reliability.saifiInterruptionsPerCustomerYear).toBeLessThan(short.reliability.saifiInterruptionsPerCustomerYear);
    expect(long.fingerprint).not.toBe(short.fingerprint);
  });

  it("supports genuinely zero observed events without claiming zero risk or duration evidence", () => {
    const profile = createCommissionedSiteProfile({ ...input, outageCsv: "outage_started_at,restored_at,cause", outageObservationWindow: thirtyDayWindow });
    expect(profile.reliability.eventCount).toBe(0);
    expect(profile.reliability.saifiInterruptionsPerCustomerYear).toBe(0);
    expect(profile.reliability.frequencyInterval95?.lowerInterruptionsPerYear).toBe(0);
    expect(profile.reliability.frequencyInterval95?.upperInterruptionsPerYear).toBeCloseTo(-Math.log(0.025) * 365.25 / 30, 8);
    expect(profile.reliability.durationQuantilesHours).toBeUndefined();
    expect(profile.reliability.firstEventDate).toBeUndefined();
    expect(profile.evidence?.reliability).toBe("INSUFFICIENT_HISTORY");
    expect(profile.disclosure).toMatch(/Zero recorded outages is not zero risk/);
  });

  it("verifies adequate long reliability history with independent withheld durations", () => {
    const profile = createCommissionedSiteProfile({ ...input, outageCsv: longOutageCsv() });
    expect(profile.reliability.eventCount).toBe(40);
    expect(profile.reliability.observationWindow?.durationDays).toBe(366);
    expect(profile.evidence?.reliability).toBe("VERIFIED");
    expect(profile.status).toBe("VERIFIED_SITE");
    expect(profile.validation?.outage.holdoutEvents).toBe(8);
    expect(profile.validation?.status).toBe("PASS");
    expect(SiteDataProfile.safeParse(profile).success).toBe(true);
  });

  it("does not verify many events observed during a short window", () => {
    const rows = ["outage_started_at,restored_at,cause"];
    for (let index = 0; index < 40; index++) {
      const start = Date.UTC(2025, 0, 2) + index * 6 * 3_600_000;
      rows.push(`${new Date(start).toISOString()},${new Date(start + 3_600_000).toISOString()},Grid fault`);
    }
    const profile = createCommissionedSiteProfile({ ...input, outageCsv: rows.join("\n"), outageObservationWindow: thirtyDayWindow });
    expect(profile.evidence?.reliability).toBe("INSUFFICIENT_HISTORY");
    expect(profile.status).toBe("PARTIALLY_VERIFIED");
  });

  it("rejects absent, reversed, offset-free or incomplete observation windows", () => {
    const { outageObservationWindow: _ignored, ...missing } = input;
    expect(CommissionSiteBody.safeParse(missing).success).toBe(false);
    for (const outageObservationWindow of [
      { ...thirtyDayWindow, endedAt: thirtyDayWindow.startedAt },
      { ...thirtyDayWindow, endedAt: "2024-12-01T00:00:00Z" },
      { ...thirtyDayWindow, startedAt: "2025-01-01T00:00:00" },
      { ...thirtyDayWindow, continuousCoverage: false },
    ]) expect(CommissionSiteBody.safeParse({ ...input, outageObservationWindow }).success).toBe(false);
  });

  it("rejects out-of-window, censored, invalid, duplicate and overlapping events instead of discarding them", () => {
    for (const row of [
      "2024-12-31T10:00:00Z,2025-01-01T12:00:00Z,Out of window",
      "2025-01-30T10:00:00Z,2025-02-01T12:00:00Z,Right censored",
      "2025-01-31T00:00:00Z,2025-01-31T01:00:00Z,Exclusive boundary",
      "2025-01-15T10:00:00Z,2025-01-15T09:00:00Z,Negative duration",
      "invalid,2025-01-15T09:00:00Z,Invalid time",
      "2025-01-15T10:00:00,2025-01-15T12:00:00,No offset",
      "2025-01-15T10:00:00Z,2025-01-15T12:00:00Z,Duplicate",
      "2025-01-15T11:00:00Z,2025-01-15T13:00:00Z,Overlap",
    ]) {
      expect(() => createCommissionedSiteProfile({ ...input, outageObservationWindow: thirtyDayWindow, outageCsv: `${oneOutage}\n${row}` })).toThrow();
    }
  });

  it("does not let legacy commissioned profiles claim full verification without exposure", () => {
    const profile = createCommissionedSiteProfile(input);
    expect(SiteDataProfile.safeParse({ ...profile, status: "VERIFIED_SITE", evidence: undefined }).success).toBe(false);
    expect(SiteDataProfile.safeParse({ ...profile, scope: "PUBLIC_REFERENCE", status: "VERIFIED_REFERENCE", evidence: undefined, reliability: { ...profile.reliability, observationWindow: undefined, frequencyInterval95: undefined } }).success).toBe(true);
    expect(SiteDataProfile.safeParse({ ...profile, reliability: { ...profile.reliability, observationWindow: { ...profile.reliability.observationWindow, durationYears: 2 } } }).success).toBe(false);
    expect(SiteDataProfile.safeParse({ ...profile, evidence: { ...profile.evidence, reliability: "VERIFIED", overall: "VERIFIED" }, status: "VERIFIED_SITE" }).success).toBe(false);
    expect(SiteDataProfile.safeParse({ ...profile, evidence: { ...profile.evidence, overall: "REVIEW" } }).success).toBe(false);
  });

  it("rejects corrupted intervals and impossible PV rather than silently changing the fitted profile", () => {
    const duplicate = input.demandCsv.split("\n")[1];
    expect(() => createCommissionedSiteProfile({ ...input, demandCsv: `${input.demandCsv}\n${duplicate}` })).toThrow(/Duplicate/);
    expect(() => createCommissionedSiteProfile({ ...input, demandCsv: input.demandCsv.replace(duplicate, "2025-01-01T00:01:00Z,400") })).toThrow(/quarter-hour/);
    expect(() => createCommissionedSiteProfile({ ...input, demandCsv: input.demandCsv.replace(duplicate, "2025-01-01T00:00:00Z,-10") })).toThrow(/nonnegative/);
    expect(() => createCommissionedSiteProfile({ ...input, pvCapacityKW: 1 })).toThrow(/exceed.*capacity/);
  });

  it("matches a published exact-count example and remains finite for large logs", () => {
    const interval = outageFrequencyInterval95(14, 400);
    expect(interval.lowerInterruptionsPerYear).toBeCloseTo(0.019135, 6);
    expect(interval.upperInterruptionsPerYear).toBeCloseTo(0.058724, 6);
    const large = outageFrequencyInterval95(100_000, 20);
    expect(large.lowerInterruptionsPerYear).toBeGreaterThan(0);
    expect(large.lowerInterruptionsPerYear).toBeLessThan(5000);
    expect(large.upperInterruptionsPerYear).toBeGreaterThan(5000);
    expect(Number.isFinite(large.upperInterruptionsPerYear)).toBe(true);
  });

  it("loads valid profiles despite invalid, legacy, mismatched or symlink files without changing originals", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grounded-site-profiles-"));
    const warning = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const profile = createCommissionedSiteProfile(input);
      await persistCommissionedProfile(profile, directory);
      const invalid = '{"private_telemetry":"DO_NOT_LOG_THIS"';
      await writeFile(join(directory, "invalid.json"), invalid);
      const legacy = JSON.stringify({ ...profile, id: "legacy", status: "VERIFIED_SITE", evidence: undefined });
      await writeFile(join(directory, "legacy.json"), legacy);
      await writeFile(join(directory, "mismatched.json"), JSON.stringify(profile));
      // Symlink creation requires a Windows privilege on some test hosts.
      // If available, assert the loader never reads even a valid linked profile.
      let linkCreated = false;
      try {
        await writeFile(join(directory, "linked-target.txt"), JSON.stringify({ ...profile, id: "linked" }));
        await symlink(join(directory, "linked-target.txt"), join(directory, "linked.json"), "file");
        linkCreated = true;
      } catch (error) {
        if (!["EPERM", "EACCES", "ENOSYS"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
      expect(await loadCommissionedProfiles(directory)).toEqual([profile]);
      expect(await readFile(join(directory, "invalid.json"), "utf8")).toBe(invalid);
      expect(await readFile(join(directory, "legacy.json"), "utf8")).toBe(legacy);
      const warnings = warning.mock.calls.flat().join("\n");
      expect(warnings).toContain("invalid.json");
      expect(warnings).toContain("legacy.json");
      expect(warnings).toContain("mismatched.json");
      if (linkCreated) expect(warnings).toContain("linked.json");
      expect(warnings).not.toContain("DO_NOT_LOG_THIS");
      expect(warnings).not.toContain(input.siteName);
    } finally {
      warning.mockRestore();
      // Only delete this test's verified, randomly allocated temporary subtree.
      const absolute = resolve(directory);
      if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`) || !absolute.split(sep).at(-1)?.startsWith("grounded-site-profiles-")) throw new Error("Unsafe test cleanup target");
      await rm(absolute, { recursive: true, force: true });
    }
  });

  it("rejects unsafe persisted identities and does not overwrite existing proof", async () => {
    const directory = await mkdtemp(join(tmpdir(), "grounded-site-profiles-"));
    try {
      const profile = createCommissionedSiteProfile(input);
      await expect(persistCommissionedProfile({ ...profile, id: "../escape" }, directory)).rejects.toThrow(/safe/);
      await persistCommissionedProfile(profile, directory);
      await expect(persistCommissionedProfile(profile, directory)).rejects.toThrow();
      expect(await loadCommissionedProfiles(directory)).toEqual([profile]);
    } finally {
      const absolute = resolve(directory);
      if (!absolute.startsWith(`${resolve(tmpdir())}${sep}`) || !absolute.split(sep).at(-1)?.startsWith("grounded-site-profiles-")) throw new Error("Unsafe test cleanup target");
      await rm(absolute, { recursive: true, force: true });
    }
  });
});
