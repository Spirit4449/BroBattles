// Radiant Emerald (follows the original video): the top corners flare, bright
// dashes run down both side rails, the bottom corners flare, and the light
// races inward along the bottom rail to a spark in the middle.
const { mix } = require('../lib.cjs');
const { frameCells, hash, corners, track, flare } = require('./_common.cjs');
const MINT = 0xc8ffe0;
const GEM = { core: 0xffffff, hi: MINT, mid: 0x3fd98a };

module.exports = {
  id: 'radiant-emerald',
  seconds: 6,
  margin: { x: 12, y: 14 },
  effects(card) {
    const cells = frameCells(card);
    const [tl, tr, br, bl] = corners(card, 0);
    const { x0, x1, y0, y1 } = card.outer;
    const midX = (x0 + x1) / 2;
    const side = cells.filter((c) => c.y > y0 + 6 && c.y < y1 - 6 && (c.x < x0 + 5 || c.x > x1 - 5));
    const bottom = cells.filter((c) => c.y > y1 - 5 && c.x > x0 + 6 && c.x < x1 - 6);
    // A corner glow: the bracket lights up mint and a star flares on it.
    const cornerGlow = (ctx, c, u) => {
      const a = Math.sin(u * Math.PI);
      for (const p of cells) if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 12) ctx.paint(p.x, p.y, (k) => mix(k, MINT, a));
      flare(ctx, c.x, c.y, Math.round(a * 5), GEM);
    };
    // A dash: a short bright run of rail pixels.
    const dash = (ctx, list, along, pos, len, a) => {
      for (const c of list) { const d = along(c) - pos; if (d > -len && d < 1) ctx.paint(c.x, c.y, (k) => mix(k, d > -2 ? 0xffffff : MINT, a)); }
    };
    return (ctx, ts) => {
      // 1.2-1.8: top corners.
      const t1 = (ts - 1.2) / 0.6;
      if (t1 >= 0 && t1 < 1) for (const c of [tl, tr]) cornerGlow(ctx, c, t1);
      // 1.6-3.8: two dashes per side rail travel down, mirrored.
      for (const [start, dur] of [[1.6, 2.1], [2.0, 1.8]]) {
        const y = track([[start, y0 + 8], [start + dur, y1 - 6]], ts);
        if (y === null) continue;
        const fade = Math.min(1, (ts - start) / 0.2, (start + dur - ts) / 0.2);
        dash(ctx, side, (c) => c.y, y, 9, 0.95 * fade);
      }
      // 3.7-4.2: bottom corners.
      const t2 = (ts - 3.7) / 0.5;
      if (t2 >= 0 && t2 < 1) for (const c of [bl, br]) cornerGlow(ctx, c, t2);
      // 4.0-4.6: light races inward along the bottom rail and sparks at the middle.
      const b = (ts - 4.0) / 0.6;
      if (b >= 0 && b < 1) {
        const reach = Math.min(1, b / 0.7) * (midX - x0 - 6);
        const a = b < 0.7 ? 0.95 : (1 - b) / 0.3;
        dash(ctx, bottom, (c) => c.x, x0 + 6 + reach, 10, a);
        dash(ctx, bottom, (c) => -c.x, -(x1 - 6 - reach), 10, a);
        if (b > 0.6) flare(ctx, midX, y1, [3, 4, 3, 1][Math.floor((b - 0.6) / 0.4 * 4)], GEM);
      }
      // Faint glitter the rest of the time.
      const slot = Math.floor(ts * 10);
      for (const c of cells) if (hash(c.x, c.y, slot) < 0.001) ctx.lift(c.x, c.y, 0.7, MINT);
    };
  },
};
