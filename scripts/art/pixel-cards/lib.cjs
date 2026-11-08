// Shared toolkit for remaking player card animations as true pixel art.
// See scripts/art/arena-crown-pixel-card.cjs for the first card made this way.
//
// Each card traces its static art onto a regular grid (B trace cells per art
// pixel, so the AI source's uneven ~10 px pixels survive), then a per-card
// effect script draws every frame in whole art pixels. Frames are encoded at
// SCALE video px per trace cell, so every art pixel is a crisp 4x4 block.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../../..');
const B = 2;
const SCALE = 2;
const FPS = 24;
const SOURCE_PIXEL = 10.05; // source px per art pixel in the AI card art

// ---------- colour ----------
const rgb = (h) => (typeof h === 'number' ? h : parseInt(h.replace('#', ''), 16));
const R = (c) => (c >> 16) & 255, G = (c) => (c >> 8) & 255, Bl = (c) => c & 255;
const pack = (r, g, b) => (Math.max(0, Math.min(255, Math.round(r))) << 16) | (Math.max(0, Math.min(255, Math.round(g))) << 8) | Math.max(0, Math.min(255, Math.round(b)));
const mix = (a, b, t) => pack(R(a) + (R(b) - R(a)) * t, G(a) + (G(b) - G(a)) * t, Bl(a) + (Bl(b) - Bl(a)) * t);
const lum = (c) => R(c) * 0.3 + G(c) * 0.59 + Bl(c) * 0.11;
const WHITE = 0xffffff;

// ---------- seeded random ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const easeOut = (u) => 1 - (1 - u) ** 3;
const easeInOut = (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
const clamp01 = (u) => Math.max(0, Math.min(1, u));

// ---------- trace ----------
function kmeans(pts, K, seed = 7) {
  const rand = rng(seed);
  let c = Array.from({ length: K }, () => pts[Math.floor(rand() * pts.length)].slice());
  for (let it = 0; it < 18; it++) {
    const s = c.map(() => [0, 0, 0, 0]);
    for (const p of pts) {
      let b = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = (p[0] - c[k][0]) ** 2 + (p[1] - c[k][1]) ** 2 + (p[2] - c[k][2]) ** 2; if (d < bd) { bd = d; b = k; } }
      s[b][0] += p[0]; s[b][1] += p[1]; s[b][2] += p[2]; s[b][3]++;
    }
    c = s.map((v, k) => (v[3] ? [v[0] / v[3], v[1] / v[3], v[2] / v[3]] : c[k]));
  }
  return c.map((v) => pack(v[0], v[1], v[2]));
}

async function traceArt(file, { colors = 40 } = {}) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pts = [];
  for (let i = 0; i < data.length; i += 4 * 5) if (data[i + 3] > 200) pts.push([data[i], data[i + 1], data[i + 2]]);
  const pal = kmeans(pts, colors);
  const near = new Map();
  const nearest = (r, g, b) => {
    const key = (r >> 2 << 12) | (g >> 2 << 6) | (b >> 2);
    if (near.has(key)) return near.get(key);
    let best = 0, bd = Infinity;
    for (let k = 0; k < pal.length; k++) { const d = (R(pal[k]) - r) ** 2 * 0.3 + (G(pal[k]) - g) ** 2 * 0.59 + (Bl(pal[k]) - b) ** 2 * 0.11; if (d < bd) { bd = d; best = k; } }
    near.set(key, pal[best]);
    return pal[best];
  };
  const W = Math.round(info.width / SOURCE_PIXEL);
  const FW = W * B;
  const cell = info.width / FW;
  const FH = Math.round(info.height / cell);
  const grid = new Int32Array(FW * FH).fill(-1);
  for (let gy = 0; gy < FH; gy++) for (let gx = 0; gx < FW; gx++) {
    const counts = new Map();
    let opaque = 0, total = 0;
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
    grid[gy * FW + gx] = best;
  }
  cleanup(grid, FW, FH);
  if (FH % B) throw new Error(`trace height ${FH} is not a multiple of ${B}`);
  return { grid, FW, FH };
}

function cleanup(grid, W, H) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : grid[y * W + x]);
  for (let pass = 0; pass < 2; pass++) {
    const next = grid.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = at(x, y);
      if (k < 0) continue;
      const n4 = [at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)];
      if (n4.includes(k)) {
        // Settle near-identical shades (compression speckle) to the local majority.
        const counts = new Map();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const n = at(x + dx, y + dy); if (n >= 0) counts.set(n, (counts.get(n) || 0) + 1); }
        let best = k, bc = counts.get(k) || 0;
        for (const [n, c] of counts) if (c > bc + 2 && Math.abs(lum(n) - lum(k)) < 14) { best = n; bc = c; }
        next[y * W + x] = best;
        continue;
      }
      const counts = new Map();
      for (const n of n4) if (n >= 0) counts.set(n, (counts.get(n) || 0) + 1);
      let best = k, bc = 1;
      for (const [n, c] of counts) if (c > bc) { best = n; bc = c; }
      next[y * W + x] = best;
    }
    grid.set(next);
  }
  // A dark outline wherever the art meets transparency (removes light AA fringe).
  let ink = -1, il = Infinity;
  const seen = new Map();
  for (const k of grid) if (k >= 0) seen.set(k, (seen.get(k) || 0) + 1);
  for (const [k, c] of seen) if (c > 50 && lum(k) < il) { il = lum(k); ink = k; }
  const next = grid.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = at(x, y);
    if (k < 0 || lum(k) < 50) continue;
    if ([at(x + 1, y), at(x - 1, y), at(x, y + 1), at(x, y - 1)].some((n) => n < 0)) next[y * W + x] = ink;
  }
  grid.set(next);
}

// ---------- card model ----------
async function loadCard(id, { margin = { x: 14, y: 20 }, colors } = {}) {
  const file = path.join(ROOT, `public/assets/player-cards/${id}/${id}.webp`);
  const { grid, FW, FH } = await traceArt(file, { colors });
  const W = FW / B, H = FH / B;
  const CW = W + margin.x * 2, CH = H + margin.y * 2;
  const cell = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? -1 : grid[(y * B) * FW + x * B]);
  const opaque = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) if (grid[(y * B + dy) * FW + x * B + dx] >= 0) return true;
    return false;
  };
  const card = { id, grid, FW, FH, W, H, CW, CH, margin, cell, opaque };
  card.interior = findInterior(card);
  // Outer edge of the frame, measured along the window's middle row and column.
  {
    const my = Math.round((card.interior.y0 + card.interior.y1) / 2), mx = Math.round((card.interior.x0 + card.interior.x1) / 2);
    let l = 0, r = W - 1, t = 0, b = H - 1;
    while (l < W && !opaque(l, my)) l++;
    while (r > 0 && !opaque(r, my)) r--;
    while (t < H && !opaque(mx, t)) t++;
    while (b > 0 && !opaque(mx, b)) b--;
    card.outer = { x0: l, y0: t, x1: r, y1: b };
  }
  card.edge = [];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => !opaque(x + dx, y + dy))) card.edge.push([x, y]);
  // Position of any art pixel around the window, 0..1 clockwise from top-left.
  card.perim = (x, y) => perimeterParam(card.interior, x, y);
  card.frameCells = [];
  const it = card.interior;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (opaque(x, y) && !it.mask[y * W + x]) card.frameCells.push([x, y]);
  return card;
}

// The dark window in the middle of the card (the flood from its centre).
function findInterior(card) {
  const { W, H, cell } = card;
  const mask = new Uint8Array(W * H);
  const dark1 = (x, y) => { const k = cell(x, y); return k >= 0 && lum(k) < 34; };
  // Flood only through solidly dark areas, so it cannot leak out through a
  // one-pixel gap in the rails into the dark outline; widen by one afterwards.
  const dark = (x, y) => { for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!dark1(x + dx, y + dy)) return false; return true; };
  const q = [[Math.floor(W / 2), Math.floor(H / 2)]];
  mask[q[0][1] * W + q[0][0]] = 1;
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  while (q.length) {
    const [x, y] = q.pop();
    x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || mask[ny * W + nx] || !dark(nx, ny)) continue;
      mask[ny * W + nx] = 1; q.push([nx, ny]);
    }
  }
  const grown = mask.slice();
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < W && ny < H && dark1(nx, ny)) grown[ny * W + nx] = 1;
  }
  return { mask: grown, x0: x0 - 1, y0: y0 - 1, x1: x1 + 1, y1: y1 + 1 };
}

function perimeterParam(r, x, y) {
  const w = r.x1 - r.x0, h = r.y1 - r.y0, L = 2 * (w + h);
  let px = Math.max(r.x0, Math.min(r.x1, x)), py = Math.max(r.y0, Math.min(r.y1, y));
  if (px > r.x0 && px < r.x1 && py > r.y0 && py < r.y1) {
    const d = [py - r.y0, r.x1 - px, r.y1 - py, px - r.x0], m = Math.min(...d);
    if (m === d[0]) py = r.y0; else if (m === d[1]) px = r.x1; else if (m === d[2]) py = r.y1; else px = r.x0;
  }
  let d;
  if (py === r.y0 && px < r.x1) d = px - r.x0;
  else if (px === r.x1 && py < r.y1) d = w + (py - r.y0);
  else if (py === r.y1 && px > r.x0) d = w + h + (r.x1 - px);
  else d = 2 * w + h + (r.y1 - py);
  return d / L;
}

// A closed path around a rectangle (art px), starting top-left, clockwise.
// `inset` < 0 moves it outward. Returns point(s) for s in [0,1) and its length.
function rectPath(r, inset = 0) {
  const x0 = r.x0 + inset, y0 = r.y0 + inset, x1 = r.x1 - inset, y1 = r.y1 - inset;
  const w = x1 - x0, h = y1 - y0, L = 2 * (w + h);
  const point = (s) => {
    let d = (((s % 1) + 1) % 1) * L;
    if (d < w) return [x0 + d, y0];
    d -= w; if (d < h) return [x1, y0 + d];
    d -= h; if (d < w) return [x1 - d, y1];
    d -= w; return [x0, y1 - d];
  };
  return { point, length: L, x0, y0, x1, y1 };
}

// Connected groups of art pixels matching a colour test.
function components(card, test, minSize = 3) {
  const { W, H, cell } = card;
  const seen = new Uint8Array(W * H), out = [];
  for (let y0 = 0; y0 < H; y0++) for (let x0 = 0; x0 < W; x0++) {
    const i0 = y0 * W + x0;
    if (seen[i0] || !test(cell(x0, y0))) continue;
    const cells = [], q = [[x0, y0]]; seen[i0] = 1;
    while (q.length) {
      const [x, y] = q.pop(); cells.push([x, y]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H || seen[ny * W + nx] || !test(cell(nx, ny))) continue;
        seen[ny * W + nx] = 1; q.push([nx, ny]);
      }
    }
    if (cells.length < minSize) continue;
    out.push({ cells, size: cells.length, cx: cells.reduce((s, c) => s + c[0], 0) / cells.length, cy: cells.reduce((s, c) => s + c[1], 0) / cells.length });
  }
  return out;
}
const hue = (c) => {
  const r = R(c) / 255, g = G(c) / 255, b = Bl(c) / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return { h: 0, s: 0, v: mx };
  let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: d / mx, v: mx };
};

// ---------- per-frame drawing context ----------
function makeContext(card) {
  const { grid, FW, FH, W, H, CW, CH, margin } = card;
  const art = grid.slice();
  const over = new Int32Array(CW * CH).fill(-1);
  const under = new Int32Array(CW * CH).fill(-1);
  const ctx = {
    art,
    // Recolour one art pixel of the card (all its trace cells).
    paint(x, y, fn) {
      x = Math.round(x); y = Math.round(y);
      if (x < 0 || y < 0 || x >= W || y >= H) return;
      for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) { const i = (y * B + dy) * FW + x * B + dx; if (art[i] >= 0) art[i] = fn(art[i]); }
    },
    lift(x, y, amount, tint = WHITE) { if (amount > 0) ctx.paint(x, y, (c) => (lum(c) < 18 ? c : mix(c, tint, amount))); },
    // Overlay pixel in card art coordinates (may sit in the margin).
    put(x, y, c) {
      x = Math.round(x) + margin.x; y = Math.round(y) + margin.y;
      if (x < 0 || y < 0 || x >= CW || y >= CH || c < 0) return;
      over[y * CW + x] = c;
    },
    // Only shows where the card is transparent (glow behind the frame).
    behind(x, y, c) {
      x = Math.round(x) + margin.x; y = Math.round(y) + margin.y;
      if (x < 0 || y < 0 || x >= CW || y >= CH) return;
      under[y * CW + x] = c;
    },
    line(x0, y0, x1, y1, c, every = 1) {
      x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
      const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
      let err = dx + dy, n = 0;
      for (;;) {
        if (n++ % every === 0) ctx.put(x0, y0, typeof c === 'function' ? c(n) : c);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) { err += dy; x0 += sx; }
        if (e2 <= dx) { err += dx; y0 += sy; }
      }
    },
    // Four-point pixel star. size 0 = one pixel.
    sparkle(x, y, size, { core = WHITE, hi = 0xdff4ff, mid = 0x8fc8ff } = {}) {
      if (size < 0) return;
      ctx.put(x, y, core);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let r = 1; r <= size; r++) ctx.put(x + dx * r, y + dy * r, r === 1 ? core : r < size ? hi : mid);
      if (size >= 3) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) ctx.put(x + dx, y + dy, hi);
    },
    ring(cx, cy, r, c, { shape = 'circle', dither = 0 } = {}) {
      const pts = ringPoints(Math.round(r), shape);
      pts.forEach(([dx, dy], n) => { if (dither && n % (dither + 1)) return; ctx.put(cx + dx, cy + dy, c); });
    },
    // Jagged pixel bolt between two points, displaced by midpoint subdivision.
    bolt(x0, y0, x1, y1, seed, { core = WHITE, glow = 0x6ec8ff, outer = -1, rough = 0.35, depth = 4 } = {}) {
      const rand = rng(seed);
      let pts = [[x0, y0], [x1, y1]];
      for (let d = 0; d < depth; d++) {
        const next = [pts[0]];
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
          const len = Math.hypot(bx - ax, by - ay);
          const off = (rand() - 0.5) * len * rough;
          const nx = -(by - ay) / (len || 1), ny = (bx - ax) / (len || 1);
          next.push([(ax + bx) / 2 + nx * off, (ay + by) / 2 + ny * off], pts[i]);
        }
        pts = next;
      }
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        if (outer >= 0) for (const [ox, oy] of [[2, 0], [-2, 0], [0, 2], [0, -2], [1, 1], [-1, -1]]) ctx.line(ax + ox, ay + oy, bx + ox, by + oy, outer, 2);
        if (glow >= 0) for (const [ox, oy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) ctx.line(ax + ox, ay + oy, bx + ox, by + oy, glow);
      }
      for (let i = 1; i < pts.length; i++) ctx.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1], core);
      return pts;
    },
    compose() {
      const out = new Int32Array(CW * B * CH * B).fill(-1);
      const S = CW * B;
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (under[y * CW + x] >= 0) for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) out[(y * B + dy) * S + x * B + dx] = under[y * CW + x];
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const k = art[y * FW + x]; if (k >= 0) out[(y + margin.y * B) * S + x + margin.x * B] = k; }
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (over[y * CW + x] >= 0) for (let dy = 0; dy < B; dy++) for (let dx = 0; dx < B; dx++) out[(y * B + dy) * S + x * B + dx] = over[y * CW + x];
      return out;
    },
  };
  return ctx;
}

function ringPoints(r, shape) {
  const pts = [];
  if (shape === 'diamond') {
    for (const fn of [(s) => [s, -r + s], (s) => [r - s, s], (s) => [-s, r - s], (s) => [-r + s, -s]]) for (let s = 0; s < r; s++) pts.push(fn(s));
  } else if (shape === 'square') {
    for (const fn of [(d) => [d, -r], (d) => [r, d], (d) => [-d, r], (d) => [-r, -d]]) for (let d = -r; d < r; d++) pts.push(fn(d));
  } else {
    // Midpoint circle, ordered by angle so dithering thins it evenly.
    const set = new Map();
    let x = r, y = 0, err = 1 - r;
    while (x >= y) {
      for (const [a, b] of [[x, y], [y, x], [-y, x], [-x, y], [-x, -y], [-y, -x], [y, -x], [x, -y]]) set.set(`${a},${b}`, [a, b]);
      y++;
      if (err < 0) err += 2 * y + 1; else { x--; err += 2 * (y - x) + 1; }
    }
    pts.push(...[...set.values()].sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0])));
  }
  return pts;
}

// ---------- render, encode, install ----------
function bounds(card) {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  const { grid, FW, FH, margin } = card;
  for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) if (grid[y * FW + x] >= 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: (x0 + margin.x * B) * SCALE, y: (y0 + margin.y * B) * SCALE, w: (x1 - x0 + 1) * SCALE, h: (y1 - y0 + 1) * SCALE };
}

async function writePng(frame, CW, CH, file) {
  const w = CW * B * SCALE, h = CH * B * SCALE, S = CW * B, buf = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = frame[((y / SCALE) | 0) * S + ((x / SCALE) | 0)];
    if (c < 0) continue;
    const o = (y * w + x) * 4;
    buf[o] = R(c); buf[o + 1] = G(c); buf[o + 2] = Bl(c); buf[o + 3] = 255;
  }
  await sharp(buf, { raw: { width: w, height: h, channels: 4 } }).png().toFile(file);
}

async function build(spec, { install = false } = {}) {
  const card = await loadCard(spec.id, { margin: spec.margin, colors: spec.colors });
  const frames = Math.round(FPS * spec.seconds);
  const draw = spec.effects(card, { rng, frames, seconds: spec.seconds });
  const out = path.join(ROOT, 'output/pixel-cards', spec.id);
  const dir = path.join(out, 'frames');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (let f = 0; f < frames; f++) {
    const ctx = makeContext(card);
    draw(ctx, (f / frames) * spec.seconds, f);
    await writePng(ctx.compose(), card.CW, card.CH, path.join(dir, `${String(f).padStart(3, '0')}.png`));
  }
  const posterPng = path.join(out, 'poster.png');
  await writePng(makeContext(card).compose(), card.CW, card.CH, posterPng);
  const files = {
    webm: path.join(out, `${spec.id}-animated.webm`), mov: path.join(out, `${spec.id}-animated.mov`), poster: path.join(out, `${spec.id}-poster.webp`),
  };
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%03d.png'), '-an',
    '-vf', 'format=yuva420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', String(spec.crf ?? 40),
    '-deadline', 'good', '-cpu-used', '1', '-row-mt', '1', '-auto-alt-ref', '0', '-g', String(frames), files.webm]);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(FPS), '-i', path.join(dir, '%03d.png'), '-an',
    '-vf', 'format=bgra', '-c:v', 'hevc_videotoolbox', '-allow_sw', '1', '-alpha_quality', '0.8',
    '-bf', '0', '-g', String(frames), '-b:v', spec.appleBitrate || '320k', '-tag:v', 'hvc1', '-movflags', '+faststart', files.mov]);
  execFileSync('cwebp', ['-quiet', '-lossless', '-z', '9', posterPng, '-o', files.poster]);
  const sizes = Object.fromEntries(Object.entries(files).map(([k, f]) => [k, fs.statSync(f).size]));
  const width = card.CW * B * SCALE, height = card.CH * B * SCALE;
  if (install) await installCard(spec.id, files, bounds(card), width, height);
  return { card, sizes, width, height };
}

// Opaque bounds of an image buffer.
async function imageBounds(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = info.width, y0 = info.height, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) if (data[(y * info.width + x) * 4 + 3] > 127) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, width: info.width, height: info.height };
}

async function installCard(id, files, newBounds, width, height) {
  const { stampPlayerCardVersions } = require('../player-card-versions.cjs');
  const catalogPath = path.join(ROOT, 'src/shared/catalogs/playerCardsCatalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const committed = JSON.parse(execFileSync('git', ['show', 'HEAD:src/shared/catalogs/playerCardsCatalog.json'], { cwd: ROOT, encoding: 'utf8' }));
  const entry = catalog.cards.find((card) => card.id === id);
  const old = committed.cards.find((card) => card.id === id);
  // Keep the committed export's padding around the art, so the card's layout
  // size in every view is unchanged.
  const oldPoster = execFileSync('git', ['show', `HEAD:public/assets/player-cards/${id}/${id}-poster.webp`], { cwd: ROOT, maxBuffer: 1 << 26 });
  const ob = await imageBounds(oldPoster);
  const s = ob.width / old.animationViewport.width;
  const vp = old.animationViewport;
  const k = newBounds.w / ob.w;
  entry.animationViewport = {
    width, height,
    x: Math.round(newBounds.x + (vp.x * s - ob.x) * k), y: Math.round(newBounds.y + (vp.y * s - ob.y) * k),
    w: Math.round(vp.w * s * k), h: Math.round(vp.h * s * k),
  };
  entry.battleViewport = { width, height, ...newBounds };
  const dest = path.join(ROOT, 'public/assets/player-cards', id);
  for (const file of Object.values(files)) fs.copyFileSync(file, path.join(dest, path.basename(file)));
  entry.animationBytes = fs.statSync(files.webm).size;
  entry.animationAppleBytes = fs.statSync(files.mov).size;
  stampPlayerCardVersions(entry);
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
}

module.exports = { perimeterParam, B, FPS, WHITE, rgb, mix, lum, hue, pack, R, G, Bl, rng, easeOut, easeInOut, clamp01, rectPath, components, ringPoints, build, loadCard, makeContext };
