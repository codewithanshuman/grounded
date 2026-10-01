import { SimulationRequest, SweepRequest } from "@verdant/protocol/requests";

export function parseAnalysisRequest(args: Record<string, unknown>, sweep = false) {
  return sweep ? { ...SweepRequest.parse(args), preset: "normal" as const } : SimulationRequest.parse(args);
}

export const isAnalysisOperation = (op: string) => op === "simulate" || op === "sweep" || op === "optimize";
