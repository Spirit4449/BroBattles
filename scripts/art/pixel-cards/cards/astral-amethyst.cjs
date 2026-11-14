// Astral Amethyst: two comet shards orbit the card like a gyroscope, passing
// behind and in front of the frame. The frame's gems light up one by one and
// join into a constellation that climbs to the top crystal, starlight spirals
// into it, and it goes supernova: a starburst, a shockwave that rolls down the
// frame to the bottom crystal, and falling star dust. A shooting star crosses
// behind the card while a nebula shimmer circles the veins.
const { hue, lum, easeOut, clamp01 } = require('../lib.cjs');
const { hash, ahead } = require('./_common.cjs');
const STAR = { core: 0xffffff, hi: 0xf2d6ff, mid: 0xc06bff };
const CSTAR = { core: 0xffffff, hi: 0xd2fbff, mid: 0x5ff0ff };
const MAG_TRAIL = [0xffffff, 0xffffff, 0xf2b6ff, 0xf2b6ff, 0xe08bff, 0xc06bff, 0xc06bff, 0x9a5cf0, 0x8a2be2, 0x6a28b8, 0x5a2a9a, 0x4a2480];
const VIO_TRAIL = [0xffffff, 0xffffff, 0xfff0ff, 0xf2d6ff, 0xe6c8ff, 0xd2b0ff, 0xb890f0, 0x9a70e0, 0x7a50c0, 0x6040a0, 0x4a3080, 0x3a2468];
const CYN_TRAIL = [0xffffff, 0xffffff, 0xd2fbff, 0xbff8ff, 0x8ff4ff, 0x5ff0ff, 0x4fd2f0, 0x3fb0e8, 0x2a7fd8, 0x2a62c0, 0x28509a, 0x243f80];
const SECONDS = 6;

module.exports = {
  id: 'astral-amethyst',
  seconds: SECONDS,
  margin: { x: 20, y: 30 },
  effects(card, { rng }) {
    const { W, H, cell } = card;
    const TX = 45, TY = 11, BX = 45, BY = 156;
    const CX = 45, CY = 86;
    // Gems in constellation order: two branches climb from the bottom crystal.
    const G = {
      bot: [45, 156], bl: [9, 145], br: [81, 144], l: [9, 76], r: [81, 76], tl: [11, 15], tr: [80, 18], top: [45, 11],
    };
    const crystal = (k) => { if (k < 0 || lum(k) < 50) return false; const h = hue(k); return h.s > 0.3 && h.h > 245 && h.h < 325; };
    const gemCells = Object.fromEntries(Object.entries(G).map(([name, [gx, gy]]) => {
      const cells = [], rad = name === 'top' ? 10 : 7.5;
      for (let y = gy - 11; y <= gy + 11; y++) for (let x = gx - 11; x <= gx + 11; x++) if (Math.hypot(x - gx, y - gy) < rad && crystal(cell(x, y))) cells.push({ x, y });
      return [name, cells];
    }));
    // Frame pixels hugging each gem pick up its glow.
    const spill = Object.fromEntries(Object.entries(gemCells).map(([name, cells]) => {
      const own = new Set(cells.map((c) => c.x + ',' + c.y)), out = new Map();
      for (const c of cells) for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = c.x + dx, y = c.y + dy, key = x + ',' + y;
        if (own.has(key) || cell(x, y) < 0) continue;
        const d = Math.abs(dx) + Math.abs(dy);
        if (!out.has(key) || out.get(key).d > d) out.set(key, { x, y, d });
      }
      return [name, [...out.values()]];
    }));
    // Soft halo round the top crystal, shown only where the card is clear.
    const halo = [];
    for (let y = -14; y <= 14; y++) for (let x = -16; x <= 16; x++) { const d = Math.hypot(x, y * 1.15); if (d < 16) halo.push({ x: TX + x, y: TY + y - 2, d }); }
    const veins = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = cell(x, y);
      if (k < 0) continue;
      const h = hue(k);
      if (h.s > 0.5 && lum(k) > 90 && ((h.h > 170 && h.h < 200) || (h.h > 280 && h.h < 320))) veins.push({ x, y, s: card.perim(x, y), cyan: h.h < 200 });
    }
    const frame = card.frameCells.map(([x, y]) => ({ x, y, d: Math.hypot(x - TX, y - TY) }));
    // Constellation: [from, to, start time]; each hop draws in 0.3 s.
    const HOP = 0.3;
    const hops = [['bot', 'bl', 0.15], ['bot', 'br', 0.15], ['bl', 'l', 0.5], ['br', 'r', 0.5], ['l', 'tl', 0.85], ['r', 'tr', 0.85], ['tl', 'top', 1.2], ['tr', 'top', 1.2]];
    const lit = { bot: 0.1 };
    for (const [, to, t0] of hops) lit[to] = Math.min(lit[to] ?? Infinity, t0 + HOP);
    const SUPERNOVA = 2.9;

    const rand = rng(99);
    // Star periods divide the loop so it repeats without a pop.
    const field = Array.from({ length: 46 }, () => ({ x: -18 + rand() * (W + 36), y: -28 + rand() * (H + 56), t0: rand() * SECONDS, p: [1.5, 2, 3][Math.floor(rand() * 3)], big: rand() < 0.2 }));
    const motes = Array.from({ length: 30 }, () => ({ a: rand() * Math.PI * 2, r: 26 + rand() * 22, t0: 1.45 + rand() * 0.85, spin: 2 + rand() * 1.5 }));
    const dust = Array.from({ length: 150 }, () => {
      const a = rand() * Math.PI * 2, v = 22 + rand() * 105;
      return { vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.85, life: 1.2 + rand() * 1.6, big: rand() < 0.35, c: [0xffffff, 0xf2d6ff, 0xd2fbff, 0xe08bff, 0x8ff4ff][Math.floor(rand() * 5)], id: Math.floor(rand() * 1e6) };
    });
    // Crystal chunks thrown out by the blast; they shrink into dust.
    const chunks = Array.from({ length: 26 }, () => {
      const a = rand() * Math.PI * 2, v = 40 + rand() * 70;
      return { vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.8, size: rand() < 0.5 ? 3 : 2, c: [0xffffff, 0xf2b6ff, 0xbff8ff, 0xe08bff][Math.floor(rand() * 4)] };
    });
    // Three tilted orbits, like a gyroscope round the card, each with several shards.
    const TAU = Math.PI * 2;
    const orbits = [
      { tilt: 0.42, rx: 57, ry: 11, period: 3, dir: 1, phases: [0.6, 0.6 + TAU / 2], trail: MAG_TRAIL },
      { tilt: -0.42, rx: 57, ry: 11, period: 2, dir: -1, phases: [3.4, 3.4 + TAU / 2], trail: CYN_TRAIL },
      { tilt: 0.06, rx: 63, ry: 16, period: 6, dir: 1, phases: [1.8, 1.8 + TAU / 3, 1.8 + 2 * TAU / 3], trail: VIO_TRAIL },
    ];
    const orbitPoint = (o, th) => {
      const ex = Math.cos(th) * o.rx, ey = Math.sin(th) * o.ry;
      return [CX + ex * Math.cos(o.tilt) - ey * Math.sin(o.tilt), CY + ex * Math.sin(o.tilt) + ey * Math.cos(o.tilt), Math.sin(th) > 0];
    };

    return (ctx, ts, f) => {
      const draw = (front, x, y, c) => (front ? ctx.put(x, y, c) : ctx.behind(x, y, c));
      const sn = ts - SUPERNOVA;

      // Star field around the card.
      for (const s of field) {
        const ph = ((ts - s.t0) % s.p + s.p) % s.p / s.p;
        if (ph > 0.55) continue;
        const peak = ph > 0.15 && ph < 0.35;
        ctx.behind(s.x, s.y, peak ? 0xffffff : 0x9f7fd8);
        if (s.big && peak) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) ctx.behind(s.x + dx, s.y + dy, 0x8a6fd0);
      }

      // Orbit shards: the half behind the card is hidden by the frame.
      const shards = [];
      for (const o of orbits) {
        for (const phase of o.phases) {
          const th = o.dir * (ts / o.period) * TAU + phase;
          // A long comet tail, three pixels thick near the head, tapering.
          const n = o.trail.length * 3, step = 0.13 / (o.rx * 0.1);
          const last = o.trail.length - 1;
          for (let j = n - 1; j >= 0; j--) {
            const i = Math.floor(j / 3);
            const [x, y, front] = orbitPoint(o, th - o.dir * j * step);
            if (i > 8 && (j + f) % 2) continue;
            if (i < 8) draw(front, x, y + 1, o.trail[Math.min(last, i + 2)]);
            if (i < 4) draw(front, x, y - 1, o.trail[Math.min(last, i + 2)]);
            draw(front, x, y, o.trail[i]);
          }
          shards.push({ o, p: orbitPoint(o, th) });
        }
        // After the supernova both orbit paths flare into view, then thin out.
        const ring = (sn - 0.25) / 1.6;
        if (ring >= 0 && ring < 1) for (let k = 0; k < 160; k++) {
          if ((k + Math.floor(ts * 24 * o.dir)) % 3) continue;
          if (hash(k, o.period, 5) < ring) continue;
          const [x, y, front] = orbitPoint(o, (k / 160) * Math.PI * 2);
          draw(front, x, y, ring < 0.25 ? o.trail[2] : o.trail[6]);
        }
      }

      // Crystals glow: a halo behind the top one, light spilling onto the
      // frame round every gem, and a glint that sweeps across each.
      const breath = (Math.sin(ts * TAU / 1.5) + 1) / 2;
      const hr = 11 + breath * 4;
      for (const h of halo) {
        if (h.d > hr) continue;
        // Solid bands fading outward; only the rim is dithered.
        if (h.d > hr - 2 && (h.x + h.y) % 2) continue;
        ctx.behind(h.x, h.y, h.d < hr * 0.5 ? 0xb07af0 : h.d < hr - 4 ? 0x8a4fd8 : h.d < hr - 2 ? 0x6a34b8 : 0x4a2480);
      }
      for (const [name, cells] of Object.entries(gemCells)) {
        const top = name === 'top';
        const [gx, gy] = G[name];
        const base = top ? 0.22 + breath * 0.22 : 0.1 + breath * 0.15;
        for (const c of cells) ctx.lift(c.x, c.y, base, 0xffd6ff);
        for (const s of spill[name]) ctx.lift(s.x, s.y, (top ? 0.42 : 0.25) * (1 - (s.d - 1) / 4) * (0.6 + breath * 0.4), 0xc77dff);
        // Glint: a diagonal band of light sweeps across, staggered per gem.
        const gp = ((ts + gx * 0.013 + gy * 0.007) % 1.5) / 1.5;
        const line = (gx - 9) + (gy - 9) + gp * 40 - 20;
        if (gp < 0.5) for (const c of cells) { const d = Math.abs(c.x + c.y - line); if (d < 1.5) ctx.lift(c.x, c.y, d < 0.6 ? 0.85 : 0.5, 0xffffff); }
        if (top && gp > 0.35 && gp < 0.5) ctx.sparkle(gx + 2, gy - 6, 2, STAR);
      }
      // The nebula shimmer circles the veins once per loop.
      const band = ts / SECONDS;
      for (const v of veins) {
        const a = Math.min(ahead(v.s, band), ahead(v.s, band + 0.5));
        if (a < 0.1) ctx.lift(v.x, v.y, 0.55 * (1 - a / 0.1), a < 0.03 ? 0xffffff : v.cyan ? 0xbff8ff : 0xffc8ff);
      }

      // Constellation: gems light up and dotted star-lines join them, climbing.
      const fade = clamp01((ts - 2.55) / 0.5);
      if (ts < 3.1) {
        for (const [from, to, t0] of hops) {
          const u = clamp01((ts - t0) / HOP);
          if (u <= 0) continue;
          const [ax, ay] = G[from], [bx, by] = G[to];
          const ex = ax + (bx - ax) * u, ey = ay + (by - ay) * u;
          ctx.line(ax, ay, ex, ey, (n) => (hash(n, t0 * 10, 7) < fade ? -1 : n % 2 ? 0xf2d6ff : 0x7a4fc0));
          if (u < 1) ctx.sparkle(ex, ey, 1, STAR);
        }
        for (const [name, t] of Object.entries(lit)) {
          const u = ts - t;
          if (u < 0 || fade >= 1) continue;
          const [gx, gy] = G[name];
          for (const c of gemCells[name]) ctx.lift(c.x, c.y, (u < 0.2 ? 0.75 : 0.35) * (1 - fade), 0xffe6ff);
          if (u < 0.3) ctx.sparkle(gx, gy, [2, 4, 5, 3, 2][Math.floor(u / 0.3 * 5)], name === 'top' ? STAR : CSTAR);
          else if (hash(gx, gy, Math.floor(ts * 6)) < 0.5 * (1 - fade)) ctx.sparkle(gx, gy, 1, STAR);
        }
      }

      // Starlight spirals into the top crystal.
      for (const m of motes) {
        const u = (ts - m.t0) / 0.6;
        if (u < 0 || u >= 1) continue;
        const r = m.r * (1 - u * u), a = m.a + u * u * m.spin;
        const r2 = m.r * (1 - Math.max(0, u - 0.08) ** 2), a2 = m.a + Math.max(0, u - 0.08) ** 2 * m.spin;
        ctx.put(TX + Math.cos(a2) * r2, TY + Math.sin(a2) * r2 * 0.8, 0x9a5cf0);
        ctx.put(TX + Math.cos(a) * r, TY + Math.sin(a) * r * 0.8, u > 0.6 ? 0xffffff : 0xf2d6ff);
      }
      const charge = clamp01((ts - 1.5) / (SUPERNOVA - 1.5));
      if (charge > 0 && sn < 0) {
        const flick = ts > 2.55 ? (f % 2 ? 0.95 : 0.55) : 0.2 + charge * 0.5;
        for (const c of gemCells.top) ctx.lift(c.x, c.y, flick, 0xfff0ff);
        ctx.sparkle(TX, TY, Math.floor(1 + charge * 4), STAR);
        // Implosion ring just before it blows.
        const im = (ts - 2.55) / (SUPERNOVA - 2.55);
        if (im >= 0) { ctx.ring(TX, TY, 2 + (1 - im) * 22, 0xf2d6ff, { dither: 1 }); ctx.ring(TX, TY, 2 + (1 - im) * 14, 0x5ff0ff, { dither: 2 }); }
      }

      // Supernova.
      if (sn >= 0 && sn < 0.3) for (const c of frame) ctx.lift(c.x, c.y, 0.32 * (1 - sn / 0.3), 0xf6e6ff);
      if (sn >= 0 && sn < 0.35) {
        // White-hot core.
        const u = sn / 0.35, R0 = 3 + easeOut(u) * 6 - u * u * 6;
        for (let y = -10; y <= 10; y++) for (let x = -10; x <= 10; x++) {
          const d = Math.hypot(x, y);
          if (d > R0) continue;
          ctx.put(TX + x, TY + y, d < R0 * 0.5 ? 0xffffff : d < R0 * 0.8 ? 0xf2d6ff : (x + y) % 2 ? 0xc06bff : -1);
        }
      }
      if (sn >= 0 && sn < 0.75) {
        const u = sn / 0.75;
        const grow = easeOut(clamp01(u / 0.2));
        const tail = clamp01((u - 0.25) / 0.75);
        for (const [dx, dy, len] of [[1, 0, 46], [-1, 0, 46], [0, 1, 54], [0, -1, 40], [1, 1, 24], [-1, 1, 24], [1, -1, 20], [-1, -1, 20]]) {
          const L = len * grow, start = len * tail;
          for (let i = Math.floor(start); i <= L; i++) {
            const t = i / len;
            if (t > 0.7 && i % 2) continue;
            const c = t < 0.25 ? 0xffffff : t < 0.55 ? 0xf2d6ff : t < 0.8 ? 0xc06bff : 0x8a2be2;
            ctx.put(TX + dx * i, TY + dy * i, c);
            if (!dx || !dy) {
              if (t < 0.6 && i > 2) for (const s of [-1, 1]) ctx.put(TX + dx * i + dy * s, TY + dy * i + dx * s, t < 0.3 ? 0xf2d6ff : 0x9a5cf0);
              if (t < 0.3 && i > 4) for (const s of [-2, 2]) ctx.put(TX + dx * i + dy * s, TY + dy * i + dx * s, 0x8a2be2);
            } else if (t < 0.5 && i > 1) { ctx.put(TX + dx * i + dx, TY + dy * i, 0xc06bff); ctx.put(TX + dx * i, TY + dy * i + dy, 0xc06bff); }
          }
        }
        // Thinner rays between the main ones.
        for (let k = 0; k < 8; k++) {
          const a = (k + 0.5) * TAU / 8 + 0.12, len = 30 + (k % 3) * 6;
          const L = len * grow, start = len * tail;
          for (let i = Math.floor(start); i <= L; i += 1) {
            const t = i / len;
            if (t > 0.5 && i % 2) continue;
            ctx.put(TX + Math.cos(a) * i, TY + Math.sin(a) * i, t < 0.3 ? 0xf2d6ff : t < 0.65 ? 0xc06bff : 0x5ff0ff);
          }
        }
        if (u < 0.35) { ctx.sparkle(TX, TY, Math.round(12 - u * 20), STAR); for (let r = 0; r < 5 - u * 12; r++) ctx.ring(TX, TY, r, 0xffffff); }
      }
      if (sn >= 0 && sn < 0.9) {
        const u = sn / 0.9;
        const r1 = 3 + easeOut(u) * 58, r2 = 2 + easeOut(u) * 40;
        ctx.ring(TX, TY, r1, u < 0.3 ? 0xffffff : 0xe08bff, { dither: u > 0.6 ? 1 : 0 });
        if (u < 0.7) ctx.ring(TX, TY, r1 - 1, u < 0.3 ? 0xf2d6ff : 0xc06bff, { dither: u > 0.4 ? 1 : 0 });
        if (u < 0.45) ctx.ring(TX, TY, r1 - 2, 0x8a2be2, { dither: 1 });
        ctx.ring(TX, TY, r2, u < 0.3 ? 0xd2fbff : 0x5ff0ff, { shape: 'diamond', dither: u > 0.5 ? 1 : 0 });
        if (u < 0.55) ctx.ring(TX, TY, r2 - 1, 0x2a7fd8, { shape: 'diamond', dither: u > 0.3 ? 1 : 0 });
      }
      // The shockwave rolls down the frame to the bottom crystal.
      if (sn >= 0 && sn < 1.15) {
        const R = sn / 1.0 * 150;
        for (const c of frame) {
          const d = R - c.d;
          if (d < 0 || d >= 12) continue;
          ctx.lift(c.x, c.y, d < 2 ? 0.85 : d < 6 ? 0.5 : 0.28, d < 2 ? 0xffffff : d < 6 ? 0xe08bff : 0x5ff0ff);
        }
      }
      // Falling star dust.
      if (sn >= 0) for (const p of dust) {
        if (sn > p.life) continue;
        const k = 2.6, e = (1 - Math.exp(-k * sn)) / k;
        const x = TX + p.vx * e, y = TY + p.vy * e + 9 * sn * sn;
        const age = sn / p.life;
        if (age > 0.55 && hash(p.id, 0, Math.floor(sn * 10)) < (age - 0.55) * 2.2) continue;
        const tw = hash(p.id, 1, Math.floor(sn * 12)) < 0.25;
        ctx.put(x, y, tw ? 0xffffff : p.c);
        if (p.big && age < 0.6) { ctx.put(x + 1, y, p.c); ctx.put(x, y + 1, p.c); ctx.put(x + 1, y + 1, 0x9a5cf0); }
        if (age < 0.3) ctx.put(x - p.vx * 0.012, y - p.vy * 0.012, 0x9a5cf0);
      }
      // Crystal chunks fly out and shrink.
      if (sn >= 0 && sn < 0.9) for (const c of chunks) {
        const k = 3.2, e = (1 - Math.exp(-k * sn)) / k;
        const x = TX + c.vx * e, y = TY + c.vy * e + 8 * sn * sn;
        const sz = Math.max(0, c.size - Math.floor(sn / 0.25));
        for (let dy = 0; dy <= sz; dy++) for (let dx = 0; dx <= sz; dx++) {
          if (sz > 1 && ((dx === 0 || dx === sz) && (dy === 0 || dy === sz))) continue; // round the corners
          ctx.put(x + dx, y + dy, sz > 0 && (dx === sz || dy === sz) ? 0x8a2be2 : c.c);
        }
      }
      // The bottom crystal catches it.
      const bc = (ts - (SUPERNOVA + 0.95)) / 0.6;
      if (bc >= 0 && bc < 1) {
        for (const c of gemCells.bot) ctx.lift(c.x, c.y, 0.8 * (1 - bc), 0xe6fdff);
        ctx.sparkle(BX, BY, [3, 6, 7, 5, 3, 2][Math.floor(bc * 6)], CSTAR);
        ctx.ring(BX, BY, 2 + easeOut(bc) * 16, bc < 0.4 ? 0xd2fbff : 0x5ff0ff, { dither: bc > 0.5 ? 1 : 0 });
      }

      // A shooting star crosses behind the card.
      const sh = (ts - 4.75) / 0.55;
      if (sh >= 0 && sh < 1.3) {
        const x0 = 108, y0 = -24, x1 = -20, y1 = 52, len = Math.hypot(x1 - x0, y1 - y0);
        const ux = (x1 - x0) / len, uy = (y1 - y0) / len;
        const hx = x0 + (x1 - x0) * Math.min(sh, 1), hy = y0 + (y1 - y0) * Math.min(sh, 1);
        const tl = 34 * (sh < 1 ? 1 : 1 - (sh - 1) / 0.3);
        for (let i = 0; i < tl; i++) {
          if (i > 12 && i % 2) continue;
          const tc = CYN_TRAIL[Math.min(CYN_TRAIL.length - 1, Math.floor(i / 3))];
          ctx.behind(hx - ux * i, hy - uy * i, tc);
          if (i < 14) ctx.behind(hx - ux * i, hy - uy * i + 1, CYN_TRAIL[Math.min(CYN_TRAIL.length - 1, Math.floor(i / 3) + 2)]);
        }
        if (sh < 1) { ctx.behind(hx + 1, hy, 0xffffff); ctx.behind(hx, hy + 1, 0xffffff); ctx.behind(hx - 1, hy, 0xd2fbff); }
      }

      // Gems twinkle while the card settles.
      if (ts > 4.3 || ts < 0.1) {
        let i = 0;
        for (const [name, [gx, gy]] of Object.entries(G)) {
          i++;
          const slot = Math.floor(ts * 5);
          if (hash(i, slot, 3) > 0.16) continue;
          for (const c of gemCells[name]) ctx.lift(c.x, c.y, 0.35, 0xffe6ff);
          ctx.sparkle(gx + 2, gy - 2, (ts * 5 - slot) < 0.5 ? 2 : 1, i % 2 ? STAR : CSTAR);
        }
      }

      // Shard heads go on top; the front ones sparkle.
      for (const { o, p: [x, y, front] } of shards) {
        for (const [dx, dy] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) draw(front, x + dx, y + dy, o.trail[4]);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) draw(front, x + dx, y + dy, dx && dy ? o.trail[3] : o.trail[1]);
        draw(front, x, y, 0xffffff);
        if (front && (f + Math.round(x)) % 6 < 3) ctx.sparkle(x, y, 3, o.trail === CYN_TRAIL ? CSTAR : STAR);
      }
    };
  },
};
