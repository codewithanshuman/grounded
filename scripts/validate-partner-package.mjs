import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const inbox = resolve(process.argv[2] ?? "validation/inbox");
const failures = [];
const warnings = [];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const splitCsv = (text) => text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter(Boolean);

async function load(name) {
  try { return await readFile(resolve(inbox, name)); }
  catch { failures.push(`Missing required file: ${name}`); return Buffer.from(""); }
}

const manifestBuffer = await load("manifest.json");
let manifest = {};
try { manifest = JSON.parse(manifestBuffer.toString("utf8")); }
catch { failures.push("manifest.json is not valid JSON"); }

for (const field of ["organizationName", "facilityName", "reviewerName", "reviewerRole", "reviewerOrganizationEmail", "confirmedAt", "timezone", "meterBoundary", "pvCapacityKW", "criticalLoadDefinition"]) {
  if (manifest[field] === undefined || manifest[field] === "" || String(manifest[field]).startsWith("REPLACE")) failures.push(`Manifest field is required: ${field}`);
}
if (manifest.schemaVersion !== 1) failures.push("schemaVersion must be 1");
if (!manifest.permissions?.analyzePrivately) failures.push("Explicit analyzePrivately permission is required");
if (manifest.permissions?.publishRawTelemetry) warnings.push("Raw telemetry publication is enabled; obtain separate written authorization and security review");
if (!Number.isFinite(Number(manifest.pvCapacityKW)) || Number(manifest.pvCapacityKW) <= 0) failures.push("pvCapacityKW must be a positive number");
try { new Intl.DateTimeFormat("en", { timeZone: manifest.timezone }); } catch { failures.push("timezone must be a valid IANA timezone"); }
if (!Number.isFinite(Date.parse(manifest.confirmedAt))) failures.push("confirmedAt must be an ISO 8601 timestamp");

const expected = { demand: "demand.csv", pv: "pv.csv", outages: "outages.csv" };
for (const [key, name] of Object.entries(expected)) if (manifest.files?.[key] !== name) failures.push(`manifest.files.${key} must be ${name}`);

const demandBuffer = await load(expected.demand);
const pvBuffer = await load(expected.pv);
const outagesBuffer = await load(expected.outages);

function inspectIntervals(buffer, valueColumn, label) {
  const lines = splitCsv(buffer.toString("utf8"));
  const headers = (lines.shift() ?? "").split(",").map((value) => value.trim().toLowerCase());
  const timestampIndex = headers.indexOf("timestamp");
  const valueIndex = headers.indexOf(valueColumn);
  if (timestampIndex < 0 || valueIndex < 0) { failures.push(`${label} must use header timestamp,${valueColumn}`); return null; }
  const rows = lines.map((line) => line.split(",")).map((columns) => ({ timestamp: Date.parse(columns[timestampIndex]), value: Number(columns[valueIndex]) })).filter((row) => Number.isFinite(row.timestamp) && Number.isFinite(row.value) && row.value >= 0).sort((a, b) => a.timestamp - b.timestamp);
  if (rows.length < 96) failures.push(`${label} needs at least 96 valid readings`);
  const unique = new Set(rows.map((row) => row.timestamp));
  if (unique.size !== rows.length) failures.push(`${label} contains ${rows.length - unique.size} duplicate timestamps`);
  if (!rows.length) return null;
  const spanSlots = Math.floor((rows.at(-1).timestamp - rows[0].timestamp) / 900000) + 1;
  const completenessPct = Number((unique.size / Math.max(1, spanSlots) * 100).toFixed(2));
  const cadenceErrors = rows.slice(1).filter((row, index) => (row.timestamp - rows[index].timestamp) % 900000 !== 0).length;
  const spanDays = Number(((rows.at(-1).timestamp - rows[0].timestamp) / 86400000).toFixed(2));
  if (spanDays < 29) failures.push(`${label} spans ${spanDays} days; at least 30 continuous days are required`);
  if (completenessPct < 95) failures.push(`${label} completeness is ${completenessPct}%; at least 95% is required`);
  if (cadenceErrors) failures.push(`${label} has ${cadenceErrors} intervals off the 15-minute cadence`);
  return { readings: rows.length, first: new Date(rows[0].timestamp).toISOString(), last: new Date(rows.at(-1).timestamp).toISOString(), spanDays, completenessPct, cadenceErrors };
}

function inspectOutages(buffer) {
  const lines = splitCsv(buffer.toString("utf8"));
  const headers = (lines.shift() ?? "").split(",").map((value) => value.trim().toLowerCase());
  const startIndex = headers.indexOf("outage_started_at");
  const restoredIndex = headers.indexOf("restored_at");
  if (startIndex < 0 || restoredIndex < 0) { failures.push("outages.csv must include outage_started_at,restored_at,cause"); return null; }
  const rows = lines.map((line) => line.split(",")).map((columns) => ({ start: Date.parse(columns[startIndex]), restored: Date.parse(columns[restoredIndex]) })).filter((row) => Number.isFinite(row.start) && Number.isFinite(row.restored));
  const invalidChronology = rows.filter((row) => row.restored <= row.start).length;
  if (!rows.length) failures.push("outages.csv needs at least one valid event");
  if (invalidChronology) failures.push(`outages.csv has ${invalidChronology} restoration timestamps before start`);
  if (rows.length < 5) warnings.push("Fewer than five outage events limits restoration-distribution validation");
  return { events: rows.length, invalidChronology };
}

const demand = inspectIntervals(demandBuffer, "demand_kw", "demand.csv");
const pv = inspectIntervals(pvBuffer, "pv_kw", "pv.csv");
const outages = inspectOutages(outagesBuffer);

const report = {
  status: failures.length ? "REJECT" : warnings.length ? "PASS_WITH_WARNINGS" : "PASS",
  organization: manifest.organizationName ?? null,
  facility: manifest.facilityName ?? null,
  reviewer: manifest.reviewerName && manifest.reviewerRole ? `${manifest.reviewerName}, ${manifest.reviewerRole}` : null,
  permissions: manifest.permissions ?? null,
  demand,
  pv,
  outages,
  hashes: {
    manifest: sha256(manifestBuffer),
    demand: sha256(demandBuffer),
    pv: sha256(pvBuffer),
    outages: sha256(outagesBuffer),
  },
  failures,
  warnings,
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = failures.length ? 1 : 0;
