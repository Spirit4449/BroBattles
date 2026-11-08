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
module.exports = { frameCells, ahead, hash, corners, outerPath };
