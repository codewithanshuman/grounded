import { describe, expect, it, vi } from "vitest";
import { SessionBootstrap } from "../src/auth/sessionBootstrap";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("Cloud session bootstrap continuity", () => {
  it("deduplicates concurrent initial-session and sign-in notifications", async () => {
    const initialized = deferred<{ id: string }>();
    const bootstrap = vi.fn(() => initialized.promise);
    const publish = vi.fn();
    const session = new SessionBootstrap(bootstrap, publish);
    const first = session.apply({ id: "A" });
    const duplicate = session.apply({ id: "A" });
    await Promise.resolve();
    expect(bootstrap).toHaveBeenCalledTimes(1);
    initialized.resolve({ id: "A" });
    await Promise.all([first, duplicate]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith({ id: "A" }, null);
  });

  it("same-account refreshes cannot replace active local progress", async () => {
    let savedWorld = "older cloud world";
    const bootstrap = vi.fn(async (user: { id: string }) => {
      savedWorld = "older cloud world"; // Mirrors bootstrapCloudIdentity hydration.
      return user;
    });
    const session = new SessionBootstrap(bootstrap, vi.fn());
    await session.apply({ id: "A" });
    savedWorld = "new locally saved evidence, cloud sync pending";
    await session.apply({ id: "A" }); // TOKEN_REFRESHED
    await session.apply({ id: "A" }); // Repeated SIGNED_IN
    expect(bootstrap).toHaveBeenCalledTimes(1);
    expect(savedWorld).toBe("new locally saved evidence, cloud sync pending");
  });

  it("a delayed previous-account result cannot undo an account switch", async () => {
    const old = deferred<{ id: string }>();
    const publish = vi.fn();
    const session = new SessionBootstrap((user: { id: string }) => user.id === "A" ? old.promise : Promise.resolve(user), publish);
    const previous = session.apply({ id: "A" });
    await Promise.resolve();
    await session.apply({ id: "B" });
    old.resolve({ id: "A" });
    await previous;
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenLastCalledWith({ id: "B" }, null);
  });

  it("sign-out invalidates a pending sign-in, including its error", async () => {
    const old = deferred<{ id: string }>();
    const publish = vi.fn();
    const session = new SessionBootstrap(() => old.promise, publish);
    const previous = session.apply({ id: "A" });
    await Promise.resolve();
    await session.apply(null);
    old.reject(new Error("late previous-account error"));
    await previous;
    expect(publish.mock.calls).toEqual([[null, null]]);
  });

  it("permits same-account retry after a bootstrap failure", async () => {
    const bootstrap = vi.fn<(user: { id: string }) => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("temporary connection failure"))
      .mockImplementation(async (user) => user);
    const publish = vi.fn();
    const session = new SessionBootstrap(bootstrap, publish);
    await session.apply({ id: "A" });
    await session.apply({ id: "A" });
    expect(publish.mock.calls).toEqual([[null, "temporary connection failure"], [{ id: "A" }, null]]);
  });

  it("stops publishing after disposal and bootstraps again after a real sign-out", async () => {
    const bootstrap = vi.fn(async (user: { id: string }) => user);
    const publish = vi.fn();
    const session = new SessionBootstrap(bootstrap, publish);
    await session.apply({ id: "A" });
    await session.apply(null);
    await session.apply({ id: "A" });
    expect(bootstrap).toHaveBeenCalledTimes(2);
    session.dispose();
    await session.apply({ id: "B" });
    expect(publish).toHaveBeenCalledTimes(3);
    expect(bootstrap).toHaveBeenCalledTimes(2);
  });
});
