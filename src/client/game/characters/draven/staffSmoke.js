import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { rigPoint } from "../shared/rig";

// Draven's staff smoke, painted as pixel art on a world grid: the trail that
// follows his staff around (effects.js) and the Inferno ignite
// (infernoTransitions.js) both draw their puffs through paintStaffSmoke.

// Smoke is drawn on a coarser grid than other effects (about two art pixels).
export const SMOKE_CELL = 3;

const PALETTES = {
  default: {
    hot: 0xfffbe8,
    fire: [0xffeb8f, 0xffc23d, 0xff8a1f, 0xe8501c],
    arcane: [0xff8ae0, 0xc264ff, 0x8a3cff],
    smoke: 0x4a2462,
    // Staff smoke, thin to thick, then its outline.
    plume: [0x8a3cff, 0x6a2c9e, 0x4a2462],
    outline: 0x1c0f2a,
  },
  red: {
    hot: 0xfff4e4,
    fire: [0xffd99a, 0xff9e4a, 0xff5a2f, 0xd9262a],
    arcane: [0xff9a86, 0xff4f52, 0xd8203a],
    smoke: 0x40232c,
    plume: [0x8e2a3a, 0x5c1f2c, 0x34161e],
    outline: 0x16080c,
  },
};
const pick = (list, i) => list[i % list.length];

export function staffSmokePalette(player) {
  return teamColor(player) === TEAM_RED ? PALETTES.red : PALETTES.default;
}

// The staff head on the frame being shown (draven.json `rig.points.staffTip`).
export function staffTip(player) {
  return rigPoint(player, "staffTip", "draven")
    || { x: player.x, y: player.y - (player.displayHeight || 72) * 0.25 };
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const bayer = (col, row) => BAYER[(row & 3) * 4 + (col & 3)];
export const snapSmoke = (v) => Math.round(v / SMOKE_CELL) * SMOKE_CELL;

// Every puff adds soft heat to one grid, so overlapping puffs merge into a
// single smoke body: quantised to the palette with ordered dithering, a light
// rim on top and a dark outline round the outside, like the sprite's own flame.
// Young puffs burn in the fire and arcane colours before cooling to smoke.
export function paintStaffSmoke(g, puffs, pal) {
  g.clear();
  if (!puffs.length) return;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of puffs) {
    minX = Math.min(minX, p.x - p.r); maxX = Math.max(maxX, p.x + p.r);
    minY = Math.min(minY, p.y - p.r); maxY = Math.max(maxY, p.y + p.r);
  }
  const c0 = Math.floor(minX / SMOKE_CELL) - 1; const r0 = Math.floor(minY / SMOKE_CELL) - 1;
  const cols = Math.ceil(maxX / SMOKE_CELL) - c0 + 2; const rows = Math.ceil(maxY / SMOKE_CELL) - r0 + 2;
  const heat = new Float32Array(cols * rows);
  const warm = new Float32Array(cols * rows);
  for (const p of puffs) {
    const pc0 = Math.max(0, Math.floor((p.x - p.r) / SMOKE_CELL) - c0);
    const pc1 = Math.min(cols - 1, Math.ceil((p.x + p.r) / SMOKE_CELL) - c0);
    const pr0 = Math.max(0, Math.floor((p.y - p.r) / SMOKE_CELL) - r0);
    const pr1 = Math.min(rows - 1, Math.ceil((p.y + p.r) / SMOKE_CELL) - r0);
    for (let row = pr0; row <= pr1; row++) {
      for (let col = pc0; col <= pc1; col++) {
        const d = Math.hypot((col + c0 + 0.5) * SMOKE_CELL - p.x, (row + r0 + 0.5) * SMOKE_CELL - p.y) / p.r;
        if (d >= 1) continue;
        const i = row * cols + col;
        const v = (1 - d * d) * p.h;
        if (v > heat[i]) heat[i] = v;
        if (v * p.warm > warm[i]) warm[i] = v * p.warm;
      }
    }
  }
  const solid = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (heat[i] > 0.12 + bayer(col + c0, row + r0) * 0.22) solid[i] = 1;
    }
  }
  const at = (col, row) => (col < 0 || row < 0 || col >= cols || row >= rows ? 0 : solid[row * cols + col]);
  const fill = (col, row, color) => {
    g.fillStyle(color, 1);
    g.fillRect((col + c0) * SMOKE_CELL, (row + r0) * SMOKE_CELL, SMOKE_CELL, SMOKE_CELL);
  };
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const i = row * cols + col;
      if (!solid[i]) {
        if (at(col - 1, row) || at(col + 1, row) || at(col, row - 1) || at(col, row + 1)) fill(col, row, pal.outline);
        continue;
      }
      const b = bayer(col + c0, row + r0) * 0.18 - 0.09;
      const w = warm[i] + b;
      const h = heat[i] + b;
      let color;
      if (w > 0.62) color = w > 0.8 ? pal.hot : pick(pal.fire, h > 0.6 ? 0 : 1);
      else if (w > 0.36) color = pick(pal.arcane, h > 0.55 ? 0 : 1);
      else color = pal.plume[h > 0.6 ? 0 : h > 0.34 ? 1 : 2];
      // Light catches the top edge of the smoke.
      if (!at(col, row - 1) && w <= 0.62) color = pick(pal.arcane, 1);
      fill(col, row, color);
    }
  }
}
