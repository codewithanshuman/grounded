import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const baseURL = process.env.GROUNDED_CAPTURE_URL ?? "http://127.0.0.1:8794";
const outputDir = resolve("docs/devpost-media");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.setDefaultTimeout(90_000);

async function settle() {
  await page.evaluate(async () => {
    await document.fonts.ready;
    document.querySelectorAll("*").forEach((element) => {
      if (element instanceof HTMLElement) {
        element.style.animationDuration = "0s";
        element.style.transitionDuration = "0s";
      }
    });
  });
  await page.waitForTimeout(350);
}

async function waitForToastToClear() {
  await page.locator(".light-toast").waitFor({ state: "hidden", timeout: 10_000 }).catch(() => undefined);
}

async function capture(name, target) {
  if (target) {
    await target.waitFor({ state: "visible" });
    await target.scrollIntoViewIfNeeded();
    await target.evaluate((element) => {
      const scroller = document.querySelector(".lab-content");
      if (scroller instanceof HTMLElement) {
        const delta = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 96;
        scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + delta), behavior: "instant" });
      } else {
        const top = element.getBoundingClientRect().top + window.scrollY - 108;
        window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
      }
    });
  } else {
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: "instant" });
      const scroller = document.querySelector(".lab-content");
      if (scroller instanceof HTMLElement) scroller.scrollTo({ top: 0, behavior: "instant" });
    });
  }
  await settle();
  await page.screenshot({
    path: resolve(outputDir, `${name}.jpg`),
    type: "jpeg",
    quality: 91,
    fullPage: false,
  });
}

try {
  await page.goto(baseURL, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Jaipur resilience district" }).waitFor({ state: "visible" });
  await capture("01-grounded-hero");
  await capture("02-living-digital-twin", page.locator(".overview-grid"));

  await page.locator(".run-controls select").nth(1).selectOption("500");
  await page.getByRole("button", { name: /Extreme Combined Event/ }).click();
  await page.getByRole("button", { name: /RUN SIMULATION/ }).click();
  await page.getByText("7/7 invariants passed").waitFor({ state: "visible", timeout: 120_000 });
  await waitForToastToClear();
  await capture("04-risk-forensics", page.locator(".analysis-card"));
  await capture("05-statistical-reliability", page.locator(".statistical-depth"));
  await capture("06-interpretable-ml-audit", page.locator(".surrogate-card"));

  await page.getByRole("button", { name: "Living twin" }).click();
  await page.getByRole("button", { name: "Run all-hazard climate matrix" }).click();
  await page.getByRole("heading", { name: "Climate resilience matrix" }).waitFor({ state: "visible", timeout: 120_000 });
  await capture("03-climate-resilience-matrix", page.locator(".analysis-card"));

  await page.getByRole("button", { name: "Strategy" }).click();
  await page.getByRole("button", { name: "Run optimizer", exact: true }).click();
  await page.getByRole("heading", { name: "Same future. Better outcome." }).waitFor({ state: "visible", timeout: 180_000 });
  await waitForToastToClear();
  await capture("11-same-seed-counterfactual", page.locator(".analysis-card"));

  await page.getByRole("button", { name: "Strategy" }).click();
  await page.getByText("PAIRED GENERALIZATION AUDIT").waitFor({ state: "visible" });
  await capture("07-optimizer-recommendation", page.locator(".analysis-card"));
  await capture("08-paired-generalization-audit", page.locator(".optimizer-validation"));
  await capture("09-compound-stress-envelope", page.locator(".joint-stress-envelope"));
  await capture("10-pareto-decision-stability", page.locator(".decision-stability"));

  await page.getByRole("button", { name: "Method" }).click();
  await page.getByText("MODEL CARD · ENGINE 2.6").waitFor({ state: "visible" });
  await capture("12-transparent-model-card", page.locator(".model-card-hero"));
  await capture("13-measured-operational-evidence", page.locator(".site-data-card"));
  await capture("14-jaipur-facility-anchor", page.locator(".jaipur-anchor-card"));
  await capture("15-local-site-commissioning", page.locator(".commissioning-card"));
} finally {
  await browser.close();
}
