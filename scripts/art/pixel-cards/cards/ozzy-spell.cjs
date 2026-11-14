// Ozzy Spell (follows the original video): a big glowing crystal grows over
// the top gem with motes swirling round it, then shatters into chunky shards
// that stream along the top rail and down both side rails, gather at the
// bottom gem, and swell into a mana bubble that fades out.
const { hue, lum, easeOut, easeInOut, clamp01 } = require('../lib.cjs');
const { hash } = require('./_common.cjs');
const MANA = { core: 0xffffff, hi: 0xc8f7ff, mid: 0x5fe3ff };
const C = { out: 0x12557a, dark: 0x3fbfe8, mid: 0x7fe6ff, light: 0xc8f8ff, white: 0xffffff };

// Faceted pixel crystal standing on (cx, by), h px tall.
function crystal(ctx, cx, by, h, flash = 0) {
  if (h < 2) return;
  const w = Math.max(1, Math.round(h * 0.3));
  for (let i = 0; i < h; i++) {
    const t = i / (h - 1); // 0 top, 1 bottom
    const half = Math.round(t < 0.35 ? (t / 0.35) * w : t < 0.7 ? w : w * (1 - (t - 0.7) / 0.3));
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
  id: 'ozzy-spell',
  seconds: 6,
  margin: { x: 16, y: 26 },
  effects(card, { rng }) {
    const { W, H, cell } = card;
    const TX = 45, TY = 11, BX = 45, BY = 155;
    const cyan = (k) => { if (k < 0) return false; const h = hue(k); return h.s > 0.4 && h.h > 170 && h.h < 205 && lum(k) > 90; };
    const gems = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (cyan(cell(x, y))) gems.push({ x, y });
    const { x0, x1, y0, y1 } = card.outer;
    const rand = rng(23);
    // Each shard follows top rail -> corner -> side rail -> bottom corner -> bottom gem.
    const shards = Array.from({ length: 110 }, (_, i) => ({
      left: i % 2 === 0, delay: rand() * 0.55, speed: 0.85 + rand() * 0.35, off: (rand() - 0.5) * 7,
      size: rand() < 0.6 ? 2 : 1, jit: rand() * 10,
    }));
    const motes = Array.from({ length: 16 }, () => ({ a: rand() * Math.PI * 2, r: 9 + rand() * 7, sp: 2 + rand() * 2 }));
    const CRY_H = 28, CRY_BOTTOM = TY + 15;
    const block = (ctx, x, y, n, c, shade) => { for (let dy = 0; dy <= n; dy++) for (let dx = 0; dx <= n; dx++) ctx.put(x + dx, y + dy, dx === n || dy === n ? shade : c); };
    // Soft glow: dithered cyan over clear or dark pixels only, so the frame stays crisp.
    const dark = (x, y) => { const k = cell(Math.round(x), Math.round(y)); return k < 0 || lum(k) < 30; };
    const halo = (ctx, cx, cy, r, a) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const d = Math.hypot(dx, dy) / r; if (d < 1 && dark(cx + dx, cy + dy) && hash(cx + dx, cy + dy, 3) < a * (1 - d) * 0.7) ctx.put(cx + dx, cy + dy, d < 0.45 ? 0x2a8fc0 : d < 0.75 ? 0x1b6688 : 0x123e58); } };
    // Waypoints for a shard (art px), and its position at path fraction u.
    const route = (left, off) => {
      const sx = left ? x0 - 1 + off * 0.3 : x1 + 1 + off * 0.3;
      return [[TX + off, TY + 2], [sx, y0 + 6 + off * 0.3], [sx, y1 - 4], [BX + (left ? -6 : 6) + off * 0.5, y1 - 3 + off * 0.2]];
    };
    const lens = (pts) => pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const at = (pts, u) => {
      const ls = lens(pts), total = ls.reduce((a, b) => a + b, 0);
      let d = clamp01(u) * total;
      for (let i = 0; i < ls.length; i++) { if (d <= ls[i]) { const t = d / ls[i]; return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]; } d -= ls[i]; }
      return pts[pts.length - 1];
    };
    return (ctx, ts) => {
      // Gems shimmer softly all the time.
      for (const g of gems) if (((g.x * 7 + g.y * 3 + Math.floor(ts * 6)) % 11) === 0) ctx.lift(g.x, g.y, 0.5);
      // 0.2-1.0: the crystal grows over the top gem; 1.0-1.85 it hangs there glowing.
      const gr = (ts - 0.2) / 0.8;
      if (gr >= 0 && ts < 1.85) {
        const h = Math.round(easeOut(Math.min(1, gr)) * CRY_H);
        halo(ctx, TX, CRY_BOTTOM - h / 2, Math.round(6 + h * 0.6), Math.min(1, gr));
        crystal(ctx, TX, CRY_BOTTOM, h, ts > 1.65 ? (ts - 1.65) / 0.2 : 0);
        if (ts > 0.7) for (const m of motes) { const a = m.a + ts * m.sp; ctx.put(TX + Math.cos(a) * m.r, CRY_BOTTOM - h / 2 + Math.sin(a) * m.r * 0.8, Math.floor(ts * 12 + m.r) % 3 ? 0xbff5ff : 0xffffff); }
        if (ts > 1.6) ctx.sparkle(TX, CRY_BOTTOM - h / 2, [3, 6, 8][Math.min(2, Math.floor((ts - 1.6) / 0.09))], MANA);
      }
      // 1.85-2.15: it shatters into a cloud of chunks.
      const sb = (ts - 1.85) / 0.35;
      if (sb >= 0 && sb < 1) for (const s of shards.slice(0, 40)) {
        const a = s.jit * 0.63, r = easeOut(sb) * (6 + s.jit * 1.2);
        block(ctx, TX + Math.cos(a) * r * 1.3, CRY_BOTTOM - 8 + Math.sin(a) * r * 0.6, s.size, sb < 0.3 ? 0xffffff : 0xbff5ff, 0x4fd2f5);
      }
      // 2.0-3.4: shards stream along the rails to the bottom gem.
      for (const s of shards) {
        const u = (ts - 2.0 - s.delay) / (1.25 / s.speed);
        if (u < 0 || u >= 1.08) continue;
        const [x, y] = at(route(s.left, s.off), u);
        const wob = Math.sin(ts * 9 + s.jit) * 1.2;
        const c = u < 0.15 ? 0xffffff : u < 0.7 ? 0xbff5ff : 0x8feaff;
        block(ctx, x + wob, y, s.size, c, 0x2a8fc0);
      }
      // 3.2-4.25: they gather into a glowing orb and swell into a bubble.
      const bb = (ts - 3.2) / 1.05;
      if (bb >= 0 && bb < 1) {
        const r = Math.round(4 + easeOut(Math.min(1, bb / 0.6)) * 21);
        const cy = BY - 2;
        const fade = bb < 0.7 ? 1 : 1 - (bb - 0.7) / 0.3;
        // Dome: the outline and a sparse dithered fill (upper half only shows above the rail).
        for (let dy = -r; dy <= 0; dy++) for (let dx = -r; dx <= r; dx++) {
          const d = Math.hypot(dx, dy);
          if (d > r) continue;
          if (d > r - 1) { if (fade > 0.35 || (dx + dy) % 2 === 0) ctx.put(BX + dx, cy + dy, fade > 0.5 ? 0xbff5ff : 0x5fe3ff); }
          else if (d > r - 2.2 && fade > 0.3) ctx.put(BX + dx, cy + dy, 0x2f9fc8);
          else if (hash(dx, dy, Math.floor(ts * 8)) < 0.05 * fade) ctx.put(BX + dx, cy + dy, 0x8feaff);
          else if (dark(BX + dx, cy + dy) && hash(dx, dy, 5) < 0.35 * fade * (1 - d / r * 0.6)) ctx.put(BX + dx, cy + dy, d < r * 0.5 ? 0x1f7fa6 : 0x16506e);
        }
        if (fade > 0.2) { ctx.put(BX - r * 0.55, cy - r * 0.6, 0xffffff); ctx.put(BX - r * 0.55 + 1, cy - r * 0.6, 0xffffff); }
        if (bb < 0.25) ctx.sparkle(BX, cy - 2, [4, 6, 5][Math.floor(bb / 0.25 * 3)], MANA);
        crystal(ctx, BX, cy, Math.round(4 + Math.min(1, bb * 2) * 6));
        // Shards still drifting inside.
        for (const s of shards.slice(0, 24)) { const a = s.jit * 0.63 + ts, rr = (r - 3) * (0.3 + (s.jit % 1) * 0.6); if (fade > 0.3) ctx.put(BX + Math.cos(a) * rr, cy - Math.abs(Math.sin(a)) * rr, 0xbff5ff); }
      }
    };
  },
};
