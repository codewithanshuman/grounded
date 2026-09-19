import { expect, test } from "@playwright/test";

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
    const start = Date.UTC(2025, index, 10, 9);
    rows.push(`${new Date(start).toISOString()},${new Date(start + 90 * 60_000).toISOString()},Distribution fault`);
  }
  return rows.join("\n");
}

test("judge path runs measured extreme futures and exposes auditable proof", async ({ page }) => {
  test.setTimeout(120_000);
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Test tomorrow/ })).toBeVisible();
  await expect(page.locator(".run-controls select").nth(2)).toHaveValue("ausgrid-measured-reference-v1");
  await page.locator(".run-controls select").nth(1).selectOption("500");
  await page.getByRole("button", { name: /Extreme Combined Event/ }).click();
  await page.getByRole("button", { name: /RUN SIMULATION/ }).click();
  await expect(page.getByText("7/7 invariants passed")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("deterministic futures", { exact: true })).toBeVisible();
  await expect(page.getByText("MONTE CARLO PRECISION")).toBeVisible();
  await expect(page.getByText("SECOND-ORDER INTERACTION")).toBeVisible();
  await expect(page.getByText("PHYSICS-INFORMED ML AUDIT")).toBeVisible();
  await expect(page.getByText("HOLDOUT AUROC")).toBeVisible();
  await page.getByRole("button", { name: /06 Method/ }).click();
  await expect(page.getByText("OUT-OF-SAMPLE VALIDATION")).toBeVisible();
  await expect(page.getByText(/9,210 events/)).toBeVisible();
  await expect(page.getByText(/holdout PASS/)).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("optimizer proves paired holdout safety and assumption-shock stability", async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await page.locator(".run-controls select").nth(1).selectOption("500");
  await page.getByRole("button", { name: /Extreme Combined Event/ }).click();
  await page.getByRole("button", { name: /RUN SIMULATION/ }).click();
  await expect(page.getByText("7/7 invariants passed")).toBeVisible({ timeout: 90_000 });
  await page.getByRole("button", { name: /04 Strategy/ }).click();
  await page.getByRole("button", { name: "Run optimizer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Same future. Better outcome." })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/saved · \d+ introduced/)).toBeVisible();
  await page.getByRole("button", { name: /04 Strategy/ }).click();
  await expect(page.getByText("PAIRED GENERALIZATION AUDIT")).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/zero-regression cohorts/)).toBeVisible();
  await expect(page.getByText("+20% restoration time")).toBeVisible();
  await expect(page.getByText(/introduced/).first()).toBeVisible();
});

test("commissioning UI creates and activates a verified local profile", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /06 Method/ }).click();
  const uniqueName = `Jaipur E2E Clinic ${Date.now()}`;
  const card = page.locator(".commissioning-card");
  await card.getByLabel("Site name").fill(uniqueName);
  await card.getByLabel("IANA timezone").fill("UTC");
  await card.getByLabel("Installed PV capacity").fill("500");
  await card.getByLabel("Demand CSV").setInputFiles({ name: "demand.csv", mimeType: "text/csv", buffer: Buffer.from(intervalCsv("demand")) });
  await card.getByLabel("PV CSV").setInputFiles({ name: "pv.csv", mimeType: "text/csv", buffer: Buffer.from(intervalCsv("pv")) });
  await card.getByLabel("Outage CSV").setInputFiles({ name: "outages.csv", mimeType: "text/csv", buffer: Buffer.from(outageCsv()) });
  await card.getByRole("button", { name: /Commission site twin/ }).click();
  await expect(card.getByText("Commissioned", { exact: true })).toBeVisible();
  await expect(page.locator(".run-controls select").nth(2)).toContainText(`${uniqueName} commissioned data`);
  await expect(page.getByText("VERIFIED SITE", { exact: true })).toBeVisible();
});

test("mobile evidence laboratory has no horizontal overflow and keeps core controls reachable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("button", { name: /RUN SIMULATION/ })).toBeVisible();
  await page.getByRole("button", { name: /06 Method/ }).click();
  await expect(page.getByRole("heading", { name: "Turn three exports into a site twin" })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.body.scrollWidth }));
  expect(dimensions.content).toBeLessThanOrEqual(dimensions.viewport);
});
