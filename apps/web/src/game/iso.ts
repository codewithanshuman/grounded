import { HALF_W, HALF_H, FOREST_GRID_SIZE, FOREST_CENTER } from "@verdant/protocol";

/* Same convention as claude-clan-main: [gx, gy] grid coordinates project to
 * screen space via (gx-gy)*HALF_W, (gx+gy)*HALF_H; gx+gy is the depth/sort
 * key so tiles further "back" never draw over tiles in front of them. */
export { HALF_W, HALF_H, FOREST_GRID_SIZE, FOREST_CENTER };

export function toScreen(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HALF_W, y: (gx + gy) * HALF_H };
}

export const depthOf = (gx: number, gy: number): number => (gx + gy) * 10;
