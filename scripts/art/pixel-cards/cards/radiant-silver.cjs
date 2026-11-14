// Radiant Silver (follows the original video): the top-left corner glints,
// then two striped gleams set off from it, one clockwise all the way round the
// frame and one straight down the left rail, flashing each corner they pass.
const { WHITE } = require('../lib.cjs');
const { frameCells, corners, track, cornerS, flare } = require('./_common.cjs');
const STEEL = { core: WHITE, hi: 0xeef4ff, mid: 0xa9b8cc };

module.exports = {
  id: 'radiant-silver',
  seconds: 6,
  margin: { x: 12, y: 14 },
  effects(card) {
    const cells = frameCells(card);
    const S = cornerS(card);
    const cs = corners(card, 0);
    // Gleam: a short band with bright diagonal stripes, centred at s.
    const gleam = (ctx, s, strength = 1) => {
      for (const c of cells) {
        let d = Math.abs(c.s - (((s % 1) + 1) % 1)); d = Math.min(d, 1 - d) * S.L;
        if (d > 13) continue;
        const stripe = ((c.x + c.y) % 6 + 6) % 6 < 2;
        const fall = 1 - (d / 13) ** 3;
        ctx.lift(c.x, c.y, Math.min(1, (stripe ? 1.4 : 0.75) * fall * strength));
      }
    };
    // Clockwise gleam: TL 1.1 -> TR 2.6 -> BR 4.0 -> BL 4.8 -> TL 5.8.
    const cw = [[1.1, 0], [2.6, S.tr], [4.0, S.br], [4.8, S.bl], [5.8, 1]];
    // Second gleam runs down the left rail from TL to BL, fading at the bottom.
    const ccw = [[1.1, 1], [2.95, S.bl + 0.02]];
    const passed = [[2.6, cs[1]], [4.0, cs[2]], [4.8, cs[3]], [5.8, cs[0]]];
    return (ctx, ts) => {
      // 0.4-1.1: the top-left corner kindles and flashes.
      const k = (ts - 0.4) / 0.75;
      if (k >= 0 && k < 1) { flare(ctx, cs[0].x, cs[0].y, [1, 2, 3, 4, 4, 3][Math.floor(k * 6)], STEEL); gleam(ctx, 0, k); }
      const a = track(cw, ts);
      if (a !== null) gleam(ctx, a, ts > 5.6 ? (5.8 - ts) / 0.2 : 1);
      const b = track(ccw, ts);
      if (b !== null) gleam(ctx, b, ts > 2.6 ? (2.95 - ts) / 0.35 : 1);
      // Corners flash as the clockwise gleam passes them.
      for (const [t0, c] of passed) {
        const u = (ts - t0 + 0.12) / 0.35;
        if (u >= 0 && u < 1) flare(ctx, c.x, c.y, [1, 3, 3, 2, 1][Math.floor(u * 5)], STEEL);
      }
    };
  },
};
