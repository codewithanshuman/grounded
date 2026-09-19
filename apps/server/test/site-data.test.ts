import { describe, expect, it } from "vitest";
import { createCommissionedSiteProfile } from "../src/site-data.js";

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
};

describe("site data commissioning", () => {
  it("turns three real-data CSV contracts into a verified, fingerprinted profile", () => {
    const profile = createCommissionedSiteProfile(input);
    expect(profile.scope).toBe("COMMISSIONED_SITE");
    expect(profile.status, JSON.stringify({ quality: profile.quality, validation: profile.validation })).toBe("VERIFIED_SITE");
    expect(profile.demand.completeSlots).toBe(96);
    expect(profile.pv.capacityFactor15m).toHaveLength(96);
    expect(profile.reliability.durationQuantilesHours).toHaveLength(101);
    expect(profile.validation?.status).toBe("PASS");
    expect(profile.fingerprint).toMatch(/^SITE-[A-F0-9]{12}$/);
  });

  it("is deterministic for identical commissioned inputs", () => {
    expect(createCommissionedSiteProfile(input).fingerprint).toBe(createCommissionedSiteProfile(input).fingerprint);
  });

  it("rejects missing timestamp/value contracts", () => {
    expect(() => createCommissionedSiteProfile({ ...input, demandCsv: "date,value\n2025-01-01,10" })).toThrow(/timestamp/i);
  });
});
