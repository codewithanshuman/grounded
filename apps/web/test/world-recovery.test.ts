import { describe, expect, it } from "vitest";
import { emptyWorld, recoverStoredWorld } from "../src/ws/worldRecovery";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("Saved-world recovery", () => {
  it("accepts valid worlds and leaves stored contents unchanged", () => {
    const world = { ...emptyWorld(), totalRuns: 7, totalFuturesSimulated: 3500 };
    const raw = JSON.stringify(world);
    const storage = memoryStorage({ world: raw });
    expect(recoverStoredWorld(storage, "world", "test")).toEqual({ ready: true, world });
    expect([...storage.values]).toEqual([["world", raw]]);
  });

  it("initializes missing worlds without a recovery copy", () => {
    const storage = memoryStorage();
    expect(recoverStoredWorld(storage, "world", "test")).toEqual({ ready: true });
    expect(storage.values.size).toBe(0);
  });

  it.each(["{unfinished", "null", "{}", '{"trees":"not an array"}'])("backs up malformed snapshots exactly before allowing initialization: %s", (raw) => {
    const storage = memoryStorage({ world: raw });
    expect(recoverStoredWorld(storage, "world", "test")).toEqual({ ready: true, recoveryKey: "world.recovery.test" });
    expect(storage.getItem("world")).toBe(raw);
    expect(storage.getItem("world.recovery.test")).toBe(raw);
  });

  it("blocks initialization without replacing the original when backup fails", () => {
    const storage = memoryStorage({ world: "broken" });
    storage.setItem = () => { throw new Error("Storage quota reached"); };
    expect(recoverStoredWorld(storage, "world", "test").ready).toBe(false);
    expect([...storage.values]).toEqual([["world", "broken"]]);
  });

  it("verifies the backup and rejects silent failed writes", () => {
    const storage = memoryStorage({ world: "broken" });
    storage.setItem = () => {};
    expect(recoverStoredWorld(storage, "world", "test").ready).toBe(false);
    expect(storage.getItem("world")).toBe("broken");
  });

  it("does not overwrite an existing recovery copy on a key collision", () => {
    const storage = memoryStorage({ world: "broken", "world.recovery.test": "earlier backup" });
    expect(recoverStoredWorld(storage, "world", "test").ready).toBe(false);
    expect(storage.getItem("world.recovery.test")).toBe("earlier backup");
    expect(storage.getItem("world")).toBe("broken");
  });

  it("reports unavailable storage instead of starting a replacement world", () => {
    const storage = memoryStorage();
    storage.getItem = () => { throw new Error("Storage denied"); };
    expect(recoverStoredWorld(storage, "world", "test").ready).toBe(false);
    expect(storage.values.size).toBe(0);
  });
});
