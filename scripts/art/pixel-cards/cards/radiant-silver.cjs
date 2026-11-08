// Radiant Silver: a striped glint runs around the frame, the corner bolts
// flash as it passes, then a quicker second glint and scattered twinkles.
const { rectPath, easeInOut } = require('../lib.cjs');

module.exports = {
  id: 'radiant-silver',
  seconds: 6,
  margin: { x: 12, y: 14 },
  effects(card, { rng }) {
    const rand = rng(11);
    const cells = card.frameCells.map(([x, y]) => ({ x, y, s: card.perim(x, y) }));
    const { x0, y0, x1, y1 } = card.outer;
    const corners = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => [x, y, card.perim(x, y)]);
    const outer = rectPath(card.outer, 0);
    const twinkles = Array.from({ length: 10 }, () => { const c = cells[Math.floor(rand() * cells.length)]; return { ...c, t0: rand() * 6 }; });
    const sweep = (ctx, ts, a, b, width, strength) => {
      if (ts < a || ts >= b) return -1;
      const head = easeInOut((ts - a) / (b - a));
      for (const c of cells) {
        const d = ((head - c.s) % 1 + 1) % 1; // distance behind the head
        if (d > width) continue;
        const u = d / width;
        const stripe = ((c.x + c.y) % 7 + 7) % 7 < 2;
        ctx.lift(c.x, c.y, Math.min(1, (stripe ? 1.15 : 0.5) * (1 - u * u) * strength));
      }
      return head;
    };
    return (ctx, ts) => {
      const head = sweep(ctx, ts, 0.3, 3.3, 0.1, 1);
      const head2 = sweep(ctx, ts, 3.9, 5.4, 0.07, 0.9);
      // A star rides the outer edge at each glint's head.
      for (const h of [head, head2]) if (h >= 0) { const [px, py] = outer.point(h); ctx.sparkle(px, py, 2 + (Math.floor(ts * 12) % 2)); }
      // Corner bolts flash as the first glint passes them.
      if (head >= 0) for (const [cx, cy, s] of corners) {
        const d = ((head - s) % 1 + 1) % 1;
        if (d < 0.04) ctx.sparkle(cx, cy, d < 0.01 ? 2 : d < 0.025 ? 4 : 1);
      }
      for (const tw of twinkles) {
        const age = ((ts - tw.t0) % 6 + 6) % 6;
        if (age < 0.3) ctx.sparkle(tw.x, tw.y, age < 0.08 || age > 0.22 ? 0 : 1);
      }
      // Gentle sheen across the whole frame at the loop's midpoint.
      if (ts >= 3.3 && ts < 3.9) { const a = Math.sin(((ts - 3.3) / 0.6) * Math.PI) * 0.18; for (const c of cells) ctx.lift(c.x, c.y, a); }
    };
  },
};
