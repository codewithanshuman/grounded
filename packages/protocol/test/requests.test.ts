import { describe, expect, it } from "vitest";
import { SimulationRequest, SweepRequest, OptimizationRequest, validationCohortSize } from "../src/requests";
import { MicrogridConfig } from "../src/index";
const config = MicrogridConfig.parse({ solarCapacityKW: 1000, batteryCapacityKWh: 1000, batteryStartPct: 80, hospitalKW: 400, homesCount: 100, avgHomeKW: 1, evCount: 10, evChargerKW: 7, gridMaxImportKW: 1000 });
describe("Shared compute contract", () => {
  it("enforces integer bounded workloads and physical constraints in both transports", () => {
    const request = { location: "jaipur", preset: "normal", config, scenarioCount: 500 };
    expect(SimulationRequest.parse(request).scenarioCount).toBe(500);
    for (const scenarioCount of [0, 1.5, 20_000, Infinity]) expect(SimulationRequest.safeParse({ ...request, scenarioCount }).success).toBe(false);
    expect(SimulationRequest.safeParse({ ...request, config: { ...config, homesCount: 1.5 } }).success).toBe(false);
    expect(SimulationRequest.safeParse({ ...request, config: { ...config, hospitalKW: Infinity } }).success).toBe(false);
    expect(SweepRequest.safeParse({ ...request, scenarioCount: 2001 }).success).toBe(false);
  });
  it("requires a finite positive planning target", () => {
    expect(OptimizationRequest.parse({ runId: "run" }).riskTargetPct).toBe(5);
    for (const riskTargetPct of [0, -1, 101, NaN]) expect(OptimizationRequest.safeParse({ runId: "run", riskTargetPct }).success).toBe(false);
  });
  it("predeclares independent cluster sample size without inspecting results", () => {
    expect(validationCohortSize(5, 5)).toBe(300);
    expect(validationCohortSize(1, 5)).toBe(1500);
    expect(validationCohortSize(0.001, 5)).toBe(2000);
    expect(() => validationCohortSize(0, 5)).toThrow();
  });
});
