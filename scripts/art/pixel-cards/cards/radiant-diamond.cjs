// Radiant Diamond (follows the original video): a trailing cluster of ice
// stars skates clockwise round the frame, a lap and a quarter, while the
// facets glitter; the frame then rests with a faint glitter.
const { frameCells, ahead, hash, outerPath, track, cornerS } = require('./_common.cjs');
const ICE = { core: 0xffffff, hi: 0xd8f6ff, mid: 0x7fd2ff };

module.exports = {
  id: 'radiant-diamond',
  seconds: 6,
  margin: { x: 12, y: 14 },
  effects(card) {
    const cells = frameCells(card);
    const path = outerPath(card, 0);
    const S = cornerS(card);
    // TL 0.25 -> TR 1.0 -> BR 2.0 -> BL 2.5 -> TL 3.3 -> TR 4.0 -> fade 4.5.
    const lap = [[0.2, -0.01], [1.0, S.tr], [2.0, S.br], [2.5, S.bl], [3.3, 1], [4.0, 1 + S.tr], [4.5, 1 + S.tr + 0.06]];
    // [lag behind the head, offset off the rail, size]
    const cluster = [[0, 0, 6], [0.018, 3, 4], [0.032, -3, 5], [0.05, 2, 3], [0.066, -2, 4]];
    return (ctx, ts) => {
      const slot = Math.floor(ts * 12);
      for (const c of cells) if (hash(c.x, c.y, slot) < 0.002) ctx.lift(c.x, c.y, 0.85);
      const head = track(lap, ts);
      if (head === null) return;
      const fade = ts > 4.1 ? (4.5 - ts) / 0.4 : ts < 0.35 ? (ts - 0.2) / 0.15 : 1;
      for (const c of cells) { const d = ahead(c.s, head); if (d < 0.1) ctx.lift(c.x, c.y, 0.6 * fade * (1 - d / 0.1)); }
      cluster.forEach(([ds, off, size], n) => {
        const [x, y] = path.point(head - ds);
        const horiz = y === path.y0 || y === path.y1;
        const tw = (Math.floor(ts * 16) + n) % 3 === 0 ? -1 : 0;
        const sz = Math.round((size + tw) * fade);
        if (sz >= 0 && (fade > 0.3 || n < 4)) ctx.sparkle(x + (horiz ? 0 : off), y + (horiz ? off : 0), sz, ICE);
      });
    };
  },
};
