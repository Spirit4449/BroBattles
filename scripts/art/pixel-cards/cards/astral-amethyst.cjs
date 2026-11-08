// Astral Amethyst: both crystals pulse, magenta and cyan lightning races round
// the frame and climbs the window to the top crystal, which overloads and
// explodes into pixel shards that fade into drifting star dust.
const { hue, lum, easeOut, easeInOut, rectPath } = require('../lib.cjs');
const { hash } = require('./_common.cjs');
const MAG = { core: 0xffffff, glow: 0xf06bff, outer: 0x8a2be2 };
const CYN = { core: 0xffffff, glow: 0x5ff0ff, outer: 0x2a7fd8 };
const STAR = { core: 0xffffff, hi: 0xf2d6ff, mid: 0xc06bff };
const CSTAR = { core: 0xffffff, hi: 0xd2fbff, mid: 0x5ff0ff };

module.exports = {
  id: 'astral-amethyst',
  seconds: 6,
  margin: { x: 20, y: 30 },
  effects(card, { rng }) {
    const { W, H, cell } = card;
    const TX = 45, TY = 11, BX = 45, BY = 154;
    const veins = [], crystalTop = [], crystalBot = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = cell(x, y);
      if (k < 0) continue;
      const h = hue(k);
      if (h.s > 0.5 && lum(k) > 90 && ((h.h > 170 && h.h < 200) || (h.h > 280 && h.h < 320))) veins.push({ x, y, s: card.perim(x, y) });
      if (Math.abs(x - TX) < 8 && y < 27 && lum(k) > 50) crystalTop.push({ x, y });
      if (Math.abs(x - BX) < 7 && y > 140 && lum(k) > 50) crystalBot.push({ x, y });
    }
    const path = rectPath(card.interior, -5); // along the middle of the rails
    const sTop = card.perim(TX, card.interior.y0 - 5), sBot = card.perim(BX, card.interior.y1 + 5);
    const it = card.interior;
    const rand = rng(99);
    const chunks = Array.from({ length: 72 }, () => {
      const a = rand() * Math.PI * 2;
      return { a, v: 18 + rand() * 42, size: rand() < 0.4 ? 3 : rand() < 0.6 ? 2 : 1, c: [0xffffff, 0xbff8ff, 0x5ff0ff, 0xf2b6ff][Math.floor(rand() * 4)], drift: (rand() - 0.5) * 6 };
    });
    const field = Array.from({ length: 40 }, () => ({ x: -16 + rand() * (W + 32), y: -24 + rand() * (H + 48), t0: rand() * 6, p: 1.2 + rand() * 1.8 }));
    const windowStars = Array.from({ length: 12 }, () => ({ x: it.x0 + 4 + rand() * (it.x1 - it.x0 - 8), y: it.y0 + 4 + rand() * (it.y1 - it.y0 - 8), t0: rand() * 6 }));
    const arcSeg = (ctx, sA, sB, seed, style) => { const [ax, ay] = path.point(sA), [bx, by] = path.point(sB); ctx.bolt(ax, ay, bx, by, seed, { ...style, rough: 0.7, depth: 4 }); };
    return (ctx, ts, f) => {
      const seed = Math.floor(f / 2) * 17;
      // Star field around the card and faint stars in the window.
      for (const s of field) { const ph = ((ts - s.t0) % s.p + s.p) % s.p / s.p; if (ph < 0.5) ctx.behind(s.x + Math.sin(ts + s.t0) * 1, s.y - ts * 1.5 % 1, ph < 0.15 ? 0xffffff : 0x9f7fd8); }
      for (const s of windowStars) { const ph = ((ts - s.t0) % 2 + 2) % 2; if (ph < 0.6) ctx.sparkle(s.x, s.y, ph > 0.15 && ph < 0.45 ? 1 : 0, STAR); }
      // Crystals pulse.
      const pulse = Math.max(0, Math.sin(ts * Math.PI * 2 / 1.5)) * 0.3;
      for (const c of crystalTop) ctx.lift(c.x, c.y, pulse, 0xffd6ff);
      for (const c of crystalBot) ctx.lift(c.x, c.y, pulse, 0xffd6ff);
      // Lightning races both ways round the frame, top to bottom.
      const lr = (ts - 0.6) / 1.4;
      if (lr >= 0 && lr < 1) {
        const span = ((sBot - sTop) % 1 + 1) % 1, head = easeInOut(lr);
        for (const [dir, style] of [[1, MAG], [-1, CYN]]) {
          const len = dir > 0 ? span : 1 - span;
          const a = sTop + dir * len * Math.max(0, head - 0.25), b = sTop + dir * len * head;
          const steps = 4;
          for (let i = 0; i < steps; i++) arcSeg(ctx, a + (b - a) * (i / steps), a + (b - a) * ((i + 1) / steps), seed + i * 3 + (dir > 0 ? 0 : 50), style);
          const [hx, hy] = path.point(b);
          ctx.sparkle(hx, hy, 2, dir > 0 ? STAR : CSTAR);
        }
        for (const v of veins) { const d = Math.min(Math.abs(v.s - (sTop + span * head)), Math.abs(v.s - (sTop - (1 - span) * head))); if (d < 0.08) ctx.lift(v.x, v.y, 0.6); }
      }
      // Bolts climb the window from the bottom crystal to the top crystal.
      const cl = (ts - 1.9) / 0.6;
      if (cl >= 0 && cl < 1) {
        const y = BY - 8 - easeOut(cl) * (BY - TY - 20);
        ctx.bolt(BX - 3, BY - 8, it.x0 + 4, Math.max(y, it.y0 + 20), seed + 5, MAG);
        ctx.bolt(BX + 3, BY - 8, it.x1 - 4, Math.max(y, it.y0 + 20), seed + 6, CYN);
        if (cl > 0.5) { ctx.bolt(it.x0 + 4, it.y0 + 20, TX - 2, TY + 10, seed + 7, MAG); ctx.bolt(it.x1 - 4, it.y0 + 20, TX + 2, TY + 10, seed + 8, CYN); }
      }
      // Overload.
      const ov = (ts - 2.5) / 0.5;
      if (ov >= 0 && ov < 1) { for (const c of crystalTop) ctx.lift(c.x, c.y, 0.4 + ov * 0.55); ctx.sparkle(TX, TY, [4, 7, 9, 11, 12][Math.floor(ov * 5)], STAR); }
      // Explosion into shards that slow, then become drifting dust.
      const ex = ts - 3.0;
      if (ex >= 0 && ex < 3) {
        if (ex < 0.7) { const u = ex / 0.7; ctx.ring(TX, TY, 4 + easeOut(u) * 48, u < 0.4 ? 0xffffff : 0xc06bff, { shape: 'diamond', dither: u > 0.5 ? 1 : 0 }); ctx.ring(TX, TY, 2 + easeOut(u) * 32, 0x5ff0ff, { dither: u > 0.4 ? 1 : 0 }); }
        if (ex < 0.3) { ctx.sparkle(TX, TY, 14 - Math.floor(ex * 40), STAR); for (let r = 0; r < 6 - ex * 18; r++) ctx.ring(TX, TY, r, 0xffffff); }
        for (const c of chunks) {
          const u = Math.min(1, ex / 1.1);
          const x = TX + Math.cos(c.a) * c.v * easeOut(u) + c.drift * Math.max(0, ex - 1.1) * 0.5;
          const y = TY + Math.sin(c.a) * c.v * easeOut(u) * 0.8 + Math.max(0, ex - 1.1) * 4;
          if (ex > 1.1) {
            // Dust: single pixels that twinkle out.
            if (hash(Math.round(c.a * 100), 0, Math.floor(ex * 8)) < (ex - 1.1) / 1.9) continue;
            ctx.put(x, y, hash(Math.round(c.a * 100), 1, Math.floor(ex * 10)) < 0.3 ? 0xffffff : 0xc9a6ff);
            continue;
          }
          const sz = ex < 0.5 ? c.size : ex < 0.8 ? Math.max(0, c.size - 1) : Math.max(0, c.size - 2);
          for (let dy = 0; dy <= sz; dy++) for (let dx = 0; dx <= sz; dx++) ctx.put(x + dx, y + dy, sz > 0 && (dx === sz || dy === sz) ? 0x9a5cf0 : c.c);
        }
        if (ex < 0.4) for (const v of veins) ctx.lift(v.x, v.y, (0.4 - ex) * 2);
      }
      // Veins shimmer and the bottom crystal flares to close the loop.
      if (ts > 4.2) for (const v of veins) if (hash(v.x, v.y, Math.floor(ts * 10)) < 0.08) ctx.lift(v.x, v.y, 0.7);
      const bf = (ts - 5.0) / 0.5;
      if (bf >= 0 && bf < 1) ctx.sparkle(BX, BY - 2, [2, 4, 6, 4, 2][Math.floor(bf * 5)], CSTAR);
    };
  },
};
