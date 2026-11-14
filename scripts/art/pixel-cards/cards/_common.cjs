// Helpers shared by the card effect scripts.
const { rectPath } = require('../lib.cjs');

// Frame pixels with their position around the window (0..1, clockwise).
function frameCells(card) { return card.frameCells.map(([x, y]) => ({ x, y, s: card.perim(x, y) })); }
// Distance from a to b going forward around the loop.
const ahead = (a, b) => (((b - a) % 1) + 1) % 1;
// Stable per-cell, per-slot hash in [0,1).
const hash = (x, y, n) => { let h = (x * 374761393 + y * 668265263 + n * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
// Corner points on the frame's outer edge (out > 0 moves them further out).
function corners(card, out = 0) {
  const { x0, y0, x1, y1 } = card.outer;
  return [[x0 - out, y0 - out], [x1 + out, y0 - out], [x1 + out, y1 + out], [x0 - out, y1 + out]].map(([x, y]) => ({ x, y, s: card.perim(x, y) }));
}
// Path along the frame's outer edge (d > 0 moves it outward).
const outerPath = (card, d = 0) => rectPath(card.outer, -d);
// Piecewise-linear position over time: keys [[t, v], ...]; null outside.
function track(keys, t) {
  if (t < keys[0][0] || t > keys[keys.length - 1][0]) return null;
  for (let i = 1; i < keys.length; i++) if (t <= keys[i][0]) {
    const [ta, va] = keys[i - 1], [tb, vb] = keys[i];
    return va + (vb - va) * ((t - ta) / (tb - ta || 1));
  }
  return keys[keys.length - 1][1];
}
// Perimeter positions (0..1) of the window's corners, clockwise from top-left.
function cornerS(card) {
  const r = card.interior, w = r.x1 - r.x0, h = r.y1 - r.y0, L = 2 * (w + h);
  return { tl: 0, tr: w / L, br: (w + h) / L, bl: (2 * w + h) / L, L };
}
// Lens flare (the old videos' glints): a bright core, a pixel star, one long
// "/" ray and a shorter back-slanted one.
function flare(ctx, x, y, size, pal, rays = Math.floor(size * 0.8)) {
  x = Math.round(x); y = Math.round(y);
  ctx.sparkle(x, y, size, pal);
  if (size >= 4) for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]]) ctx.put(x + dx, y + dy, pal.core);
  if (size >= 6) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const m = Math.abs(dx) + Math.abs(dy); if (m <= 2) ctx.put(x + dx, y + dy, pal.core); else if (m === 3) ctx.put(x + dx, y + dy, pal.hi); }
  for (let r = 2; r <= rays; r++) {
    const c = r < rays * 0.55 ? pal.hi : pal.mid;
    ctx.put(x + r, y - r, c); ctx.put(x - r, y + r, c);
    if (r <= rays * 0.5) { ctx.put(x + r, y + r, pal.mid); ctx.put(x - r, y - r, pal.mid); }
  }
}
module.exports = { frameCells, ahead, hash, corners, outerPath, track, cornerS, flare };
