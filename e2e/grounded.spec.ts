import { expect, test, type Page } from "@playwright/test";
import { RunSummary, SiteDataProfile } from "../packages/protocol/src/index.js";
import { OptimizationEvidence } from "../packages/protocol/src/evidence.js";
import { assessOptimizationGrowth } from "../packages/sim/src/growth.js";

function workspace(page: Page, name: "Twin" | "Risk" | "Strategy" | "Proof" | "Method") {
  const accessibleName = name === "Twin" ? "Living twin" : name === "Risk" ? "Risk evidence" : name;
  return page.getByRole("navigation", { name: "Analysis workspaces" }).getByRole("button", { name: accessibleName, exact: true });
}

async function runExtremeBaseline(page: Page) {
  await page.getByRole("combobox", { name: "Site data", exact: true }).selectOption("ausgrid-measured-reference-v1");
  await page.getByRole("combobox", { name: "Population", exact: true }).selectOption("500");
  await page.getByRole("button", { name: /Extreme Combined Event/ }).click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/simulate") && response.request().method() === "POST", { timeout: 90_000 });
  await page.getByRole("button", { name: /RUN SIMULATION/ }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const baseline = RunSummary.parse((await response.json()).summary);
  expect(baseline.n).toBe(500);
  expect(baseline.siteData?.id).toBe("ausgrid-measured-reference-v1");
  expect(baseline.audit?.status).toBe("PASS");
  await expect(page.getByRole("heading", { name: "Where the system breaks", exact: true })).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("7/7 invariants passed", { exact: true })).toBeVisible();
  return baseline;
}

function intervalCsv(kind: "demand" | "pv"): string {
  const rows = [kind === "demand" ? "timestamp,demand_kw" : "timestamp,pv_kw"];
  const start = Date.UTC(2026, 0, 1);
  for (let step = 0; step < 32 * 96; step++) {
    const hour = (step % 96) / 4;
    const value = kind === "demand" ? 410 + 80 * Math.exp(-((hour - 19) ** 2) / 10) : Math.max(0, 480 * Math.sin(Math.PI * (hour - 6) / 12));
    rows.push(`${new Date(start + step * 900_000).toISOString()},${value.toFixed(3)}`);
  }
  return rows.join("\n");
}

function outageCsv(): string {
  const rows = ["outage_started_at,restored_at,cause"];
  for (let index = 0; index < 10; index++) {
    const start = Date.UTC(2026, 0, 2 + index * 3, 9);
    rows.push(`${new Date(start).toISOString()},${new Date(start + 90 * 60_000).toISOString()},Distribution fault`);
  }
  return rows.join("\n");
}

test("judge path runs measured extreme futures and exposes auditable proof", async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/lab");
  await runExtremeBaseline(page);
  await expect(page.getByText("deterministic futures", { exact: true })).toBeVisible();
  await expect(page.getByText("MONTE CARLO PRECISION")).toBeVisible();
  await expect(page.getByText("SECOND-ORDER INTERACTION")).toBeVisible();
  await expect(page.getByText("PHYSICS-INFORMED ML AUDIT")).toBeVisible();
  await expect(page.getByText("HOLDOUT AUROC")).toBeVisible();
  await workspace(page, "Method").click();
  await expect(page.getByText("OUT-OF-SAMPLE VALIDATION")).toBeVisible();
  await expect(page.getByText("DEMAND HOLDOUT", { exact: true })).toBeVisible();
  await expect(page.getByText("PV HOLDOUT", { exact: true })).toBeVisible();
  await expect(page.getByText("OUTAGE HOLDOUT", { exact: true })).toBeVisible();
  await expect(page.locator(".site-data-card .holdout-proof").getByText("PASS", { exact: true })).toBeVisible();
  await expect(page.locator(".site-data-card")).toContainText("NSW");
  expect(consoleErrors).toEqual([]);
});

test("target-aware optimizer preserves complete proof across reload without duplicating growth", async ({ page }) => {
  test.setTimeout(300_000);
  await page.goto("/lab");
  const baseline = await runExtremeBaseline(page);
  await workspace(page, "Twin").click();
  await page.getByRole("combobox", { name: "Critical risk planning target", exact: true }).selectOption("10");
  await workspace(page, "Strategy").click();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/optimize") && response.request().method() === "POST", { timeout: 150_000 });
  await page.getByRole("button", { name: "Run optimizer", exact: true }).click();
  const response = await responsePromise;
  expect(response.request().postDataJSON()).toEqual({ runId: baseline.runId, riskTargetPct: 10 });
  expect(response.ok()).toBe(true);
  const rawOptimization = await response.json();
  const optimization = OptimizationEvidence.parse(rawOptimization);
  expect(optimization.analysis.riskTargetPct).toBe(10);
  expect(optimization.analysis.discoveryOnly).toBe(true);
  expect(optimization.analysis.evaluatedStrategies).toBe(245);
  expect(optimization.validation.riskTargetPct).toBe(10);
  expect(optimization.validation.cohorts).toHaveLength(3);
  for (const cohort of optimization.validation.cohorts) {
    expect(cohort.clusterUncertainty.clusterCount).toBeLessThan(cohort.sampleSize);
    expect(cohort.pairedClusterSampleSize).toBe(cohort.clusterUncertainty.clusterCount);
    expect(cohort.targetMet).toBe(cohort.clusterUncertainty.upperCriticalRiskPct <= 10);
  }
  const growthVerdict = assessOptimizationGrowth(baseline, optimization.result, optimization, 10);
  expect(rawOptimization.growthAssessment.eligible).toBe(growthVerdict.eligible);
  expect(rawOptimization.growthAssessment.pairedSupport).toBe(growthVerdict.pairedSupport);
  expect(optimization.growthEvents.some((event) => event.kind === "building.grown")).toBe(growthVerdict.eligible);
  await expect(page.getByRole("heading", { name: "Same future. Two strategies.", exact: true })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/saved · \d+ introduced/)).toBeVisible();
  await workspace(page, "Strategy").click();
  await expect(page.getByText("PAIRED GENERALIZATION AUDIT")).toBeVisible({ timeout: 150_000 });
  await expect(page.locator(".validation-lead").getByText(/statistically resolved/)).toBeVisible();
  await expect(page.getByText("+20% restoration time")).toBeVisible();
  await expect(page.getByText("81-CELL COMPOUND STRESS ENVELOPE")).toBeVisible();
  await expect(page.getByText("DISCLOSED WORST CASE")).toBeVisible();
  await expect(page.getByText("PARETO DECISION STABILITY")).toBeVisible();
  await expect(page.getByText(/Rank \d+\/\d+/).first()).toBeVisible();
  await expect(page.getByText(/introduced/).first()).toBeVisible();

  const ledger = await page.locator(".evidence-values").innerText();
  const persistedResponse = await page.request.get(`/api/evidence/${baseline.runId}`);
  expect(persistedResponse.ok()).toBe(true);
  const persisted = await persistedResponse.json();
  expect(RunSummary.parse(persisted.baseline)).toEqual(baseline);
  expect(OptimizationEvidence.parse(persisted.optimization)).toEqual(optimization);

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Critical risk planning target", exact: true })).toHaveValue("10");
  await expect(page.getByRole("combobox", { name: "Population", exact: true })).toHaveValue("500");
  await expect(page.locator(".decision-meta")).toHaveAttribute("title", baseline.runId);
  await expect(page.locator(".evidence-values")).toHaveText(ledger);
  await expect(page.getByText("Your inputs have changed.", { exact: true })).toHaveCount(0);
  await workspace(page, "Strategy").click();
  await expect(page.getByText("PAIRED GENERALIZATION AUDIT", { exact: true })).toBeVisible();
  await expect(page.getByText("81-CELL COMPOUND STRESS ENVELOPE", { exact: true })).toBeVisible();
  await expect(page.getByText("PARETO DECISION STABILITY", { exact: true })).toBeVisible();
  await workspace(page, "Proof").click();
  await expect(page.getByRole("heading", { name: "Same future. Two strategies.", exact: true })).toBeVisible();
  await expect(page.locator(".proof-audit-strip")).toContainText(optimization.result.manifest!.runFingerprint);
  await expect(page.locator(".evidence-values")).toHaveText(ledger);
});

test("commissioning separates verified energy profiles from insufficient reliability history", async ({ page }) => {
  await page.goto("/lab");
  await workspace(page, "Method").click();
  const uniqueName = `Jaipur E2E Clinic ${Date.now()}`;
  const card = page.locator(".commissioning-card");
  await card.getByLabel("Site name").fill(uniqueName);
  await card.getByLabel("IANA timezone").fill("UTC");
  await card.getByLabel("PV inverter capacity").fill("500");
  await card.getByLabel("Outage-log coverage start (inclusive)").fill("2026-01-01T00:00:00Z");
  await card.getByLabel("Outage-log coverage end (exclusive)").fill("2026-02-02T00:00:00Z");
  await card.getByRole("checkbox", { name: /I confirm the log covers this entire period/ }).check();
  await card.getByLabel("Demand CSV").setInputFiles({ name: "demand.csv", mimeType: "text/csv", buffer: Buffer.from(intervalCsv("demand")) });
  await card.getByLabel("PV CSV").setInputFiles({ name: "pv.csv", mimeType: "text/csv", buffer: Buffer.from(intervalCsv("pv")) });
  await card.getByLabel("Outage CSV").setInputFiles({ name: "outages.csv", mimeType: "text/csv", buffer: Buffer.from(outageCsv()) });
  const responsePromise = page.waitForResponse((response) => response.url().endsWith("/api/site-data/commission") && response.request().method() === "POST");
  await card.getByRole("button", { name: /Commission site twin/ }).click();
  const response = await responsePromise;
  expect(response.ok()).toBe(true);
  const profile = SiteDataProfile.parse((await response.json()).profile);
  expect(profile.status).toBe("PARTIALLY_VERIFIED");
  expect(profile.evidence?.demand).toBe("VERIFIED");
  expect(profile.evidence?.pv).toBe("VERIFIED");
  expect(profile.evidence?.reliability).toBe("INSUFFICIENT_HISTORY");
  expect(profile.reliability.observationWindow?.durationDays).toBe(32);
  expect(profile.reliability.saifiInterruptionsPerCustomerYear).toBeCloseTo(10 / 32 * 365.25, 6);
  expect(profile.reliability.frequencyInterval95?.method).toBe("EXACT_POISSON");
  expect(profile.reliability.frequencyInterval95!.upperInterruptionsPerYear).toBeGreaterThan(profile.reliability.saifiInterruptionsPerCustomerYear);
  await expect(card.getByText("Commissioned", { exact: true })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Site data", exact: true })).toHaveValue(profile.id);
  await expect(page.locator(".site-data-card")).toContainText(`${uniqueName} commissioned data`);
  await expect(page.locator(".site-data-card")).toContainText("PARTIALLY VERIFIED");
  await expect(page.locator(".site-data-card")).toContainText("INSUFFICIENT HISTORY");
  await expect(page.locator(".site-data-card")).toContainText("32.0 days");
  await expect(page.locator(".site-data-card").getByText("VERIFIED SITE", { exact: true })).toHaveCount(0);
});

test("mobile evidence laboratory has no horizontal overflow and keeps core controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/lab");
  await expect(page.getByRole("button", { name: /RUN SIMULATION/ })).toBeVisible();
  await workspace(page, "Method").click();
  await expect(page.getByRole("heading", { name: "Turn three exports into a site twin" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.body.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
