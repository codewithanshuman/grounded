import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Phaser from "phaser";
import type { WorldState } from "@verdant/protocol";
import { createIsoProjection } from "../src/reference-city/math/iso";
import { CITY_PLOTS } from "@verdant/protocol/city";

vi.mock("../src/reference-city/textures/buildings", () => ({ bakeBuilding: () => ({ key: "authored-building" }) }));
vi.mock("../src/reference-city/textures/core", () => ({ TILE_ANCHOR_Y: 23 }));
vi.mock("../src/reference-city/world/core/worldConstants", () => ({
  HIGHLIGHT_DEPTH: -900_000, CLICK_SLOP: 5,
  projection: { project: (x: number, y: number) => ({ x: (x - y) * 46, y: (x + y) * 23 }),
    unproject: (x: number, y: number) => ({ x: x / 92 + y / 46, y: y / 46 - x / 92 }),
    depth: (x: number, y: number) => (x + y) * 10_000 },
}));
import { EvidenceCityPlacement } from "../src/game/evidenceCity/EvidenceCityPlacement";

const iso = createIsoProjection(92, 46);
const plan = { milestoneId: "renderer-test-proof", variantId: "storage-battery-pavilion", rotation: 0 as const };
const world = (): WorldState => ({ trees: [], buildings: [], totalRuns: 0, totalFuturesSimulated: 0, bestImprovementPct: 0,
  pendingMilestones: [{ id: plan.milestoneId, family: "storage", level: 1, earnedAt: 1, proof: {
    proofIdentity: "synthetic-unit-fixture", sourceContextKey: "test", baselineRunId: "before", resultRunId: "after",
    modelVersion: "test", calibrationFingerprint: "test", siteDataFingerprint: "test", targetPct: 5,
    baselineSampleSize: 500, resultSampleSize: 500, beforeCritical: 10, afterCritical: 0,
    holdouts: [], compoundStressCells: 81, compoundPassingCells: 81,
  } }] });

function fixture() {
  const listeners = new Map<string, Set<(...args: any[]) => void>>();
  const keyboard = new Map<string, EventListener>();
  vi.stubGlobal("window", { addEventListener: (name: string, handler: EventListener) => keyboard.set(name, handler),
    removeEventListener: (name: string) => keyboard.delete(name) });
  const drawable = () => ({ setDepth: vi.fn().mockReturnThis(), clear: vi.fn().mockReturnThis(),
    fillStyle: vi.fn().mockReturnThis(), lineStyle: vi.fn().mockReturnThis(), fillPoints: vi.fn().mockReturnThis(),
    strokePoints: vi.fn().mockReturnThis(), destroy: vi.fn(), setOrigin: vi.fn().mockReturnThis(),
    setVisible: vi.fn().mockReturnThis(), setTexture: vi.fn().mockReturnThis(), setPosition: vi.fn().mockReturnThis(),
    setFlipX: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(), setTint: vi.fn().mockReturnThis() });
  const graphics = drawable(), ghost = drawable(), canvas = {};
  const camera = { offsetX: 200, offsetY: 100, zoom: 2 };
  const scene = { add: { graphics: () => graphics, sprite: () => ghost }, scene: { isActive: () => true },
    input: { on(name: string, handler: (...args: any[]) => void) {
      const handlers = listeners.get(name) ?? new Set(); handlers.add(handler); listeners.set(name, handlers);
    }, off(name: string, handler: (...args: any[]) => void) { listeners.get(name)?.delete(handler); } },
    cameras: { main: { getWorldPoint: (x: number, y: number) => ({ x: (x - camera.offsetX) / camera.zoom,
      y: (y - camera.offsetY) / camera.zoom }) } } } as unknown as Phaser.Scene;
  let state: WorldState | null = world();
  const controller = new EvidenceCityPlacement(scene, () => state, () => ({ cellAt: () => ({ kind: "grass" }) } as any));
  const handlers = { onPlace: vi.fn(), onRotate: vi.fn(), onCancel: vi.fn(), onStatus: vi.fn() };
  controller.setHandlers(handlers); controller.setPlan(plan);
  function pointer(plotIndex = 0, id = 1, extra: { dx?: number; dy?: number; outside?: boolean; right?: boolean } = {}) {
    const plot = CITY_PLOTS[plotIndex]!;
    const projected = iso.project(plot.gx, plot.gy);
    return { x: projected.x * camera.zoom + camera.offsetX + (extra.dx ?? 0),
      y: projected.y * camera.zoom + camera.offsetY + (extra.dy ?? 0), id,
      manager: { canvas }, event: { target: extra.outside ? {} : canvas }, rightButtonDown: () => !!extra.right } as unknown as Phaser.Input.Pointer;
  }
  const emit = (name: string, pointer: Phaser.Input.Pointer) => listeners.get(name)?.forEach((handler) => handler(pointer));
  return { controller, handlers, pointer, emit, keyboard, camera, graphics, ghost, listeners, setWorld: (value: WorldState | null) => { state = value; } };
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Evidence placement input", () => {
  it("places the exact catalog tile after camera pan and zoom, with the authored design", () => {
    const f = fixture(); const pointer = f.pointer();
    f.emit("pointermove", pointer);
    expect(f.handlers.onStatus.mock.lastCall?.[0]).toMatchObject({ available: 3, canPlace: true });
    expect(f.ghost.setTexture).toHaveBeenCalledWith("authored-building");
    f.emit("pointerdown", pointer); f.emit("pointerup", pointer);
    expect(f.handlers.onPlace).toHaveBeenCalledExactlyOnceWith({ ...plan, plotId: CITY_PLOTS[0]!.id });
  });

  it("never constructs for a pan that returns to its original tile", () => {
    const f = fixture(); f.emit("pointerdown", f.pointer());
    f.emit("pointermove", f.pointer(0, 1, { dx: 20 })); f.emit("pointermove", f.pointer()); f.emit("pointerup", f.pointer());
    expect(f.handlers.onPlace).not.toHaveBeenCalled();
  });

  it("rejects another release tile, HTML overlays, right clicks and off-canvas release", () => {
    const f = fixture(); f.emit("pointerdown", f.pointer()); f.emit("pointerup", f.pointer(1));
    f.emit("pointerdown", f.pointer(0, 1, { outside: true })); f.emit("pointerup", f.pointer());
    f.emit("pointerdown", f.pointer(0, 1, { right: true })); f.emit("pointerup", f.pointer());
    f.emit("pointerdown", f.pointer()); f.emit("pointerupoutside", f.pointer()); f.emit("pointerup", f.pointer());
    expect(f.handlers.onPlace).not.toHaveBeenCalled();
  });

  it("treats a second finger as navigation and retains the original press until release", () => {
    const f = fixture(); f.emit("pointerdown", f.pointer(0, 1)); f.emit("pointerdown", f.pointer(0, 2));
    f.emit("pointerup", f.pointer(0, 2)); f.emit("pointerup", f.pointer(0, 1));
    expect(f.handlers.onPlace).not.toHaveBeenCalled();
  });

  it("rechecks the current entitlement instead of using the last green preview", () => {
    const f = fixture(); f.emit("pointermove", f.pointer()); f.emit("pointerdown", f.pointer());
    f.setWorld({ ...world(), pendingMilestones: [] }); f.emit("pointerup", f.pointer()); f.controller.refresh();
    expect(f.handlers.onPlace).not.toHaveBeenCalled();
    expect(f.handlers.onStatus.mock.lastCall?.[0]).toMatchObject({ available: 0, canPlace: false });
  });

  it("hides a stale preview while the owner's world is loading", () => {
    const f = fixture(); f.emit("pointermove", f.pointer()); f.setWorld(null); f.controller.refresh();
    expect(f.ghost.setVisible).toHaveBeenLastCalledWith(false);
    expect(f.handlers.onStatus.mock.lastCall?.[0]).toMatchObject({ available: 0, canPlace: false });
    f.emit("pointerdown", f.pointer()); f.emit("pointerup", f.pointer());
    expect(f.handlers.onPlace).not.toHaveBeenCalled();
  });

  it("clears an in-flight click when changing design or cancelling placement", () => {
    const f = fixture(); f.emit("pointerdown", f.pointer()); f.controller.setPlan({ ...plan, rotation: 90 }); f.emit("pointerup", f.pointer());
    f.emit("pointerdown", f.pointer()); f.controller.setPlan(null); f.emit("pointerup", f.pointer());
    expect(f.handlers.onPlace).not.toHaveBeenCalled(); expect(f.handlers.onStatus).toHaveBeenLastCalledWith(null);
  });

  it("rotates and cancels through shortcuts, but respects previously handled events", () => {
    const f = fixture(); const key = f.keyboard.get("keydown")!;
    key({ key: "r", preventDefault: vi.fn() } as unknown as KeyboardEvent);
    key({ key: "r", defaultPrevented: true, preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(f.handlers.onRotate).toHaveBeenCalledOnce();
    key({ key: "Escape", preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(f.handlers.onCancel).toHaveBeenCalledOnce(); expect(f.handlers.onStatus).toHaveBeenLastCalledWith(null);
    f.controller.destroy();
    expect([...f.listeners.values()].every((handlers) => handlers.size === 0)).toBe(true);
    expect(f.keyboard.size).toBe(0);
  });

  it("does not rotate the city while a form field or certificate dialog has focus", () => {
    class FocusTarget {
      isContentEditable = false;
      constructor(private readonly kind: "input" | "dialog") {}
      closest(selector: string) { return selector.includes(this.kind === "dialog" ? "[role=dialog]" : "input") ? this : null; }
    }
    vi.stubGlobal("HTMLElement", FocusTarget);
    const f = fixture(), key = f.keyboard.get("keydown")!;
    for (const kind of ["input", "dialog"] as const) key({ key: "r", target: new FocusTarget(kind), preventDefault: vi.fn() } as unknown as KeyboardEvent);
    expect(f.handlers.onRotate).not.toHaveBeenCalled();
  });
});
