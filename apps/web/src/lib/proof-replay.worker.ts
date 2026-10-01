/// <reference lib="webworker" />
import { replayEvidence } from "@verdant/sim/proofReplay";

self.onmessage = (event: MessageEvent<unknown>) => {
  try { self.postMessage({ result: replayEvidence(event.data) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : "Proof replay failed." }); }
};

export {};
