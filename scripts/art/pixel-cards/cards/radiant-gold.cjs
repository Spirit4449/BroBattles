// Radiant Gold: a gleam sweeps diagonally across the frame, flares step
// around the corners and sides, and the two bottom corners burst together.
const { easeInOut } = require('../lib.cjs');
const { frameCells, hash, corners } = require('./_common.cjs');
const GOLD = { core: 0xffffff, hi: 0xfff1a8, mid: 0xffc83a };

module.exports = {
  id: 'radiant-gold',
  seconds: 6,
  margin: { x: 14, y: 16 },
  effects(card) {
    const cells = frameCells(card);
    const [tl, tr, br, bl] = corners(card, 0);
    const { x0, x1, y0, y1 } = card.outer;
    const flares = [
      [0.4, tl.x, tl.y], [0.75, (x0 + x1) / 2 - 10, y0], [1.05, tr.x, tr.y], [1.4, x1, y0 + (y1 - y0) * 0.3],
      [1.75, x0, y0 + (y1 - y0) * 0.45], [2.1, x1, y0 + (y1 - y0) * 0.7], [2.45, x0, y1 - 8],
    ];
    const W = card.W, H = card.H;
    return (ctx, ts) => {
      // Diagonal gleam (2:1 pixel slope) across the frame.
      for (const [a, b] of [[0.2, 1.4], [4.0, 5.0], [5.1, 5.9]]) {
        if (ts < a || ts >= b) continue;
        const p = -20 + easeInOut((ts - a) / (b - a)) * (2 * W + H + 40);
        for (const c of cells) { const d = Math.abs(2 * c.x + c.y - p); if (d < 3) ctx.lift(c.x, c.y, 0.95, 0xfffbe6); else if (d < 8) ctx.lift(c.x, c.y, 0.45, 0xfff3b0); }
      }
      for (const [t0, x, y] of flares) {
        const u = (ts - t0) / 0.45;
        if (u >= 0 && u < 1) ctx.sparkle(x, y, [1, 3, 4, 5, 5, 4, 2, 0][Math.floor(u * 8)], GOLD);
      }
      // Both bottom corners burst with long rays.
      const u = (ts - 2.9) / 0.9;
      if (u >= 0 && u < 1) {
        const size = [2, 4, 6, 8, 8, 7, 5, 3, 2][Math.floor(u * 9)];
        for (const c of [bl, br]) { ctx.sparkle(c.x, c.y, size, GOLD); if (size > 4) for (const [dx, dy] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) ctx.put(c.x + dx, c.y + dy, 0xfff1a8); }
        for (const c of cells) if (c.y > y1 - 14) ctx.lift(c.x, c.y, Math.sin(u * Math.PI) * 0.35);
      }
      const slot = Math.floor(ts * 10);
      for (const c of cells) if (hash(c.x, c.y, slot) < 0.01) ctx.sparkle(c.x, c.y, hash(c.x, c.y, slot + 99) < 0.3 ? 1 : 0, GOLD);
    };
  },
};
