import { WorldState as WorldStateSchema, type WorldState } from "@verdant/protocol";

type WorldStorage = Pick<Storage, "getItem" | "setItem">;

export type StoredWorldRecovery =
  | { ready: true; world?: WorldState; recoveryKey?: string }
  | { ready: false; error: string };

export function emptyWorld(): WorldState {
  return { trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0 };
}

/** Never expose unvalidated storage to the renderer or overwrite the only copy. */
export function recoverStoredWorld(
  storage: WorldStorage,
  key: string,
  recoverySuffix = `${Date.now()}.${crypto.randomUUID()}`,
): StoredWorldRecovery {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { ready: false, error: "Saved-world storage is unavailable. Allow browser storage, then reload. No saved world was overwritten." };
  }
  if (raw === null) return { ready: true };

  try {
    const parsed = WorldStateSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return { ready: true, world: parsed.data };
  } catch {
    // Invalid JSON receives the same recoverable treatment as an invalid schema.
  }

  const recoveryKey = `${key}.recovery.${recoverySuffix}`;
  try {
    // Even a rare key collision must not replace an earlier recovery snapshot.
    if (storage.getItem(recoveryKey) !== null) throw new Error("Recovery key already exists");
    storage.setItem(recoveryKey, raw);
    if (storage.getItem(recoveryKey) !== raw) throw new Error("Recovery backup could not be verified");
  } catch {
    return {
      ready: false,
      error: "The saved world needs recovery, but its backup could not be saved. The original is untouched. Free browser storage without deleting this site's data, then reload.",
    };
  }
  // The original stays in place until the initialized worker returns valid state.
  return { ready: true, recoveryKey };
}
