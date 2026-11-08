// Shuriken Strike: the shuriken's light spins round its blades and flashes,
// stars slide down both rails, the kunai glint, two slashes cross the card,
// and the ribbon tails flutter the whole time.
const { lum, hue, easeOut, easeInOut } = require('../lib.cjs');
const { hash } = require('./_common.cjs');
const STEEL = { core: 0xffffff, hi: 0xe6ecf5, mid: 0x9fb0c6 };

module.exports = {
  id: 'shuriken-strike',
  seconds: 6,
  margin: { x: 16, y: 14 },
  effects(card) {
    const { W, H, cell } = card;
    const SX = 45, SY = 15; // shuriken centre (art px)
    const steel = (k) => k >= 0 && lum(k) > 105 && hue(k).s < 0.3;
    const red = (k) => { if (k < 0) return false; const h = hue(k); return h.s > 0.5 && (h.h < 18 || h.h > 340); };
    const star = [], ribbon = [], kunai = [], rails = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = cell(x, y);
      if (steel(k) && Math.hypot(x - SX, y - SY) < 18) star.push({ x, y, a: Math.atan2(y - SY, x - SX) });
      if (red(k) && y > 24 && y < 90 && (x < 14 || x > 75)) ribbon.push({ x, y, k });
      if (steel(k) && y > 128 && y < 146) kunai.push({ x, y });
      if (steel(k) && y > 34 && y < 128) rails.push({ x, y });
    }
    const { x0, x1, y0, y1 } = card.outer;
    const side = (s, t) => [s < 0 ? x0 : x1, t];
    const angDist = (a, b) => { const d = Math.abs(((a - b) % (2 * Math.PI) + 3 * Math.PI) % (2 * Math.PI) - Math.PI); return d; };
    const slash = (ctx, u, ax, ay, bx, by) => {
      // A white cut that draws in fast, then breaks into a dither and fades.
      const head = easeOut(Math.min(1, u / 0.45));
      const tail = u < 0.45 ? 0 : (u - 0.45) / 0.55;
      const n = 150;
      for (let i = Math.floor(tail * n); i <= head * n; i++) {
        const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
        if (tail > 0.4 && Math.floor(i / 2) % 2) continue;
        // Thick in the middle of the cut, tapering at both ends.
        const w = tail < 0.3 ? Math.round(2.5 * Math.sin(t * Math.PI)) : 0;
        for (let o = -w; o <= w; o++) ctx.put(x + o, y, Math.abs(o) === w && w > 0 ? 0xa9bdd6 : tail < 0.3 ? 0xffffff : 0xcfe0f2);
        if (tail < 0.6) ctx.put(x + w + 1, y, 0x6f84a3);
      }
      if (u < 0.45) ctx.sparkle(ax + (bx - ax) * head, ay + (by - ay) * head, 2, STEEL);
    };
    return (ctx, ts) => {
      // Ribbon tails flutter: displacement grows down the ribbon.
      for (const r of ribbon) ctx.paint(r.x, r.y, () => -1);
      for (const r of ribbon) {
        const amp = Math.min(1, (r.y - 26) / 22) * 2.2;
        const dir = r.x < W / 2 ? -1 : 1;
        const dx = Math.round(Math.sin(ts * 2 * Math.PI * (4 / 6) * 2 - r.y * 0.28) * amp * dir);
        const dy = Math.round(Math.max(0, Math.sin(ts * 2 * Math.PI * (4 / 6) * 2 - r.y * 0.28 + 1)) * amp * 0.4);
        ctx.put(r.x + dx, r.y + dy, r.k);
      }
      // Spinning light on the shuriken blades.
      if (ts >= 0.2 && ts < 1.3) {
        const phi = easeInOut((ts - 0.2) / 1.1) * Math.PI * 4;
        for (const s of star) { const d = Math.min(angDist(s.a, phi), angDist(s.a, phi + Math.PI)); if (d < 0.45) ctx.lift(s.x, s.y, d < 0.2 ? 0.9 : 0.5); }
      }
      const fl = (ts - 1.2) / 0.45;
      if (fl >= 0 && fl < 1) { ctx.sparkle(SX, SY, [2, 4, 6, 7, 6, 4, 2][Math.floor(fl * 7)], STEEL); for (const s of star) ctx.lift(s.x, s.y, Math.sin(fl * Math.PI) * 0.5); }
      // Stars slide down both rails.
      const sl = (ts - 1.5) / 1.1;
      if (sl >= 0 && sl < 1) {
        const y = 30 + easeInOut(sl) * 100;
        for (const sd of [-1, 1]) { const [x] = side(sd, 0); ctx.sparkle(x, y, 3 - (Math.floor(ts * 14) % 2), STEEL); ctx.sparkle(x, y - 7, 1, STEEL); }
        for (const r of rails) if (Math.abs(r.y - y) < 4) ctx.lift(r.x, r.y, 0.6);
      }
      // Kunai glint sweeps left to right, then tips sparkle.
      const kg = (ts - 2.6) / 0.7;
      if (kg >= 0 && kg < 1) { const p = 6 + kg * 80; for (const k of kunai) { const d = Math.abs(k.x + (k.y - 136) * 0.5 - p); if (d < 2) ctx.lift(k.x, k.y, 0.95); else if (d < 5) ctx.lift(k.x, k.y, 0.45); } }
      const kt = (ts - 3.2) / 0.5;
      if (kt >= 0 && kt < 1) { const size = [1, 3, 4, 3, 1][Math.floor(kt * 5)]; ctx.sparkle(10, 146, size, STEEL); ctx.sparkle(80, 146, size, STEEL); ctx.sparkle(45, 137, size - 1, STEEL); }
      // Two slashes cross the card.
      const s1 = (ts - 3.9) / 0.6, s2 = (ts - 4.15) / 0.6;
      if (s1 >= 0 && s1 < 1) slash(ctx, s1, x1 + 6, 40, x0 - 6, 125);
      if (s2 >= 0 && s2 < 1) slash(ctx, s2, x0 - 6, 40, x1 + 6, 125);
      // Glints on the steel.
      const slot = Math.floor(ts * 10);
      for (const r of rails) if (hash(r.x, r.y, slot) < 0.008) ctx.sparkle(r.x, r.y, 1, STEEL);
    };
  },
};
