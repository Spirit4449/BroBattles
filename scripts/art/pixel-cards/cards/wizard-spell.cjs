// Wizard Spell: a crystal grows from the top gem, flashes, and bursts into
// shards that rain down both sides; they gather into a bubble around the
// bottom gem that swells and pops, then the corner orbs pulse in turn.
const { hue, lum, easeOut, easeInOut } = require('../lib.cjs');
const MANA = { core: 0xffffff, hi: 0xc8f7ff, mid: 0x5fe3ff };
const C = { out: 0x0b2a44, dark: 0x1f8fc0, mid: 0x4fd2f5, light: 0xbff5ff, white: 0xffffff };

// Faceted pixel crystal standing on (cx, by), h px tall.
function crystal(ctx, cx, by, h, flash = 0) {
  if (h < 2) return;
  const w = Math.max(1, Math.round(h * 0.38));
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1); // 0 top, 1 bottom
    const half = Math.round(t < 0.3 ? (t / 0.3) * w : t < 0.75 ? w : w * (1 - (t - 0.75) / 0.25));
    const y = by - h + 1 + i;
    for (let dx = -half; dx <= half; dx++) {
      const edge = Math.abs(dx) === half;
      let c = edge ? C.out : dx < 0 ? C.light : dx === 0 ? C.mid : C.dark;
      if (!edge && dx === -1 && t > 0.2 && t < 0.6) c = C.white;
      if (flash && !edge) c = flash > 0.5 ? C.white : C.light;
      ctx.put(cx + dx, y, c);
    }
  }
}

module.exports = {
  id: 'wizard-spell',
  seconds: 6,
  margin: { x: 16, y: 26 },
  effects(card, { rng }) {
    const { W, H, cell } = card;
    const TX = 45, TY = 11, BX = 45, BY = 155;
    const cyan = (k) => { if (k < 0) return false; const h = hue(k); return h.s > 0.4 && h.h > 170 && h.h < 205 && lum(k) > 90; };
    const orbs = [[8, 17], [82, 17], [82, 157], [8, 157]];
    const gems = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cyan(cell(x, y))) gems.push({ x, y });
    const { x0, x1, y1 } = card.outer;
    const rand = rng(23);
    const shards = Array.from({ length: 54 }, (_, i) => {
      const left = i % 2 === 0;
      return { left, a: -Math.PI / 2 + (left ? -1 : 1) * (0.3 + rand() * 1.1), v: 12 + rand() * 18, delay: rand() * 0.25, rail: (left ? x0 - 1 - rand() * 4 : x1 + 1 + rand() * 4), big: rand() < 0.6, fall: 0.9 + rand() * 0.5 };
    });
    const motes = Array.from({ length: 14 }, () => ({ a: rand() * Math.PI * 2, r: 10 + rand() * 8 }));
    return (ctx, ts) => {
      // Gems shimmer softly all the time.
      for (const g of gems) if (((g.x * 7 + g.y * 3 + Math.floor(ts * 6)) % 11) === 0) ctx.lift(g.x, g.y, 0.5);
      // Crystal grows with mana spiralling in.
      const gr = (ts - 0.2) / 1.1;
      if (gr >= 0 && gr < 1) {
        crystal(ctx, TX, TY - 2, Math.round(easeOut(gr) * 22));
        for (const m of motes) { const r = m.r * 1.4 * (1 - gr), a = m.a + gr * 5; ctx.put(TX + Math.cos(a) * r, TY - 8 + Math.sin(a) * r * 0.7, gr > 0.6 ? 0xffffff : 0x5fe3ff); }
      }
      const fl = (ts - 1.3) / 0.35;
      if (fl >= 0 && fl < 1) { crystal(ctx, TX, TY - 2, 22, 1 - fl); ctx.sparkle(TX, TY - 12, [4, 8, 11, 8][Math.floor(fl * 4)], MANA); }
      // Burst, then the shards rain down the sides.
      const sh = ts - 1.65;
      if (sh >= 0 && sh < 2.3) for (const s of shards) {
        const t = sh - s.delay;
        if (t < 0) continue;
        let x, y;
        if (t < 0.35) { const u = easeOut(t / 0.35); x = TX + Math.cos(s.a) * s.v * u; y = TY - 12 + Math.sin(s.a) * s.v * u; }
        else {
          const u = Math.min(1, (t - 0.35) / s.fall);
          const sx = TX + Math.cos(s.a) * s.v, sy = TY - 12 + Math.sin(s.a) * s.v;
          x = sx + (s.rail - sx) * easeOut(Math.min(1, u * 3)) + Math.sin(u * 12 + s.v) * 1.2;
          y = sy + (BY - 4 - sy) * easeInOut(u);
          if (u >= 1) continue;
        }
        const c = t < 0.2 ? 0xffffff : t < 0.8 ? 0xbff5ff : 0x5fe3ff;
        ctx.put(x, y, c);
        if (s.big) { ctx.put(x + 1, y, 0x5fe3ff); ctx.put(x, y + 1, 0x1f8fc0); ctx.put(x + 1, y + 1, 0x4fd2f5); }
      }
      // Bubble around the bottom gem.
      const bb = (ts - 3.2) / 1.1;
      if (bb >= 0 && bb < 1) {
        const r = bb < 0.75 ? 3 + easeOut(bb / 0.75) * 15 : 18 + (bb - 0.75) * 20;
        const cy = BY - 4 - easeOut(bb) * 6;
        ctx.ring(BX, cy, r, bb < 0.75 ? 0xbff5ff : 0x5fe3ff, { dither: bb > 0.75 ? 2 : 0 });
        if (bb < 0.75) { ctx.ring(BX, cy, r - 1, 0x2a8fc0, { dither: 1 }); ctx.put(BX - r * 0.5, cy - r * 0.5, 0xffffff); ctx.put(BX - r * 0.5 + 1, cy - r * 0.5, 0xffffff); crystal(ctx, BX, cy + 5, Math.round(5 + bb * 12)); }
        else ctx.sparkle(BX, cy, [9, 6, 4, 2][Math.floor((bb - 0.75) / 0.25 * 4)], MANA);
      }
      // Corner orbs pulse clockwise.
      orbs.forEach(([x, y], n) => {
        const u = (ts - 4.6 - n * 0.22) / 0.4;
        if (u < 0 || u >= 1) return;
        ctx.sparkle(x, y, [1, 3, 4, 3, 1][Math.floor(u * 5)], MANA);
        for (const g of gems) if (Math.abs(g.x - x) < 4 && Math.abs(g.y - y) < 4) ctx.lift(g.x, g.y, 0.8);
      });
    };
  },
};
