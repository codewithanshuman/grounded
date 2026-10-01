import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Building } from "@verdant/protocol";
import type Phaser from "phaser";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), clear: vi.fn(), motion: { reduced: false } }));
vi.mock("../src/reference-city/systems/construction", () => ({
  ConstructionSites: class { sync = mocks.sync; clear = mocks.clear; },
}));
vi.mock("../src/reference-city/systems/ambient", () => ({ prefersReducedMotion: () => mocks.motion.reduced }));
vi.mock("../src/reference-city/textures/core", () => ({ TILE_ANCHOR_Y: 24 }));
import { EvidenceConstruction } from "../src/game/evidenceCity/EvidenceConstruction";

function fixture() {
  const timers: { delay: number; callback: () => void; remove: ReturnType<typeof vi.fn> }[] = [];
  const chain = () => ({ active: true, setDepth: vi.fn().mockReturnThis(), fillStyle: vi.fn().mockReturnThis(),
    lineStyle: vi.fn().mockReturnThis(), fillPoints: vi.fn().mockReturnThis(), strokePoints: vi.fn().mockReturnThis(),
    destroy() { this.active = false; } });
  const foundations: ReturnType<typeof chain>[] = [];
  const scene = {
    tweens: { killTweensOf: vi.fn() },
    add: { graphics: () => { const graphics = chain(); foundations.push(graphics); return graphics; } },
    textures: { exists: () => true },
    time: { delayedCall: (delay: number, callback: () => void) => {
      const timer = { delay, callback, remove: vi.fn() }; timers.push(timer); return timer;
    } },
  } as unknown as Phaser.Scene;
  const sprite = { active: true, x: 100, y: 200, depth: 1000, displayHeight: 160, height: 160, width: 96,
    setScale: vi.fn().mockReturnThis(), setAlpha: vi.fn().mockReturnThis(), setCrop: vi.fn().mockReturnThis() };
  const building: Building = { id: "building-1", gx: 1, gy: 1, kind: "reservoir", runId: "result-1", grownAt: 1,
    milestone: "Synthetic renderer fixture", milestoneId: "proof-1", variantId: "storage-battery-pavilion",
    family: "storage", level: 1, plotId: "storage-1", rotation: 0 };
  const construction = new EvidenceConstruction(scene, "crew:test");
  const status = vi.fn(); construction.setStatusHandler(status);
  return { construction, building, sprite: sprite as unknown as Phaser.GameObjects.Sprite, status, timers, foundations, scene };
}

beforeEach(() => { vi.clearAllMocks(); mocks.motion.reduced = false; });

describe("Evidence construction presentation", () => {
  it("never replays construction for hydrated history", () => {
    const f = fixture(); f.construction.hydrate([f.building]); f.construction.start(f.building, f.sprite);
    expect(f.timers).toHaveLength(0); expect(mocks.sync).not.toHaveBeenCalled();
  });

  it("does not animate legacy buildings without a placement receipt", () => {
    const f = fixture(); f.construction.start({ ...f.building, milestoneId: undefined }, f.sprite);
    expect(f.timers).toHaveLength(0);
  });

  it("runs foundation, archive crew/frame and completion exactly once for a new placement", () => {
    const f = fixture(); f.construction.start(f.building, f.sprite); f.construction.start(f.building, f.sprite);
    expect(f.timers.map(timer => timer.delay)).toEqual([900, 2700, 3400]);
    expect(f.status.mock.lastCall?.[0][0].phase).toBe("Foundation");
    expect(mocks.sync.mock.lastCall?.[0][0].crewTexture).toBe("crew:test");
    f.timers[0]!.callback(); expect(f.status.mock.lastCall?.[0][0].phase).toBe("Frame");
    expect(f.sprite.setCrop).toHaveBeenLastCalledWith(0, 76.8, 96, 83.2);
    f.timers[1]!.callback(); expect(f.status.mock.lastCall?.[0][0].phase).toBe("Complete");
    expect(f.foundations[0]!.active).toBe(false); expect(mocks.sync).toHaveBeenLastCalledWith([]);
    f.timers[2]!.callback(); expect(f.status).toHaveBeenLastCalledWith([]);
  });

  it("permits a new upgrade receipt at the same building without replaying the old one", () => {
    const f = fixture(); f.construction.hydrate([f.building]);
    f.construction.start({ ...f.building, milestoneId: "proof-2", level: 2 }, f.sprite);
    expect(f.timers).toHaveLength(3);
    expect(f.status.mock.lastCall?.[0][0].milestoneId).toBe("proof-2");
  });

  it("completes instantly with reduced motion and records its receipt", () => {
    mocks.motion.reduced = true;
    const f = fixture(); f.construction.start(f.building, f.sprite);
    expect(f.timers).toHaveLength(0); expect(f.foundations).toHaveLength(0);
    expect(f.sprite.setAlpha).toHaveBeenLastCalledWith(1);
    mocks.motion.reduced = false; f.construction.start(f.building, f.sprite);
    expect(f.timers).toHaveLength(0);
  });

  it("cancels timers and removes scaffolds without leaving the building hidden", () => {
    const f = fixture(); f.construction.start(f.building, f.sprite); f.construction.destroy();
    expect(f.timers.every(timer => timer.remove.mock.calls.length === 1)).toBe(true);
    expect(f.foundations[0]!.active).toBe(false); expect(mocks.clear).toHaveBeenCalledOnce();
    expect(f.sprite.setAlpha).toHaveBeenLastCalledWith(1); expect(f.status).toHaveBeenLastCalledWith([]);
  });
});
