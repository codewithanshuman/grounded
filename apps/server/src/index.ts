import Fastify from "fastify";
import cors from "@fastify/cors";
import websocketPlugin from "@fastify/websocket";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import staticPlugin from "@fastify/static";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ClientMessage, LocationId as LocationIdSchema, MicrogridConfig as MicrogridConfigSchema,
  PresetId as PresetIdSchema, SiteDataProfile, type ClimateSweepResult, type RunSummary, type ServerMessage,
} from "@verdant/protocol";
import { DEFAULT_INTERVENTION, LOCATIONS, MODEL_VERSION, PRESETS, PRESET_ORDER, analyzeInterventions, analyzeSensitivity, locationFromCalibration, locationWithSiteData, runMonteCarlo, toRunSummary, validateIntervention } from "@verdant/sim";
import { openWorld } from "@verdant/world";
import { z } from "zod";
import { loadClimateCalibration } from "./climate.js";
import { CommissionSiteBody, createCommissionedSiteProfile, loadCommissionedProfiles, persistCommissionedProfile } from "./site-data.js";

const PORT = Number(process.env.PORT ?? 8787);
const DB_PATH = process.env.VERDANT_DB_PATH ?? "./verdant-forest.db";
const measuredReference = SiteDataProfile.parse(JSON.parse(readFileSync(new URL("../../../data/ausgrid-measured-reference.json", import.meta.url), "utf8")));
const siteProfiles = new Map((await loadCommissionedProfiles()).map((profile) => [profile.id, profile]));
siteProfiles.set(measuredReference.id, measuredReference);
const resolveSiteData = (id: string | undefined) => id === "representative-model" ? undefined : id ? siteProfiles.get(id) : measuredReference;

const world = openWorld(DB_PATH);
/** Hot cache for recent evidence. SQLite remains the durable source of truth,
 * so an audited run can still be optimized after a server restart. */
const runs = new Map<string, RunSummary>();

const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024, trustProxy: true });
const configuredOrigins = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
await app.register(cors, {
  origin(origin, callback) {
    const isLocal = !origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    callback(null, isLocal || configuredOrigins.includes(origin));
  },
});
await app.register(helmet, { contentSecurityPolicy: false, crossOriginEmbedderPolicy: false });
await app.register(rateLimit, { global: true, max: 300, timeWindow: "1 minute" });
await app.register(websocketPlugin);

const sockets = new Set<import("ws").WebSocket>();
function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) socket.send(payload);
  }
}

const SimulateBody = z.object({
  location: LocationIdSchema,
  preset: PresetIdSchema,
  config: MicrogridConfigSchema,
  scenarioCount: z.number().min(100).max(20000),
  siteDataProfileId: z.string().default(measuredReference.id),
});

app.get("/api/world", async () => world.getState());
app.get("/api/health", async () => ({ status: "ok", engine: MODEL_VERSION, profiles: siteProfiles.size, timestamp: new Date().toISOString() }));
app.get("/api/site-data/profiles", async () => ({
  profiles: [...siteProfiles.values()],
  representativeModel: { id: "representative-model", label: "Representative engineering profiles" },
}));
app.post("/api/site-data/commission", async (req, reply) => {
  const parsed = CommissionSiteBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  try {
    const profile = createCommissionedSiteProfile(parsed.data);
    if (siteProfiles.has(profile.id)) return reply.code(409).send({ error: "This exact commissioned dataset already exists", profileId: profile.id });
    await persistCommissionedProfile(profile);
    siteProfiles.set(profile.id, profile);
    return reply.code(201).send({ profile });
  } catch (error) {
    req.log.warn({ error }, "site commissioning rejected");
    return reply.code(422).send({ error: error instanceof Error ? error.message : "Site data could not be commissioned" });
  }
});
app.get("/api/calibration/:location", async (req, reply) => {
  const parsed = LocationIdSchema.safeParse((req.params as { location?: string }).location);
  if (!parsed.success) return reply.code(400).send({ error: "unknown location" });
  return loadClimateCalibration(parsed.data);
});

app.post("/api/simulate", async (req, reply) => {
  const parsed = SimulateBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { location, preset, config, scenarioCount, siteDataProfileId } = parsed.data;

  const calibration = await loadClimateCalibration(location);
  const siteData = resolveSiteData(siteDataProfileId);
  if (siteDataProfileId !== "representative-model" && !siteData) return reply.code(400).send({ error: "unknown siteDataProfileId" });
  const calibratedLocation = locationFromCalibration(locationWithSiteData(LOCATIONS[location], siteData), calibration);
  const mc = runMonteCarlo(scenarioCount, calibratedLocation, preset, config, DEFAULT_INTERVENTION);
  const sensitivity = analyzeSensitivity(calibratedLocation, preset, config, Math.min(300, scenarioCount));
  const summary = toRunSummary(randomUUID(), mc, calibration, sensitivity, 0, siteData);
  runs.set(summary.runId, summary);

  const growthEvents = world.recordRun(summary);
  broadcast({ type: "run.completed", summary });
  for (const event of growthEvents) broadcast({ type: "growth", event });
  broadcast({ type: "world", world: world.getState() });

  return { summary, growthEvents };
});

const SweepBody = z.object({
  location: LocationIdSchema,
  config: MicrogridConfigSchema,
  scenarioCount: z.number().min(100).max(2000).default(500),
  siteDataProfileId: z.string().default(measuredReference.id),
});

/** Runs one seeded population through every climate regime. Because each row
 * reuses the same seeds, differences are caused by the hazard—not sample luck. */
app.post("/api/climate-sweep", async (req, reply) => {
  const parsed = SweepBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const { location, config, scenarioCount, siteDataProfileId } = parsed.data;
  if (siteDataProfileId !== "representative-model" && !resolveSiteData(siteDataProfileId)) return reply.code(400).send({ error: "unknown siteDataProfileId" });
  const calibration = await loadClimateCalibration(location);
  const calibratedLocation = locationFromCalibration(locationWithSiteData(LOCATIONS[location], resolveSiteData(siteDataProfileId)), calibration);
  const scenarios = PRESET_ORDER.map((preset) => {
    const mc = runMonteCarlo(scenarioCount, calibratedLocation, preset, config, DEFAULT_INTERVENTION);
    const weightedRisk = mc.counts.critical + mc.counts.high * 0.45 + mc.counts.moderate * 0.12;
    const resilienceScore = Math.round((100 - (weightedRisk / scenarioCount) * 100) * 10) / 10;
    const dominantCause = Object.entries(mc.causeCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "No material risk";
    return {
      preset,
      label: PRESETS[preset].label,
      n: scenarioCount,
      counts: mc.counts,
      resilienceScore,
      criticalPct: Math.round((mc.counts.critical / scenarioCount) * 1000) / 10,
      dominantCause,
    };
  });
  const weakest = [...scenarios].sort((a, b) => a.resilienceScore - b.resilienceScore)[0];
  const result: ClimateSweepResult = {
    location,
    scenarioCount,
    robustScore: weakest.resilienceScore,
    weakestPreset: weakest.preset,
    scenarios,
    calibration,
    createdAt: Date.now(),
  };
  return result;
});

const OptimizeBody = z.object({ runId: z.string() });

app.post("/api/optimize", async (req, reply) => {
  const parsed = OptimizeBody.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const before = runs.get(parsed.data.runId) ?? world.getRun(parsed.data.runId);
  if (!before) return reply.code(404).send({ error: "unknown runId \u2014 run /api/simulate first" });

  const calibration = before.calibration ?? await loadClimateCalibration(before.location);
  const location = locationFromCalibration(locationWithSiteData(LOCATIONS[before.location], before.siteData), calibration);
  // Search on an independent seeded cohort, then validate the winner on the
  // original baseline population. This prevents training-set performance from
  // masquerading as evidence that the intervention generalizes.
  const analysis = analyzeInterventions(location, before.preset, before.config, 300, before.n, PRESET_ORDER);
  const intervention = analysis.best.intervention;
  const validation = validateIntervention(location, before.config, intervention, before.n + 10_000, 200, PRESET_ORDER);
  const mc = runMonteCarlo(before.n, location, before.preset, before.config, intervention);
  const after = toRunSummary(randomUUID(), mc, calibration, undefined, 0, before.siteData);
  runs.set(after.runId, after);

  let historicalBeforeCritical = 0;
  let historicalAfterCritical = 0;
  let passedPeriods = 0;
  const futuresPerPeriod = 24;
  const backtestPeriods = calibration.historicalDays.length ? calibration.historicalDays : calibration.monthly.map((month) => ({ ...month, date: month.month }));
  backtestPeriods.forEach((period, periodIndex) => {
    const historicalLocation = locationFromCalibration(locationWithSiteData(LOCATIONS[before.location], before.siteData), calibration, { ...period, month: period.date });
    const seedOffset = 50_000 + periodIndex * futuresPerPeriod;
    const historicalBefore = runMonteCarlo(futuresPerPeriod, historicalLocation, before.preset, before.config, DEFAULT_INTERVENTION, seedOffset);
    const historicalAfter = runMonteCarlo(futuresPerPeriod, historicalLocation, before.preset, before.config, intervention, seedOffset);
    historicalBeforeCritical += historicalBefore.counts.critical;
    historicalAfterCritical += historicalAfter.counts.critical;
    if (historicalAfter.counts.critical === 0) passedPeriods++;
  });
  const historicalBacktest = {
    periods: backtestPeriods.length,
    futures: backtestPeriods.length * futuresPerPeriod,
    beforeCritical: historicalBeforeCritical,
    afterCritical: historicalAfterCritical,
    passedPeriods,
    source: calibration.source,
    label: calibration.historicalDays.length
      ? "12 highest-stress observed NASA POWER climate days from 2023; outage and demand remain simulated"
      : "12 representative monthly climate profiles; all operational conditions are simulated",
  };

  const growthEvents = world.recordOptimization(before.runId, before, after);
  broadcast({ type: "optimize.completed", runId: before.runId, intervention, result: after });
  for (const event of growthEvents) broadcast({ type: "growth", event });
  broadcast({ type: "world", world: world.getState() });

  return { intervention, result: after, growthEvents, analysis, validation, historicalBacktest };
});

app.register(async (instance) => {
  instance.get("/ws", { websocket: true }, (socket) => {
    sockets.add(socket);
    socket.send(JSON.stringify({ type: "world", world: world.getState() } satisfies ServerMessage));
    socket.on("close", () => sockets.delete(socket));
    socket.on("message", (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = ClientMessage.parse(JSON.parse(raw.toString()));
      } catch {
        socket.send(JSON.stringify({ type: "error", message: "malformed client message" } satisfies ServerMessage));
        return;
      }
      // The WS channel currently only pushes growth broadcasts to clients;
      // simulate/optimize are driven over REST so they get normal HTTP
      // semantics (status codes, retries). Left here so a future browser
      // client can request runs without an extra HTTP round trip.
      if (msg.type === "simulate" || msg.type === "optimize") {
        socket.send(JSON.stringify({ type: "error", message: "use POST /api/simulate or /api/optimize \u2014 the WS channel is broadcast-only for now" } satisfies ServerMessage));
      }
    });
  });
});

const webDist = fileURLToPath(new URL("../../web/dist/", import.meta.url));
if (existsSync(webDist)) {
  await app.register(staticPlugin, { root: webDist, prefix: "/", wildcard: false });
  app.setNotFoundHandler((request, reply) => {
    if (request.method === "GET" && !request.url.startsWith("/api/") && request.url !== "/ws") return reply.sendFile("index.html");
    return reply.code(404).send({ error: "not found" });
  });
}

app.setErrorHandler((error, request, reply) => {
  request.log.error({ err: error }, "request failed");
  const failure = error as { statusCode?: number; message?: string };
  const statusCode = failure.statusCode && failure.statusCode < 500 ? failure.statusCode : 500;
  return reply.code(statusCode).send({ error: statusCode === 500 ? "internal server error" : failure.message ?? "request failed" });
});

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  app.log.info(`Grounded server listening on :${PORT}, forest persisted at ${DB_PATH}`);
});
