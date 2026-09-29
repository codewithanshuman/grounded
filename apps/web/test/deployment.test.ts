import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8"));

describe("Vercel single-page application routing", () => {
  it("serves the dashboard fallback through the clean root URL", () => {
    // With cleanUrls enabled, /index.html is no longer a valid rewrite target.
    // The root serves the entry document for /lab and OAuth return URLs.
    expect(config.cleanUrls).toBe(true);
    expect(config.rewrites).toContainEqual({ source: "/(.*)", destination: "/" });
  });
});
