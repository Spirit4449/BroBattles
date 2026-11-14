// Radiant Ruby: a striped gleam (the same kind as Radiant Silver's) laps the
// frame clockwise from the top-left corner, all four corners flare, then the
// frame dims for a beat and comes back.
const { mix } = require('../lib.cjs');
const { frameCells, corners, track, cornerS, flare } = require('./_common.cjs');
const HOT = 0xffd8cc;
const RUBY = { core: 0xffffff, hi: 0xffc6c0, mid: 0xff4a4a };

module.exports = {
  id: 'radiant-ruby',
  seconds: 8,
  margin: { x: 12, y: 14 },
  effects(card) {
    const cells = frameCells(card);
    const cs = corners(card, 0);
    const S = cornerS(card);
    // TL 0.9 -> TR 1.9 -> BR 3.3 -> BL 3.9 -> TL 5.0 -> fades along the top by 5.5.
    const lap = [[0.85, -0.01], [1.9, S.tr], [3.3, S.br], [3.9, S.bl], [5.0, 1], [5.5, 1 + S.tr * 0.55]];
    // Gleam: a short band with bright diagonal stripes, centred at s.
    const gleam = (ctx, s, strength) => {
      for (const c of cells) {
        let d = Math.abs(c.s - (((s % 1) + 1) % 1)); d = Math.min(d, 1 - d) * S.L;
        if (d > 13) continue;
        const stripe = ((c.x + c.y) % 6 + 6) % 6 < 2;
        const fall = 1 - (d / 13) ** 3;
        ctx.lift(c.x, c.y, Math.min(1, (stripe ? 1.4 : 0.75) * fall * strength), stripe ? 0xffffff : 0xffd8d2);
      }
    };
    return (ctx, ts) => {
      const head = track(lap, ts);
      if (head !== null) {
        const fade = ts > 5.2 ? (5.5 - ts) / 0.3 : ts < 1.0 ? (ts - 0.85) / 0.15 : 1;
        gleam(ctx, head, fade);
      }
      // 5.55-6.4: all four corners flare.
      const fu = (ts - 5.55) / 0.85;
      if (fu >= 0 && fu < 1) {
        const size = [2, 4, 6, 7, 7, 5, 3, 1][Math.floor(fu * 8)];
        for (const c of cs) { flare(ctx, c.x, c.y, size, RUBY, size + 3); if (size >= 5) for (const p of cells) if (Math.abs(p.x - c.x) + Math.abs(p.y - c.y) < 8) ctx.paint(p.x, p.y, (k) => mix(k, HOT, 0.7)); }
        for (const c of cells) ctx.lift(c.x, c.y, Math.sin(fu * Math.PI) * 0.3, HOT);
      }
      // 6.5-7.4: the frame dims for a beat, then returns.
      const dm = (ts - 6.5) / 0.9;
      if (dm >= 0 && dm < 1) { const a = Math.sin(dm * Math.PI) * 0.65; for (const c of cells) ctx.paint(c.x, c.y, (p) => mix(p, 0x1a0508, a)); }
    };
  },
};
