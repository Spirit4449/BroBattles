// Radiant Ruby: a glowing comet laps the frame, all four corners flare, and
// the frame beats twice like a heart.
const { mix, easeInOut } = require('../lib.cjs');
const { frameCells, ahead, corners, outerPath } = require('./_common.cjs');
const HOT = 0xffd0c0, RED = 0xff3b3b;
const RUBY = { core: 0xffffff, hi: 0xffc6c0, mid: 0xff4a4a };

module.exports = {
  id: 'radiant-ruby',
  seconds: 8,
  margin: { x: 12, y: 14 },
  effects(card) {
    const cells = frameCells(card);
    const cs = corners(card, 0);
    const path = outerPath(card, 1);
    return (ctx, ts) => {
      if (ts >= 0.4 && ts < 4.6) {
        const head = easeInOut((ts - 0.4) / 4.2);
        for (const c of cells) {
          const d = ahead(c.s, head);
          if (d < 0.12) ctx.paint(c.x, c.y, (p) => mix(p, d < 0.01 ? 0xffffff : d < 0.04 ? HOT : RED, (1 - d / 0.12) * 0.9));
        }
        // Glow spills outside the frame behind the head.
        for (let i = 0; i < 14; i++) { const [x, y] = path.point(head - i * 0.004); if (i % 2 === 0) ctx.behind(x + (x <= path.x0 ? -2 : x >= path.x1 ? 2 : 0), y + (y <= path.y0 ? -2 : y >= path.y1 ? 2 : 0), i < 5 ? 0xff7a6a : 0xb81f2a); }
        const [hx, hy] = path.point(head);
        ctx.sparkle(hx, hy, 2 + (Math.floor(ts * 12) % 2), RUBY);
      }
      const fu = (ts - 4.8) / 0.8;
      if (fu >= 0 && fu < 1) {
        const size = [1, 3, 5, 7, 7, 5, 3, 1][Math.floor(fu * 8)];
        for (const c of cs) { ctx.sparkle(c.x, c.y, size, RUBY); if (size >= 5) for (const [dx, dy] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) ctx.put(c.x + dx, c.y + dy, 0xffc6c0); }
        for (const c of cells) ctx.lift(c.x, c.y, Math.sin(fu * Math.PI) * 0.4, HOT);
      }
      // Heartbeat: two quick pulses.
      for (const t0 of [6.0, 6.35]) {
        const u = (ts - t0) / 0.3;
        if (u >= 0 && u < 1) for (const c of cells) ctx.lift(c.x, c.y, Math.sin(u * Math.PI) * 0.3, 0xff6060);
      }
    };
  },
};
