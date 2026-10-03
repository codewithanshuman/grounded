import { describe, expect, it } from "vitest";
import { chooseWorldPerformanceProfile } from "../src/game/performanceProfile";

describe("world renderer performance profile", () => {
  it("uses 60fps high-performance rendering on capable desktops", () => {
    expect(chooseWorldPerformanceProfile({ logicalCores: 16, memoryGB: 16 })).toEqual({
      mode: "HIGH_QUALITY", targetFps: 60, powerPreference: "high-performance",
    });
  });

  it("balances mid-range devices and protects reduced-motion or constrained devices", () => {
    expect(chooseWorldPerformanceProfile({ logicalCores: 8, memoryGB: 8 }).targetFps).toBe(45);
    expect(chooseWorldPerformanceProfile({ logicalCores: 12, memoryGB: 16, saveData: true })).toEqual({
      mode: "BATTERY_SAVER", targetFps: 30, powerPreference: "low-power",
    });
    expect(chooseWorldPerformanceProfile({ logicalCores: 12, memoryGB: 16, reducedMotion: true }).targetFps).toBe(30);
  });
});
