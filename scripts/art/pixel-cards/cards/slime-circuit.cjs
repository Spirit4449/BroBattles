// Slime Circuit: pulses race along the circuit lines, a wavy slime pool fills
// the bottom of the window with bubbles and drips, the slime face blinks, the
// frame's slime breathes, a sheen runs down the stone, and big stars flash.
const { hue, lum, mix, easeOut, easeInOut } = require('../lib.cjs');
const { hash } = require('./_common.cjs');
const SLIME = { deep: 0x1d6b1d, mid: 0x34a82a, light: 0x6fe043, top: 0xb6ff78 };
const STAR = { core: 0xffffff, hi: 0xe2ffc8, mid: 0x8cf05a };

module.exports = {
  id: 'slime-circuit',
  seconds: 6,
  margin: { x: 14, y: 14 },
  effects(card, { rng }) {
    const { W, H, cell } = card;
    const it = card.interior;
    const green = (k) => { if (k < 0) return false; const h = hue(k); return h.s > 0.45 && h.h > 75 && h.h < 150; };
    const circuit = [], slimeCells = [], stone = [], face = [], eyes = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = cell(x, y);
      if (k < 0) continue;
      const inside = it.mask[y * W + x];
      if (green(k) && lum(k) < 95 && (inside || (x > it.x0 - 3 && x < it.x1 + 3 && y > it.y0 - 3 && y < it.y1 + 3))) circuit.push({ x, y, s: card.perim(x, y) });
      if (green(k) && lum(k) >= 95 && !inside) slimeCells.push({ x, y });
      if (!green(k) && lum(k) > 70 && hue(k).s < 0.2 && !inside) stone.push({ x, y });
      if (y < 20 && x > 34 && x < 54) { if (green(k)) face.push({ x, y }); else if (lum(k) < 40 && y > 8 && y < 16 && x > 38 && x < 50) eyes.push({ x, y, k }); }
    }
    const rand = rng(41);
    const bubbles = Array.from({ length: 14 }, () => ({ x: it.x0 + 3 + rand() * (it.x1 - it.x0 - 6), t0: 1.4 + rand() * 3.2, speed: 6 + rand() * 6 }));
    const drips = [0.22, 0.5, 0.78].map((fx, i) => ({ x: Math.round(it.x0 + fx * (it.x1 - it.x0)), t0: 1.9 + i * 0.45 }));
    const poolLevel = (ts) => (ts < 0.5 ? 0 : ts < 1.6 ? easeOut((ts - 0.5) / 1.1) : ts < 4.8 ? 1 : ts < 5.7 ? 1 - easeInOut((ts - 4.8) / 0.9) : 0) * 12;
    const inWin = (x, y) => x >= 0 && y >= 0 && x < W && y < H && it.mask[Math.round(y) * W + Math.round(x)];
    return (ctx, ts) => {
      // Slime on the frame breathes.
      const br = 0.18 + 0.18 * Math.sin(ts * Math.PI * 2 / 1.5);
      for (const c of slimeCells) ctx.lift(c.x, c.y, br, 0xd8ffb0);
      // Circuit pulses: three bright packets lapping the window.
      for (const c of circuit) for (let n = 0; n < 3; n++) {
        const head = ((ts / 2) + n / 3) % 1;
        const d = (((head - c.s) % 1) + 1) % 1;
        if (d < 0.035) ctx.paint(c.x, c.y, (p) => mix(p, d < 0.01 ? 0xeaffd0 : SLIME.light, 0.9));
      }
      // Slime pool along the bottom of the window.
      const lvl = poolLevel(ts);
      if (lvl > 0.5) for (let x = it.x0; x <= it.x1; x++) {
        const wave = Math.sin(x * 0.35 + ts * 5) * 1.1 + Math.sin(x * 0.13 - ts * 3) * 0.8;
        const top = Math.round(it.y1 - lvl + wave);
        for (let y = top; y <= it.y1; y++) {
          if (!inWin(x, y)) continue;
          const d = y - top;
          ctx.put(x, y, d === 0 ? SLIME.top : d === 1 ? SLIME.light : d < 4 ? SLIME.mid : (hash(x, y, Math.floor(ts * 4)) < 0.06 ? SLIME.mid : SLIME.deep));
        }
      }
      // Bubbles rise through the pool and pop above it.
      for (const b of bubbles) {
        const age = ts - b.t0;
        if (age < 0 || age > 1.2 || lvl < 3) continue;
        const y = it.y1 - 1 - age * b.speed;
        const surface = it.y1 - lvl;
        if (y > surface) { ctx.put(b.x, y, SLIME.top); ctx.put(b.x + 1, y, SLIME.light); }
        else if (y > surface - 3) ctx.sparkle(b.x, surface - 2, 1, STAR);
      }
      // Drips form under the top rail, fall, and splash into the pool.
      for (const d of drips) {
        const age = ts - d.t0;
        if (age < 0 || age > 1.3) continue;
        const y0 = it.y0 + 1;
        if (age < 0.5) { const len = Math.round(age / 0.5 * 4); for (let i = 0; i <= len; i++) ctx.put(d.x, y0 + i, i === len ? SLIME.top : SLIME.light); }
        else {
          const fall = (age - 0.5) / 0.6;
          const y = y0 + 4 + easeInOut(Math.min(1, fall)) * (it.y1 - lvl - y0 - 4);
          if (fall < 1) { ctx.put(d.x, y, SLIME.top); ctx.put(d.x, y - 1, SLIME.light); ctx.put(d.x, y + 1, SLIME.light); }
          else { const u = (age - 1.1) / 0.2, sy = it.y1 - lvl - 1; for (const dx of [-2, 2]) ctx.put(d.x + dx * (1 + u), sy - 2 * Math.sin(u * Math.PI), SLIME.top); }
        }
      }
      // Face blinks twice.
      for (const t0 of [0.9, 3.9]) if (ts >= t0 && ts < t0 + 0.18) { for (const e of eyes) ctx.paint(e.x, e.y, () => 0x58c43a); for (const e of eyes) ctx.put(e.x, e.y + 1, 0x16381a); }
      // Sheen runs down the stone, then stars.
      const sh = (ts - 3.0) / 0.8;
      if (sh >= 0 && sh < 1) { const y = -10 + easeInOut(sh) * (H + 20); for (const s of stone) { const d = Math.abs(s.y - y - (s.x < W / 2 ? s.x : W - s.x) * 0.6); if (d < 3) ctx.lift(s.x, s.y, 0.85); else if (d < 7) ctx.lift(s.x, s.y, 0.35); } }
      for (const [t0, x, y, size] of [[2.4, it.x0 - 2, 70, 5], [2.4, it.x1 + 2, 70, 5], [3.3, 44, 6, 6], [3.8, it.x0 - 1, it.y0 - 2, 4], [3.8, it.x1 + 1, it.y0 - 2, 4]]) {
        const u = (ts - t0) / 0.45;
        if (u >= 0 && u < 1) ctx.sparkle(x, y, [1, Math.ceil(size / 2), size, size, Math.ceil(size / 2), 1][Math.floor(u * 6)], STAR);
      }
      for (const c of slimeCells) if (hash(c.x, c.y, Math.floor(ts * 10)) < 0.008) ctx.sparkle(c.x, c.y, 0, STAR);
    };
  },
};
