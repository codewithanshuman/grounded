import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const directory = await mkdtemp(join(tmpdir(), "grounded-partner-validator-"));
try {
  const start = Date.UTC(2026, 0, 1);
  const demand = ["timestamp,demand_kw"];
  const pv = ["timestamp,pv_kw"];
  for (let step = 0; step < 31 * 96; step++) {
    const timestamp = new Date(start + step * 900_000).toISOString();
    const hour = (step % 96) / 4;
    demand.push(`${timestamp},${(400 + 80 * Math.exp(-((hour - 19) ** 2) / 12)).toFixed(3)}`);
    pv.push(`${timestamp},${Math.max(0, 70 * Math.sin(Math.PI * (hour - 6) / 12)).toFixed(3)}`);
  }
  const outages = ["outage_started_at,restored_at,cause"];
  for (let index = 0; index < 10; index++) {
    const outageStart = Date.UTC(2025, index, 10, 8);
    outages.push(`${new Date(outageStart).toISOString()},${new Date(outageStart + 90 * 60_000).toISOString()},Distribution fault`);
  }
  const manifest = {
    schemaVersion: 1,
    organizationName: "Validator Test Organization",
    facilityName: "Validator Test Facility",
    reviewerName: "Test Reviewer",
    reviewerRole: "Energy Manager",
    reviewerOrganizationEmail: "reviewer@example.org",
    confirmedAt: "2026-09-19T12:00:00+05:30",
    timezone: "Asia/Kolkata",
    meterBoundary: "Whole-facility import meter",
    pvCapacityKW: 70,
    criticalLoadDefinition: "Essential services panel, 25 kW",
    permissions: { analyzePrivately: true, publishDerivedProfile: false, nameOrganizationPublicly: false, publishRawTelemetry: false },
    files: { demand: "demand.csv", pv: "pv.csv", outages: "outages.csv" },
    notes: "Synthetic automated test only",
  };
  await Promise.all([
    writeFile(join(directory, "manifest.json"), JSON.stringify(manifest, null, 2)),
    writeFile(join(directory, "demand.csv"), `${demand.join("\n")}\n`),
    writeFile(join(directory, "pv.csv"), `${pv.join("\n")}\n`),
    writeFile(join(directory, "outages.csv"), `${outages.join("\n")}\n`),
  ]);
  const output = execFileSync(process.execPath, [fileURLToPath(new URL("./validate-partner-package.mjs", import.meta.url)), directory], { encoding: "utf8" });
  const report = JSON.parse(output);
  if (report.status !== "PASS" || report.demand.completenessPct !== 100 || report.pv.completenessPct !== 100 || report.outages.events !== 10) {
    throw new Error(`Unexpected validator result: ${output}`);
  }
  console.log(`Partner validator test passed: ${report.demand.readings} demand + ${report.pv.readings} PV readings, ${report.outages.events} outages.`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
