import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorldState } from "@verdant/protocol";

const harness = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], refs: [] as { current: unknown }[],
  refIndex: 0, games: [] as any[], scenes: [] as any[], size: { clientWidth: 1000, clientHeight: 700 } }));

vi.mock("react", async (importOriginal) => ({ ...(await importOriginal<typeof import("react")>()),
  useRef: (value: unknown) => {
    const index = harness.refIndex++;
    return harness.refs[index] ?? (harness.refs[index] = { current: index === 0 ? harness.size : value });
  },
  useState: (value: unknown) => [value, vi.fn()],
  useEffect: (callback: () => void | (() => void)) => harness.effects.push(callback),
}));

vi.mock("phaser", () => {
  class Emitter {
    handlers = new Map<string, Set<() => void>>();
    once(name: string, callback: () => void) {
      const wrapped = () => { this.off(name, wrapped); callback(); };
      (wrapped as any).original = callback;
      const handlers = this.handlers.get(name) ?? new Set(); handlers.add(wrapped); this.handlers.set(name, handlers);
    }
    off(name: string, callback: () => void) {
      const handlers = this.handlers.get(name);
      handlers?.forEach((handler) => { if (handler === callback || (handler as any).original === callback) handlers.delete(handler); });
    }
    emit(name: string) { [...this.handlers.get(name) ?? []].forEach((callback) => callback()); }
  }
  class Game {
    events = new Emitter(); scale = { resize: vi.fn() }; destroy = vi.fn();
    constructor() { harness.games.push(this); }
  }
  return { default: { Game, WEBGL: 2, Scale: { RESIZE: 5 }, Core: { Events: { READY: "ready" } }, Scenes: { Events: { CREATE: "create" } } }, Emitter };
});

vi.mock("../src/game/GroundedCityScene", async () => {
  const { Emitter } = await import("phaser") as any;
  class GroundedCityScene {
    active = false; events = new Emitter(); scene = { isActive: () => this.active };
    setInspectHandler = vi.fn(); setRailStatusHandler = vi.fn(); setPlacementHandlers = vi.fn();
    setConstructionStatusHandler = vi.fn(); setGroundedWorld = vi.fn(); setActivity = vi.fn(); setBuildPlan = vi.fn();
    resizeViewport = vi.fn();
    constructor() { harness.scenes.push(this); }
  }
  return { GroundedCityScene };
});
import { GameCanvas } from "../src/game/GameCanvas";

const savedWorld = (totalRuns = 1): WorldState => ({ trees: [], buildings: [], totalRuns,
  totalFuturesSimulated: totalRuns * 500, bestImprovementPct: 0 });

beforeEach(() => {
  vi.clearAllMocks(); harness.effects = []; harness.refs = []; harness.refIndex = 0; harness.games = []; harness.scenes = [];
  vi.stubGlobal("ResizeObserver", class { observe = vi.fn(); disconnect = vi.fn(); });
});

function mount(world: WorldState | null = savedWorld()) {
  const onReady = vi.fn();
  GameCanvas({ world, pendingGrowth: [], activity: "founding", onReady });
  const cleanup = harness.effects[0]!();
  return { scene: harness.scenes[0]!, game: harness.games[0]!, onReady, cleanup: cleanup as () => void };
}

describe("Renderer startup lifecycle", () => {
  it("waits for scene CREATE after game READY while image preloading is in progress", () => {
    const f = mount(); f.game.events.emit("ready");
    expect(f.scene.setGroundedWorld).not.toHaveBeenCalled(); expect(f.onReady).not.toHaveBeenCalled();
    f.scene.active = true; f.scene.events.emit("create");
    expect(f.scene.setGroundedWorld).toHaveBeenCalledExactlyOnceWith(savedWorld());
    expect(f.scene.setActivity).toHaveBeenCalledWith("founding"); expect(f.onReady).toHaveBeenCalledOnce();
  });

  it("initializes immediately when scene CREATE already completed", () => {
    const f = mount(); f.scene.active = true; f.game.events.emit("ready");
    expect(f.scene.setGroundedWorld).toHaveBeenCalledExactlyOnceWith(savedWorld()); expect(f.onReady).toHaveBeenCalledOnce();
  });

  it("reads the latest saved world when recovery finishes during preload", () => {
    const f = mount(null); f.game.events.emit("ready");
    harness.refIndex = 0;
    GameCanvas({ world: savedWorld(2), pendingGrowth: [], activity: null, onReady: f.onReady });
    f.scene.active = true; f.scene.events.emit("create");
    expect(f.scene.setGroundedWorld).toHaveBeenCalledExactlyOnceWith(savedWorld(2));
    expect(f.scene.setActivity).toHaveBeenCalledWith(null);
  });

  it("removes pending initialization on unmount instead of hydrating a destroyed game", () => {
    const f = mount(); f.game.events.emit("ready"); f.cleanup();
    f.scene.active = true; f.scene.events.emit("create");
    expect(f.scene.setGroundedWorld).not.toHaveBeenCalled(); expect(f.onReady).not.toHaveBeenCalled();
    expect(f.game.destroy).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("ignores a game READY event that arrives after unmount", () => {
    const f = mount(); f.cleanup(); f.game.events.emit("ready");
    expect(f.scene.setGroundedWorld).not.toHaveBeenCalled(); expect(f.onReady).not.toHaveBeenCalled();
  });
});
