// Mjolnir's Anvil: the frame's veins charge up from the bottom, lightning
// crawls up both rails, the anvil charges and arcs across the top, bolts strike
// down to a burst at the bottom, then the frame crackles as it settles.
const { hue, lum, mix, easeOut } = require('../lib.cjs');
const { hash } = require('./_common.cjs');
const BOLT = { core: 0xffffff, glow: 0x6cc4ff, outer: 0x2a62d8 };
const SPARK = { core: 0xffffff, hi: 0xc8ecff, mid: 0x4fb2ff };

module.exports = {
  id: 'mjolnirs-anvil',
  seconds: 6,
  margin: { x: 14, y: 14 },
  effects(card, { rng }) {
    const { W, H, cell } = card;
    const AX = 45, AY = 14;
    const blue = (k) => { if (k < 0) return false; const h = hue(k); return h.s > 0.45 && h.h > 195 && h.h < 245 && lum(k) > 40; };
    const veins = [], anvil = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = cell(x, y);
      if (blue(k)) veins.push({ x, y });
      if (k >= 0 && Math.abs(x - AX) < 17 && y < 28 && lum(k) > 60) anvil.push({ x, y });
    }
    const { x0, x1, y0, y1 } = card.outer;
    const L = x0 + 4, Rr = x1 - 4, bottom = y1 - 6;
    const rand = rng(77);
    const sparks = Array.from({ length: 26 }, () => ({ a: -Math.PI * rand(), v: 10 + rand() * 18, life: 0.4 + rand() * 0.4 }));
    const crackles = Array.from({ length: 10 }, () => {
      const left = rand() < 0.5, y = 40 + rand() * 100;
      return { t0: 4.6 + rand() * 1.2, x: left ? L : Rr, y, len: 8 + rand() * 10 };
    });
    return (ctx, ts, f) => {
      const seed = Math.floor(f / 2) * 13; // bolts re-roll every other frame
      // Veins charge from the bottom upward, then hold a dim glow.
      if (ts >= 0.2 && ts < 1.4) {
        const front = H - easeOut((ts - 0.2) / 1.2) * H;
        for (const v of veins) { const d = v.y - front; if (d > 0 && d < 30) ctx.paint(v.x, v.y, (c) => mix(c, d < 6 ? 0xffffff : 0x9fdcff, d < 6 ? 0.9 : 0.6 * (1 - d / 30))); }
      }
      const charged = ts >= 1.4 && ts < 4.6;
      if (charged) for (const v of veins) if (hash(v.x, v.y, Math.floor(ts * 8)) < 0.35) ctx.lift(v.x, v.y, 0.45, 0xb8e6ff);
      // Lightning crawls up both rails.
      const cr = (ts - 1.2) / 1.1;
      if (cr >= 0 && cr < 1) {
        const top = bottom - easeOut(cr) * (bottom - y0 - 30);
        ctx.bolt(L, bottom, L + 1, top, seed + 1, { ...BOLT, rough: 0.12 });
        ctx.bolt(Rr, bottom, Rr - 1, top, seed + 2, { ...BOLT, rough: 0.12 });
        ctx.sparkle(L + 1, top, 2, SPARK); ctx.sparkle(Rr - 1, top, 2, SPARK);
      }
      // The anvil charges.
      const ch = (ts - 2.2) / 0.6;
      if (ch >= 0 && ch < 1.6) for (const a of anvil) if (hash(a.x, a.y, Math.floor(ts * 16)) < 0.5 + ch * 0.3) ctx.lift(a.x, a.y, Math.min(0.8, 0.3 + ch * 0.4), 0xd8f1ff);
      if (ch >= 0.6 && ch < 1.2) ctx.sparkle(AX, AY, [3, 5, 7, 6, 4, 2][Math.floor((ch - 0.6) / 0.6 * 6)], SPARK);
      // Arcs from the anvil to the top corners, and an arch across the window.
      const arc = (ts - 2.7) / 0.7;
      if (arc >= 0 && arc < 1) {
        ctx.bolt(AX - 6, AY + 6, L + 2, y0 + 30, seed + 3, BOLT);
        ctx.bolt(AX + 6, AY + 6, Rr - 2, y0 + 30, seed + 4, BOLT);
        if (arc > 0.3) { const pts = ctx.bolt(L + 4, y0 + 38, Rr - 4, y0 + 38, seed + 5, { ...BOLT, rough: 0.5 }); void pts; }
      }
      // Strike: bolts down both sides into a burst at the bottom.
      const st = (ts - 3.4) / 0.45;
      if (st >= 0 && st < 1) {
        const y = y0 + 30 + easeOut(st) * (bottom - y0 - 30);
        ctx.bolt(L + 2, y0 + 30, L + 3, y, seed + 6, { ...BOLT, rough: 0.2 });
        ctx.bolt(Rr - 2, y0 + 30, Rr - 3, y, seed + 7, { ...BOLT, rough: 0.2 });
      }
      const bu = (ts - 3.85) / 0.75;
      if (bu >= 0 && bu < 1) {
        const cx = (x0 + x1) / 2, cy = bottom;
        if (bu < 0.4) { ctx.bolt(L + 3, cy, cx, cy - 4, seed + 8, BOLT); ctx.bolt(Rr - 3, cy, cx, cy - 4, seed + 9, BOLT); }
        ctx.sparkle(cx, cy - 4, [4, 7, 8, 6, 4, 3, 2, 1][Math.floor(bu * 8)], SPARK);
        ctx.ring(cx, cy - 4, 4 + easeOut(bu) * 22, bu < 0.4 ? 0xc8ecff : 0x4fb2ff, { dither: bu > 0.55 ? 1 : 0 });
        for (const s of sparks) { const u = bu / s.life; if (u < 1) ctx.put(cx + Math.cos(s.a) * s.v * easeOut(u), cy - 4 + Math.sin(s.a) * s.v * easeOut(u) + u * u * 6, u < 0.5 ? 0xffffff : 0x7cc8ff); }
        for (const v of veins) ctx.lift(v.x, v.y, (1 - bu) * 0.8, 0xffffff);
      }
      // Settling crackles.
      for (const c of crackles) {
        const u = (ts - c.t0) / 0.18;
        if (u >= 0 && u < 1) ctx.bolt(c.x, c.y, c.x + (c.x < W / 2 ? 1 : -1), c.y + c.len, seed + c.y, { ...BOLT, rough: 0.5, depth: 3 });
      }
    };
  },
};
