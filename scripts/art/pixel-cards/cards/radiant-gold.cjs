// Radiant Gold (follows the original video): a gleam runs along the top rail
// from the top-left corner and flares at the top-right, sparkles slide down
// both rails, both bottom corners burst, and the sparkles skate along the
// bottom rail before the frame settles to a faint twinkle.
const { easeOut } = require('../lib.cjs');
const { frameCells, hash, corners, track, flare } = require('./_common.cjs');
const GOLD = { core: 0xffffff, hi: 0xfff1a8, mid: 0xffc83a };

module.exports = {
  id: 'radiant-gold',
  seconds: 6,
  margin: { x: 14, y: 16 },
  effects(card) {
    const cells = frameCells(card);
    const [tl, tr, br, bl] = corners(card, 0);
    const { x0, x1, y0, y1 } = card.outer;
    const midX = (x0 + x1) / 2;
    // Gleam: a bright streak with a tail, riding the top rail.
    const gleam = (ctx, hx, hy, dir, len, vertical) => {
      for (const c of cells) {
        const along = vertical ? (c.y - hy) * dir : (c.x - hx) * dir;
        const off = vertical ? Math.abs(c.x - hx) : Math.abs(c.y - hy);
        if (off > 4 || along > 1 || along < -len) continue;
        const u = -along / len;
        ctx.lift(c.x, c.y, u < 0.25 ? 1 : 0.95 * (1 - u * 0.8), 0xfffbe6);
      }
    };
    return (ctx, ts) => {
      // 0.35-0.55: the top-left corner kindles.
      const k = (ts - 0.3) / 0.3;
      if (k >= 0 && k < 1) flare(ctx, tl.x, tl.y, [1, 2, 3, 3, 2][Math.floor(k * 5)], GOLD);
      // 0.5-1.3: gleam along the top rail.
      const gx = track([[0.5, x0], [1.3, x1]], ts);
      if (gx !== null) { gleam(ctx, gx, y0 + 2, 1, 22, false); ctx.sparkle(gx, y0, 2, GOLD); }
      // 1.25-1.65: top-right flare.
      const f = (ts - 1.25) / 0.45;
      if (f >= 0 && f < 1) flare(ctx, tr.x, tr.y, [3, 5, 6, 6, 4, 2][Math.floor(f * 6)], GOLD, 9);
      // Sparkles slide down the left rail (0.75-2.0) and the right (1.4-2.3).
      for (const [keys, x] of [[[[0.75, y0 + 10], [2.05, y1 - 6]], x0], [[[1.4, y0 + 10], [2.3, y1 - 6]], x1]]) {
        const y = track(keys, ts);
        if (y === null) continue;
        gleam(ctx, x, y, 1, 12, true);
        flare(ctx, x, y, 4 + (Math.floor(ts * 14) % 2), GOLD, 7);
      }
      // 2.25-2.9: both bottom corners burst with long rays.
      const u = (ts - 2.2) / 0.7;
      if (u >= 0 && u < 1) {
        const size = [3, 6, 8, 8, 7, 5, 3][Math.floor(u * 7)];
        for (const c of [bl, br]) flare(ctx, c.x, c.y, size, GOLD, size + 4);
        for (const c of cells) if (c.y > y1 - 12) ctx.lift(c.x, c.y, Math.sin(u * Math.PI) * 0.4);
      }
      // 2.6-3.6: sparkles skate inward along the bottom rail and fade.
      const b = (ts - 2.6) / 1.0;
      if (b >= 0 && b < 1) {
        const p = easeOut(b);
        const size = b < 0.6 ? 4 : b < 0.85 ? 3 : 1;
        for (const [sx, ex] of [[x0 + 4, midX - 6], [x1 - 4, midX + 10]]) { const x = sx + (ex - sx) * p; flare(ctx, x, y1, size, GOLD, size + 1); gleam(ctx, x, y1 - 2, sx < ex ? 1 : -1, 10, false); }
      }
      // A faint twinkle keeps the rest of the loop alive.
      const slot = Math.floor(ts * 8);
      for (const c of cells) if (hash(c.x, c.y, slot) < 0.0008) ctx.sparkle(c.x, c.y, 0, GOLD);
    };
  },
};
