export type WorldPerformanceMode = "HIGH_QUALITY" | "BALANCED" | "BATTERY_SAVER";

export interface WorldDeviceCapabilities {
  logicalCores?: number;
  memoryGB?: number;
  saveData?: boolean;
  reducedMotion?: boolean;
}

export interface WorldPerformanceProfile {
  mode: WorldPerformanceMode;
  targetFps: 60 | 45 | 30;
  powerPreference: "high-performance" | "default" | "low-power";
}

export function chooseWorldPerformanceProfile(capabilities: WorldDeviceCapabilities): WorldPerformanceProfile {
  const cores = capabilities.logicalCores ?? 8;
  const memory = capabilities.memoryGB ?? 8;
  if (capabilities.saveData || capabilities.reducedMotion || cores <= 4 || memory <= 4) {
    return { mode: "BATTERY_SAVER", targetFps: 30, powerPreference: "low-power" };
  }
  if (cores <= 8 || memory <= 8) return { mode: "BALANCED", targetFps: 45, powerPreference: "default" };
  return { mode: "HIGH_QUALITY", targetFps: 60, powerPreference: "high-performance" };
}

export function detectWorldPerformanceProfile(): WorldPerformanceProfile {
  if (typeof navigator === "undefined") return chooseWorldPerformanceProfile({});
  const extendedNavigator = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  return chooseWorldPerformanceProfile({
    logicalCores: navigator.hardwareConcurrency,
    memoryGB: extendedNavigator.deviceMemory,
    saveData: extendedNavigator.connection?.saveData,
    reducedMotion: typeof window !== "undefined" ? window.matchMedia?.("(prefers-reduced-motion: reduce)").matches : false,
  });
}
