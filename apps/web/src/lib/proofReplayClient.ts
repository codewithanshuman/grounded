import type { StoredEvidence } from "@verdant/protocol/evidence";
import type { ProofReplayResult } from "@verdant/sim/proofReplay";

/** Replay runs in its own worker and never calls the world-growth transport. */
export function replaySavedEvidence(payload: StoredEvidence, signal?: AbortSignal): Promise<ProofReplayResult> {
  if (signal?.aborted) return Promise.reject(new Error("Proof replay cancelled."));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./proof-replay.worker.ts", import.meta.url), { type: "module" });
    const finish = () => { worker.terminate(); clearTimeout(timer); signal?.removeEventListener("abort", cancel); };
    const cancel = () => { finish(); reject(new Error("Proof replay cancelled.")); };
    const timer = setTimeout(() => { finish(); reject(new Error("Proof replay exceeded its time limit. The stored proof is unchanged.")); }, 600_000);
    signal?.addEventListener("abort", cancel, { once: true });
    worker.onmessage = (event: MessageEvent<{ result?: ProofReplayResult; error?: string }>) => {
      finish();
      if (event.data.error || !event.data.result) reject(new Error(event.data.error ?? "Proof replay returned no result."));
      else resolve(event.data.result);
    };
    worker.onerror = () => { finish(); reject(new Error("The proof replay worker could not complete. The stored proof is unchanged.")); };
    worker.onmessageerror = () => { finish(); reject(new Error("The replay response could not be read.")); };
    worker.postMessage(payload);
  });
}
