// Radiant Diamond: a cluster of stars skates around the frame while the ice
// facets glitter, then all four corners flash.
const { easeInOut } = require('../lib.cjs');
const { frameCells, ahead, hash, corners, outerPath } = require('./_common.cjs');
const ICE = { core: 0xffffff, hi: 0xd8f6ff, mid: 0x7fd2ff };

module.exports = {
  id: 'radiant-diamond',
  seconds: 6,
  margin: { x: 12, y: 14 },
  effects(card) {
    const cells = frameCells(card);
    const path = outerPath(card, 0);
    const cs = corners(card);
    const cluster = [[0, 0, 4], [-0.016, 3, 3], [-0.03, -3, 2], [-0.046, 2, 3], [-0.06, -1, 2], [-0.075, 2, 1]];
    return (ctx, ts) => {
      // Facet glitter everywhere, a few pixels per 1/12 s slot.
      const slot = Math.floor(ts * 12);
      for (const c of cells) if (hash(c.x, c.y, slot) < 0.012) ctx.lift(c.x, c.y, 0.85);
      if (ts >= 0.3 && ts < 4.3) {
        const head = easeInOut((ts - 0.3) / 4);
        for (const c of cells) { const d = ahead(c.s, head); if (d < 0.08) ctx.lift(c.x, c.y, 0.5 * (1 - d / 0.08)); }
        cluster.forEach(([ds, off, size], n) => {
          const [x, y] = path.point(head + ds);
          const tw = (Math.floor(ts * 16) + n) % 3 === 0 ? -1 : 0;
          ctx.sparkle(x + (y === path.y0 || y === path.y1 ? 0 : off), y + (y === path.y0 || y === path.y1 ? off : 0), size + tw, ICE);
        });
      }
      if (ts >= 4.5 && ts < 5.2) {
        const u = (ts - 4.5) / 0.7;
        const size = [1, 3, 5, 5, 4, 2, 1][Math.floor(u * 7)];
        for (const c of cs) ctx.sparkle(c.x, c.y, size, ICE);
        for (const c of cells) ctx.lift(c.x, c.y, Math.sin(u * Math.PI) * 0.3);
      }
    };
  },
};
