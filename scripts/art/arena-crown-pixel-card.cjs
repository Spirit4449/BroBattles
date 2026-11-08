#!/usr/bin/env node
// Remakes the Crown of the Arena player card animation as true pixel art.
//
// The old animation was an AI video: soft, off-grid pixels and smooth glow
// effects. This traces the static card art onto a regular pixel grid, then
// draws every animation effect from code on that same grid, so each frame is
// made of whole art pixels. Encoding at an integer scale (SCALE video px per art
// px, a multiple of the 2x2 chroma block) keeps edges crisp and flat colour
// cheap to compress.
//
// Usage: node scripts/art/arena-crown-pixel-card.cjs            preview into output/pixel-cards/arena-crown
//        node scripts/art/arena-crown-pixel-card.cjs --install  also replace the installed card exports
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../..');
const ID = 'arena-crown';
const SOURCE = path.join(ROOT, `public/assets/player-cards/${ID}/${ID}.webp`);
const OUT = path.join(ROOT, 'output/pixel-cards', ID);
const INSTALL = process.argv.includes('--install');

// The source's AI pixel grid is irregular (~10 px, drifting), so resampling it
// to one fixed 88-wide grid doubles and drops lines. Tracing at twice that
// (B = 2 cells per art pixel) keeps the original's blocks faithfully; effects
// are then drawn in BxB blocks so they match the art's pixel size.
const B = 2;
const GRID_W = 88 * B; // trace cells across the card art
const SCALE = 2; // video px per trace cell (4 video px per art pixel)
const MARGIN_X = 12; // art px of room for effects around the card
const MARGIN_Y = 18;
const FPS = 24;
const SECONDS = 8;
const FRAMES = FPS * SECONDS;

// ---------- seeded random ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- palette ----------
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// Ramps built from the static art's own colours (k-means of the source), with
// one or two brighter steps above each for the animation's highlights.
const RAMPS = {
  ink: ['#060201', '#1a0c06'],
  gold: ['#452105', '#764a17', '#b4670f', '#e0931c', '#f8ca3a', '#ffe36e', '#f3f1af', '#fffbe0'],
  navy: ['#010614', '#030d2f', '#041144', '#021559', '#0f286a', '#073ea2', '#1d5cc4', '#3a80e6'],
  gem: ['#0a3f9a', '#0c74cc', '#16b6ed', '#62d6ff', '#b4efff', '#effcff'],
  steel: ['#5d6474', '#9aa2b2', '#d4d9e2', '#f6f8fb'],
  ice: ['#3d7fb8', '#74bde6', '#a9e5fa', '#dcf7ff', '#ffffff'],
  white: ['#ffffff'],
};
const PAL = [];
const RAMP_OF = [];
for (const [name, ramp] of Object.entries(RAMPS)) ramp.forEach((h, step) => { PAL.push(hex(h)); RAMP_OF.push({ name, step }); });
const idx = (name, step) => {
  const ramp = RAMPS[name];
  const s = Math.max(0, Math.min(ramp.length - 1, step));
  return PAL.findIndex((_, i) => RAMP_OF[i].name === name && RAMP_OF[i].step === s);
};
function nearest(r, g, b) {
  let best = 0, bd = Infinity;
  for (let k = 0; k < PAL.length; k++) {
    if (RAMP_OF[k].name === 'ice') continue; // animation-only colours
    const dr = PAL[k][0] - r, dg = PAL[k][1] - g, db = PAL[k][2] - b;
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// ---------- trace ----------
async function trace() {
  const { data, info } = await sharp(SOURCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const cell = info.width / GRID_W;
  const GH = Math.round(info.height / cell);
  const grid = new Int16Array(GRID_W * GH).fill(-1);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GRID_W; gx++) {
    const counts = new Map();
    let opaque = 0, total = 0;
    // Sample the cell's inner area so neighbouring source pixels do not vote.
    const x0 = Math.floor((gx + 0.2) * cell), x1 = Math.ceil((gx + 0.8) * cell);
    const y0 = Math.floor((gy + 0.2) * cell), y1 = Math.ceil((gy + 0.8) * cell);
    for (let y = y0; y < Math.min(y1, info.height); y++) for (let x = x0; x < Math.min(x1, info.width); x++) {
      const i = (y * info.width + x) * 4;
      total++;
      if (data[i + 3] < 128) continue;
      opaque++;
      const k = nearest(data[i], data[i + 1], data[i + 2]);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    if (!total || opaque * 2 < total) continue;
    let best = -1, bc = 0;
    for (const [k, c] of counts) if (c > bc) { bc = c; best = k; }
    grid[gy * GRID_W + gx] = best;
  }
  return { grid, W: GRID_W, H: GH };
}


// ---------- clean up the trace ----------
const rampName = (k) => (k < 0 ? null : RAMP_OF[k].name);
const rampStep = (k) => RAMP_OF[k].step;
function cleanup(grid, W, H) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : grid[y * W + x]);
  for (let pass = 0; pass < 2; pass++) {
    const next = grid.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = at(x, y);
      if (k < 0) continue;
      // Lone pixels: replace with the most common neighbour colour.
      const n4 = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
      if (!n4.includes(k)) {
        const counts = new Map();
        for (const n of n4) if (n >= 0) counts.set(n, (counts.get(n) || 0) + 1);
        let best = k, bc = 1;
        for (const [n, c] of counts) if (c > bc) { best = n; bc = c; }
        next[y * W + x] = best;
        continue;
      }
      // Speckled navy bands: settle each navy pixel to its 3x3 navy majority step.
      if (rampName(k) === 'navy' && rampStep(k) > 0) {
        const counts = new Map();
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const n = at(x + dx, y + dy);
          if (rampName(n) === 'navy' && rampStep(n) > 0) counts.set(n, (counts.get(n) || 0) + 1);
        }
        let best = k, bc = 0;
        for (const [n, c] of counts) if (c > bc) { best = n; bc = c; }
        next[y * W + x] = best;
      }
    }
    grid.set(next);
  }
  // A one-pixel ink outline wherever the art meets transparency.
  const next = grid.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = at(x, y);
    if (k < 0 || rampName(k) === 'ink') continue;
    if ([at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].some((n) => n < 0)) next[y * W + x] = idx('ink', 0);
  }
  grid.set(next);
}

// ---------- anchors ----------
function components(grid, W, H, test) {
  const seen = new Uint8Array(W * H), out = [];
  for (let i0 = 0; i0 < W * H; i0++) {
    if (seen[i0] || !test(grid[i0])) continue;
    const cells = [], q = [i0]; seen[i0] = 1;
    while (q.length) {
      const i = q.pop(); cells.push(i);
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, j = ny * W + nx;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[j] || !test(grid[j])) continue;
        seen[j] = 1; q.push(j);
      }
    }
    const cx = cells.reduce((s, i) => s + (i % W), 0) / cells.length;
    const cy = cells.reduce((s, i) => s + ((i / W) | 0), 0) / cells.length;
    out.push({ cells, cx, cy, size: cells.length });
  }
  return out;
}

// ---------- drawing helpers ----------
function makeFrame(CW, CH) { return new Int16Array(CW * CH).fill(-1); }
// Effects are placed in art pixels (CW x CH) and written as BxB trace cells.
function put(frame, CW, CH, x, y, k) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= CW || y >= CH) return;
  for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) frame[(y * B + dy) * CW * B + x * B + dx] = k;
}
// Pixel star: size 0 = one pixel, larger sizes grow the arms and add diagonals.
function sparkle(frame, CW, CH, x, y, size, tint = 'gem') {
  const W = idx('white', 0), hi = idx(tint, tint === 'gold' ? 6 : tint === 'ice' ? 3 : 4), mid = idx(tint, tint === 'gold' ? 5 : tint === 'ice' ? 2 : 3);
  put(frame, CW, CH, x, y, W);
  if (size <= 0) return;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let r = 1; r <= size; r++) put(frame, CW, CH, x + dx * r, y + dy * r, r === 1 ? W : r < size ? hi : mid);
  }
  if (size >= 3) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) put(frame, CW, CH, x + dx, y + dy, hi);
}
const smooth = (a, b, t) => { const u = Math.max(0, Math.min(1, (t - a) / (b - a))); return u * u * (3 - 2 * u); };
const windowed = (t, a, b) => t >= a && t < b ? (t - a) / (b - a) : -1;

// ---------- animation ----------
// Timeline (seconds, 8 s loop), following the old video's beats:
//  0.5-1.5  crown frosts to ice from the base up, then thaws
//  1.4-2.5  crown pulses bright and throws off a burst of gold sparks
//  2.2-3.4  a larger outline crown rises off it and fades
//  2.2-2.6  emblem flashes white
//  2.4-4.6  diamond and square rings pulse out of the emblem
//  3.2-4.4  star burst around the crown
//  3.8-4.6  shine sweep down the frame
//  4.0-6.0  sparkle storm around the whole frame
//  5.0-5.7  second, quicker crown frost
//  5.8-7.0  gems light up clockwise around the frame
//  always   gold dust, falling glitter and twinkles
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
function ringPoints(r, square) {
  // Walk the perimeter in order, so dithering by index thins every side evenly.
  const pts = [];
  const sides = square ? [[(d) => [d, -r]], [(d) => [r, d]], [(d) => [-d, r]], [(d) => [-r, -d]]] : null;
  if (square) for (const [fn] of sides) for (let d = -r; d < r; d++) pts.push(fn(d));
  else for (const fn of [(s) => [s, -r + s], (s) => [r - s, s], (s) => [-s, r - s], (s) => [-r + s, -s]]) for (let s = 0; s < r; s++) pts.push(fn(s));
  return pts;
}

function buildAnimation(base, FW, FH) {
  const W = FW / B, H = FH / B; // art pixels
  const CW = W + MARGIN_X * 2, CH = H + MARGIN_Y * 2;
  const ox = MARGIN_X, oy = MARGIN_Y;
  const cellAt = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : base[(y * B) * FW + x * B]);
  const opaque = (x, y) => { for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) if (base[(y * B + dy) * FW + x * B + dx] >= 0) return true; return false; };
  const isGem = (k) => k >= 0 && (rampName(k) === 'gem' || (rampName(k) === 'white'));
  const gems = components(base, FW, FH, isGem).filter((c) => c.size >= 3 * B * B)
    .map((c) => ({ ...c, cx: c.cx / B, cy: c.cy / B, size: c.size / (B * B) }));
  const crownGem = gems.filter((g) => g.cy < 30).sort((a, b) => b.size - a.size)[0];
  const emblemGem = gems.filter((g) => g.cy > H * 0.75 && Math.abs(g.cx - W / 2) < 6).sort((a, b) => b.size - a.size)[0];
  const chase = gems.filter((g) => g !== crownGem && g.size >= 5)
    .map((g) => ({ ...g, angle: (Math.atan2(g.cy - H / 2, g.cx - W / 2) + Math.PI * 2.5) % (Math.PI * 2) }))
    .sort((a, b) => a.angle - b.angle);

  // The crown: art pixels above its band, between the corner ornaments.
  const CROWN = { x0: 14, x1: W - 15, y1: 31 };
  const crownCells = [];
  for (let y = 0; y < CROWN.y1; y++) for (let x = CROWN.x0; x <= CROWN.x1; x++) if (opaque(x, y) && rampName(cellAt(x, y)) !== 'navy') crownCells.push([x, y]);
  const crownSet = new Set(crownCells.map(([x, y]) => y * W + x));
  const crownTop = Math.min(...crownCells.map((c) => c[1]));
  const crownCx = W / 2, crownBase = CROWN.y1;
  const crownOutline = crownCells.filter(([x, y]) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaque(x + dx, y + dy)) && y < CROWN.y1 - 3);
  // Card silhouette edge, for the sparkle storm.
  const edge = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaque(x + dx, y + dy))) edge.push([x, y]);

  // Ice colours by brightness, for the frost.
  const lum = (k) => PAL[k][0] * 0.3 + PAL[k][1] * 0.59 + PAL[k][2] * 0.11;
  const ice = (k) => {
    if (k < 0 || rampName(k) === 'ink') return k;
    const l = lum(k);
    return idx('ice', l < 70 ? 0 : l < 120 ? 1 : l < 165 ? 2 : l < 205 ? 3 : 4);
  };

  const rand = rng(1907);
  // Sparks thrown off the crown's top edge, outward from its base.
  const crownEdge = crownOutline.filter(([x, y]) => rampName(cellAt(x, y)) !== 'navy');
  const sparks = Array.from({ length: 70 }, (_, n) => {
    const [x, y] = crownEdge[Math.floor(rand() * crownEdge.length)];
    let dx = x - crownCx, dy = y - (crownBase + 8);
    const len = Math.hypot(dx, dy) || 1;
    const dist = 8 + rand() * 16;
    return { x, y, n, dx: (dx / len) * dist + (rand() - 0.5) * 4, dy: (dy / len) * dist - 2 - rand() * 4, delay: rand() * 0.4, big: rand() < 0.3 };
  });
  const burst = Array.from({ length: 22 }, () => ({
    x: crownCx + (rand() - 0.5) * 70, y: crownTop - 4 + (rand() - 0.3) * 24, t0: 3.2 + rand() * 1.0, size: 2 + Math.floor(rand() * 4), tint: rand() < 0.65 ? 'white' : 'ice',
  }));
  const storm = Array.from({ length: 72 }, () => {
    const [ex, ey] = edge[Math.floor(rand() * edge.length)];
    const out = rand() < 0.55 ? 1 + rand() * 5 : 0;
    const nx = ex < W / 2 ? -1 : 1;
    return { x: ex + nx * out, y: ey + (rand() - 0.5) * 4, t0: 4.0 + rand() * 1.9, size: 2 + Math.floor(rand() * 4), tint: rand() < 0.6 ? 'white' : rand() < 0.5 ? 'ice' : 'gold' };
  });
  const highlights = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = cellAt(x, y); if (rampName(k) === 'gold' && rampStep(k) >= 5) highlights.push([x, y]); }
  const twinkles = Array.from({ length: 16 }, () => {
    const [x, y] = highlights[Math.floor(rand() * highlights.length)];
    return { x, y, t0: rand() * SECONDS, len: 0.35 + rand() * 0.2, size: 1 + Math.floor(rand() * 2) };
  });
  const dust = Array.from({ length: 26 }, () => ({ x: rand() < 0.5 ? -2 - rand() * 9 : W + 1 + rand() * 9, y: rand() * (H + 24), speed: 2.5 + rand() * 4, t0: rand(), hi: rand() < 0.3 }));
  const glitter = Array.from({ length: 22 }, () => ({ x: 4 + rand() * (W - 8), t0: 5.6 + rand() * 1.8, speed: 9 + rand() * 8, life: 0.8 + rand() * 0.6, sway: rand() * 6 }));

  const frames = [];
  for (let f = 0; f < FRAMES; f++) {
    const ts = (f / FRAMES) * SECONDS;
    const win = (a, b) => (ts >= a && ts < b ? (ts - a) / (b - a) : -1);
    const frame = makeFrame(CW * B, CH * B);
    const art = base.slice();
    const lift = (i, by) => { const k = art[i]; if (k < 0) return; const n = rampName(k); if (n === 'ink') return; art[i] = idx(n === 'white' ? 'gem' : n, (n === 'white' ? 5 : rampStep(k)) + by); };
    const forCell = (x, y, fn) => { for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) fn((y * B + dy) * FW + x * B + dx); };

    // Frost: a front climbs the crown, holds, then thaws from the top down.
    for (const [a, b, hold] of [[0.5, 1.5, 0.35], [5.0, 5.7, 0.2]]) {
      const u = win(a, b);
      if (u < 0) continue;
      const span = crownBase - crownTop + 2;
      for (const [x, y] of crownCells) {
        const h = (crownBase - y) / span; // 0 at base, 1 at top
        const inF = (u / ((1 - hold) / 2)) > h;
        const out = u > (1 + hold) / 2 && (u - (1 + hold) / 2) / ((1 - hold) / 2) > 1 - h;
        if (inF && !out) forCell(x, y, (i) => { art[i] = ice(art[i]); });
        else if (inF && !out === false && Math.abs((u - (1 + hold) / 2) / ((1 - hold) / 2) - (1 - h)) < 0.08) forCell(x, y, (i) => lift(i, 2));
      }
    }
    // Shine sweep down the frame along a 2:1 pixel diagonal.
    const sweep = win(3.8, 4.6);
    if (sweep >= 0) {
      const p = -20 + easeInOut(sweep) * (2 * W + H + 40);
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
        const d = Math.abs(2 * Math.floor(x / B) + Math.floor(y / B) - p);
        if (d < 2) lift(y * FW + x, 2); else if (d < 5) lift(y * FW + x, 1);
      }
    }
    // Crown gem glows while the crown is whole and charged.
    const glow = win(2.4, 3.4);
    if (glow >= 0 && crownGem) for (const i of crownGem.cells) lift(i, glow < 0.6 ? 2 : 1);
    // Emblem flash.
    const flash = win(2.2, 2.6);
    if (flash >= 0 && emblemGem) {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.abs(x - emblemGem.cx) + Math.abs(y - emblemGem.cy);
        if (d <= (flash < 0.5 ? 7 : 5) && opaque(x, y)) forCell(x, y, (i) => { if (art[i] >= 0 && rampName(art[i]) !== 'ink') art[i] = flash < 0.5 ? idx('white', 0) : ice(art[i]); });
      }
    } else if (emblemGem && win(2.6, 3.2) >= 0) for (const i of emblemGem.cells) lift(i, 2);
    // Gem chase.
    const chaseW = win(5.8, 7.0);
    const chaseLit = [];
    if (chaseW >= 0) chase.forEach((g, n) => {
      const local = chaseW * (chase.length + 2) - n;
      if (local >= 0 && local < 2.2) { for (const i of g.cells) lift(i, local < 1 ? 2 : 1); chaseLit.push({ g, local }); }
    });

    // Crown energy: the crown stays whole and pulses brighter while gold sparks
    // burst off its surface and fade out.
    const burstW = win(1.4, 2.5);
    if (burstW >= 0) {
      const pulseBy = burstW < 0.15 ? 1 : burstW < 0.45 ? 2 : burstW < 0.7 ? 1 : 0;
      if (pulseBy) for (const [x, y] of crownCells) forCell(x, y, (i) => lift(i, pulseBy));
    }

    // Compose the card.
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const k = art[y * FW + x];
      if (k < 0) continue;
      frame[(y + oy * B) * CW * B + x + ox * B] = k;
    }
    if (burstW >= 0) for (const s of sparks) {
      const u = (burstW - s.delay) / 0.6;
      if (u < 0 || u >= 1) continue;
      const amt = easeOut(u);
      const x = s.x + s.dx * amt + ox, y = s.y + s.dy * amt + u * u * 3 + oy;
      if (u > 0.7 && (s.n + Math.floor(u * 20)) % 2) continue;
      const k = u < 0.3 ? idx('gold', 7) : u < 0.6 ? idx('gold', 6) : idx('gold', 4);
      // A short trail back toward the crown.
      put(frame, CW, CH, x - s.dx * 0.12, y - s.dy * 0.12, idx('gold', u < 0.5 ? 5 : 3));
      put(frame, CW, CH, x, y, k);
      if (s.big && u < 0.45) { put(frame, CW, CH, x + 1, y, idx('gold', 5)); put(frame, CW, CH, x, y + 1, idx('gold', 4)); put(frame, CW, CH, x + 1, y + 1, idx('gold', 3)); }
    }

    // Effects on top.
    for (const d of dust) {
      const age = ((ts / SECONDS - d.t0) % 1 + 1) % 1;
      const yy = (((d.y - age * SECONDS * d.speed) % (H + 24)) + H + 24) % (H + 24) - 12;
      const k = d.hi && Math.floor(age * 40) % 3 === 0 ? idx('gold', 6) : idx('gold', d.hi ? 4 : 3);
      put(frame, CW, CH, d.x + ox, yy + oy, k);
    }
    for (const g of glitter) {
      const age = ts - g.t0;
      if (age < 0 || age >= g.life) continue;
      const k = age / g.life < 0.5 ? idx('gold', 6) : idx('gold', 4);
      put(frame, CW, CH, g.x + Math.sin(age * 6 + g.sway) * 1.5 + ox, crownTop + age * g.speed * 4 + oy, k);
    }
    for (const tw of twinkles) {
      const age = ((ts - tw.t0) % SECONDS + SECONDS) % SECONDS;
      if (age >= tw.len) continue;
      const u = age / tw.len;
      sparkle(frame, CW, CH, tw.x + ox, tw.y + oy, u < 0.2 || u > 0.8 ? 0 : tw.size, 'gold');
    }
    const aura = win(2.2, 3.4);
    if (aura >= 0) {
      const sc = 1 + easeOut(aura) * 0.22, lift2 = easeOut(aura) * 12;
      const k = aura < 0.35 ? idx('gold', 7) : aura < 0.7 ? idx('gold', 5) : idx('gold', 4);
      crownOutline.forEach(([x, y], n) => {
        if (aura > 0.6 && n % 2) return;
        if (aura > 0.85 && n % 4) return;
        put(frame, CW, CH, crownCx + (x - crownCx) * sc + ox, crownBase + (y - crownBase) * sc - lift2 + oy, k);
      });
    }
    if (emblemGem) {
      // Four rings out of the emblem, alternating diamond and square.
      for (let n = 0; n < 5; n++) {
        const u = win(2.4 + n * 0.3, 2.4 + n * 0.3 + 1.3);
        if (u < 0) continue;
        const r = Math.round(4 + easeOut(u) * (30 + n * 3));
        const k = u < 0.25 ? idx('ice', 4) : u < 0.55 ? idx('ice', 3) : idx('gem', 3);
        const cx = Math.round(emblemGem.cx) + ox, cy = Math.round(emblemGem.cy) + oy;
        const square = n % 2 === 1;
        const pts = ringPoints(square ? Math.round(r * 0.75) : r, square);
        pts.forEach(([dx, dy], a) => {
          if (u > 0.6 && a % 2) return;
          if (u > 0.82 && a % 4) return;
          put(frame, CW, CH, cx + dx, cy + dy, k);
        });
        if (u < 0.4) for (const [dx, dy] of ringPoints(Math.max(1, (square ? Math.round(r * 0.75) : r) - 1), square)) put(frame, CW, CH, cx + dx, cy + dy, idx('gem', 3));
      }
      const fl = win(2.2, 2.7);
      if (fl >= 0) sparkle(frame, CW, CH, emblemGem.cx + ox, emblemGem.cy + oy, [2, 4, 6, 7, 6, 4, 3, 2, 1, 0][Math.floor(fl * 10)], 'ice');
    }
    const cg = win(2.45, 3.1);
    if (cg >= 0 && crownGem) sparkle(frame, CW, CH, crownGem.cx + ox, crownGem.cy + oy - 1, [1, 3, 5, 7, 8, 8, 7, 5, 3, 1][Math.floor(cg * 10)], 'ice');
    for (const list of [burst, storm]) for (const s of list) {
      const u = (ts - s.t0) / 0.35;
      if (u < 0 || u >= 1) continue;
      const size = Math.round(s.size * Math.sin(u * Math.PI));
      sparkle(frame, CW, CH, s.x + ox, s.y + oy, size, s.tint === 'white' ? 'ice' : s.tint);
    }
    for (const { g, local } of chaseLit) {
      const s = local < 0.4 ? 1 : local < 0.9 ? 3 : local < 1.5 ? 4 : local < 1.9 ? 2 : 0;
      sparkle(frame, CW, CH, g.cx + ox + 2, g.cy + oy - 2, s, 'ice');
    }
    frames.push(frame);
  }
  return { frames, CW: CW * B, CH: CH * B, anchors: { crownGem, emblemGem, chase: chase.length, gems: gems.length, crownCells: crownCells.length } };
}

function toRGBA(frame, CW, CH, scale) {
  const W = CW * scale, H = CH * scale, buf = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = frame[((y / scale) | 0) * CW + ((x / scale) | 0)];
    if (k < 0) continue;
    const c = PAL[k], o = (y * W + x) * 4;
    buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]; buf[o + 3] = 255;
  }
  return { buf, W, H };
}

async function writeFrames(frames, CW, CH, dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let f = 0; f < frames.length; f++) {
    const { buf, W, H } = toRGBA(frames[f], CW, CH, SCALE);
    await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(dir, `${String(f).padStart(3, '0')}.png`));
  }
}

function encode(dir, out, posterPng) {
  const webm = path.join(out, `${ID}-animated.webm`), mov = path.join(out, `${ID}-animated.mov`), poster = path.join(out, `${ID}-poster.webp`);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%03d.png'), '-an',
    '-vf', 'format=yuva420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(process.env.CRF || 40),
    '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-auto-alt-ref', '0', '-g', String(FRAMES), webm]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%03d.png'), '-an',
    '-vf', 'format=bgra', '-c:v', 'hevc_videotoolbox', '-allow_sw', '1', '-alpha_quality', '0.8',
    '-bf', '0', '-g', String(FRAMES), '-b:v', process.env.APPLE_BITRATE || '320k', '-tag:v', 'hvc1', '-movflags', '+faststart', mov]);
  // The poster is the bare card, without any effect pixels.
  execFileSync('cwebp', ['-quiet', '-lossless', '-z', '9', posterPng, '-o', poster]);
  return { webm, mov, poster };
}

// Opaque bounds of the bare card, in video px.
function cardBounds(base, FW, FH) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (base[y * FW + x] >= 0) {
    x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
  }
  return { x: (x0 + MARGIN_X * B) * SCALE, y: (y0 + MARGIN_Y * B) * SCALE, w: (x1 - x0 + 1) * SCALE, h: (y1 - y0 + 1) * SCALE };
}

function install(files, bounds, width, height) {
  const { stampPlayerCardVersions } = require('./player-card-versions.cjs');
  const dest = path.join(ROOT, 'public/assets/player-cards', ID);
  for (const file of Object.values(files)) fs.copyFileSync(file, path.join(dest, path.basename(file)));
  const catalogPath = path.join(ROOT, 'src/shared/catalogs/playerCardsCatalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const entry = catalog.cards.find((card) => card.id === ID);
  // The layout rectangle keeps the same padding around the art as the old
  // export did (old art bounds 45,91 310x601 inside a 35,85 330x634 viewport).
  const k = bounds.w / 310;
  entry.animationViewport = {
    width, height,
    x: Math.round(bounds.x - 10 * k), y: Math.round(bounds.y - 6 * k),
    w: Math.round(330 * k), h: Math.round(634 * k),
  };
  entry.battleViewport = { width, height, ...bounds };
  entry.animationBytes = fs.statSync(path.join(dest, `${ID}-animated.webm`)).size;
  entry.animationAppleBytes = fs.statSync(path.join(dest, `${ID}-animated.mov`)).size;
  stampPlayerCardVersions(entry);
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  console.log('installed', JSON.stringify({ animationViewport: entry.animationViewport, battleViewport: entry.battleViewport }));
}

if (require.main === module) (async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const { grid, W, H } = await trace();
  cleanup(grid, W, H);
  await renderGrid(grid, W, H, path.join(OUT, 'trace.png'), 8);
  const { frames, CW, CH, anchors } = buildAnimation(grid, W, H);
  console.log('canvas', CW, 'x', CH, 'art px ->', CW * SCALE, 'x', CH * SCALE, 'video px;', JSON.stringify({ ...anchors, crownGem: !!anchors.crownGem, emblemGem: !!anchors.emblemGem }));
  const dir = path.join(OUT, 'frames');
  await writeFrames(frames, CW, CH, dir);
  const bare = makeFrame(CW, CH);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) bare[(y + MARGIN_Y * B) * CW + x + MARGIN_X * B] = grid[y * W + x];
  const posterPng = path.join(OUT, 'poster.png');
  const { buf, W: PW, H: PH } = toRGBA(bare, CW, CH, SCALE);
  await sharp(buf, { raw: { width: PW, height: PH, channels: 4 } }).png().toFile(posterPng);
  const files = encode(dir, OUT, posterPng);
  for (const f of Object.values(files)) console.log(path.basename(f), fs.statSync(f).size);
  if (INSTALL) install(files, cardBounds(grid, W, H), CW * SCALE, CH * SCALE);
})();

async function renderGrid(grid, W, H, file, scale = SCALE) {
  const { buf } = toRGBA(grid, W, H, 1);
  await sharp(buf, { raw: { width: W, height: H, channels: 4 } }).resize(W * scale, H * scale, { kernel: 'nearest' }).png().toFile(file);
}
