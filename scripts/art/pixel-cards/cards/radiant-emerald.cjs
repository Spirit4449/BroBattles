// Radiant Emerald: light dashes race around the rails, gather speed, and
// burst at the bottom; green motes drift off the frame.
const { mix } = require('../lib.cjs');
const { frameCells, ahead, hash } = require('./_common.cjs');
const MINT = 0xb8ffd9;

module.exports = {
  id: 'radiant-emerald',
  seconds: 6,
  margin: { x: 12, y: 14 },
  effects(card, { rng }) {
    const cells = frameCells(card);
    const { x0, x1, y1 } = card.interior;
    const L = 2 * (card.interior.x1 - x0 + card.interior.y1 - card.interior.y0);
    const rand = rng(5);
    const motes = Array.from({ length: 16 }, () => { const c = cells[Math.floor(rand() * cells.length)]; return { x: c.x, y: c.y, t0: rand() * 6, life: 0.8 + rand() * 0.6, dx: (rand() - 0.5) * 6 }; });
    const bottom = cells.filter((c) => c.y >= y1 - 1);
    return (ctx, ts) => {
      // Dashes: envelope ramps up 0.3-3.4 s, travelling faster as it builds.
      const env = ts < 0.3 ? 0 : ts < 1.2 ? (ts - 0.3) / 0.9 : ts < 3.4 ? 1 : ts < 3.8 ? 1 - (ts - 3.4) / 0.4 : 0;
      if (env > 0) {
        const phase = (ts - 0.3) ** 1.5 * 0.09;
        for (const c of cells) {
          const d = ((c.s - phase) * L) / 7;
          const k = ((Math.floor(d) % 3) + 3) % 3;
          if (k === 0) ctx.paint(c.x, c.y, (p) => mix(p, MINT, 0.75 * env));
          else if (k === 1 && d % 1 < 0.5) ctx.lift(c.x, c.y, 0.2 * env, MINT);
        }
      }
      // Burst along the bottom rail, spreading from the middle.
      if (ts >= 3.6 && ts < 4.5) {
        const u = (ts - 3.6) / 0.9, mid = (x0 + x1) / 2, reach = u * (x1 - x0) * 0.7;
        for (const c of bottom) { const d = Math.abs(c.x - mid); if (d < reach) ctx.paint(c.x, c.y, (p) => mix(p, MINT, (1 - u) * (d > reach - 5 ? 1 : 0.6))); }
        if (u < 0.6) { ctx.sparkle(mid - reach, y1 + 2, 2, { core: 0xffffff, hi: MINT, mid: 0x3fd98a }); ctx.sparkle(mid + reach, y1 + 2, 2, { core: 0xffffff, hi: MINT, mid: 0x3fd98a }); }
        if (u < 0.35) ctx.sparkle(mid, y1 + 2, [2, 4, 5, 4][Math.floor(u / 0.35 * 4)], { core: 0xffffff, hi: MINT, mid: 0x3fd98a });
      }
      // Faint glitter and drifting motes all the time.
      const slot = Math.floor(ts * 10);
      for (const c of cells) if (hash(c.x, c.y, slot) < 0.006) ctx.lift(c.x, c.y, 0.7, MINT);
      for (const m of motes) {
        const age = ((ts - m.t0) % 6 + 6) % 6;
        if (age > m.life) continue;
        const u = age / m.life;
        ctx.put(m.x + m.dx * u, m.y - u * 10, u < 0.5 ? MINT : 0x3fd98a);
      }
    };
  },
};
