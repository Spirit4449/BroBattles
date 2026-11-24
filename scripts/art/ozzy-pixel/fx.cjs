// Ozzy's painted effects: arcane magic in the violet palette the super's code
// effect used (characters/ozzy/superCast.js, since retired), cyan crystal shards and paper
// pages. Effects are painted on their own layer in rest-art coordinates,
// given a 1px outline where they meet empty space, then composited behind or
// in front of the posed figure.
const { render, CANVAS, SIZE } = require('./pose.cjs');

const MARGIN = (CANVAS - SIZE) / 2;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const FX = {
  o: hex(0x241046), // outline
  v: hex(0x4c1d95), // deep violet
  m: hex(0x7c3aed), // violet
  l: hex(0xa78bfa), // light violet
  p: hex(0xddd6fe), // pale
  w: hex(0xf5f3ff), // white
  c: hex(0x67e8f9), // crystal cyan
  C: hex(0x1f7f9c), // crystal shade
  k: hex(0x090b1b), // ink (page outline)
  q: hex(0xf1f2f2), // page
  Q: hex(0xb0adad), // page shade
};
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

// A layer of FX keys on a canvas of `size` (CANVAS unless an effect needs more).
function layer(size = CANVAS) {
  const keys = new Array(size * size).fill(null);
  const m = (size - SIZE) / 2;
  const set = (x, y, k) => {
    const X = Math.round(x + m); const Y = Math.round(y + m);
    if (X >= 0 && Y >= 0 && X < size && Y < size) keys[Y * size + X] = k;
  };
  const get = (x, y) => { const X = Math.round(x + m); const Y = Math.round(y + m); return X >= 0 && Y >= 0 && X < size && Y < size ? keys[Y * size + X] : null; };
  return { size, keys, set, get, outline: true };
}

// ---- shapes (all coordinates rest-art px) ----
function disc(L, [cx, cy], r, k) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) L.set(x, y, k);
  }
}
function line(L, [x0, y0], [x1, y1], k, w = 1) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 1;
  for (let i = 0; i <= n; i++) { const t = i / n; if (w <= 1) L.set(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), k); else disc(L, [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t], w / 2, k); }
}
// Glowing orb: white core, pale rim, violet swirl blotches turning with t.
function orb(L, c, r, t = 0, { swirl = true } = {}) {
  disc(L, c, r, 'l');
  disc(L, [c[0] - r * 0.08, c[1] - r * 0.08], r - 1, 'p');
  disc(L, [c[0] - r * 0.12, c[1] - r * 0.12], r - 2.2, 'w');
  if (!swirl || r < 5) return;
  for (let i = 0; i < 5; i++) {
    const a = t * 2 * Math.PI + i * 1.3 + hash(i) * 2; const d = r * (0.25 + 0.5 * hash(i + 9));
    const len = r * (0.35 + 0.3 * hash(i + 3));
    for (let s = 0; s < len; s += 0.5) {
      const aa = a + s / (r * 0.8);
      const p = [c[0] + Math.cos(aa) * d, c[1] + Math.sin(aa) * d * 0.8];
      disc(L, p, Math.max(0.6, (1 - s / len) * r * 0.13), s < len * 0.35 ? 'm' : 'l');
    }
  }
}
// Flickering magic flame licking off a point (staff crystal, palm).
function wisp(L, [x, y], t, size = 1, dir = [0.2, -1]) {
  for (let i = 0; i < 3; i++) {
    const ph = t * 2 * Math.PI + i * 2.1;
    const len = (3 + 2.5 * hash(i + Math.floor(t * 8))) * size;
    for (let s = 0; s <= len; s += 0.5) {
      const f = s / len;
      const px = x + dir[0] * s + Math.sin(ph + f * 3) * 1.4 * f * size + (i - 1) * 1.5 * size;
      const py = y + dir[1] * s;
      disc(L, [px, py], Math.max(0.5, (1 - f) * 1.4 * size), f < 0.3 ? 'p' : f < 0.7 ? 'l' : 'm');
    }
  }
}
function sparks(L, c, n, spread, seed, keys = ['l', 'm'], rise = 0) {
  for (let i = 0; i < n; i++) {
    const a = hash(seed + i) * 2 * Math.PI; const d = spread * (0.3 + 0.7 * hash(seed + i + 50));
    L.set(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d * 0.8 - rise * hash(seed + i + 7), keys[i % keys.length]);
  }
}
// The blast: a white cone with a ragged violet-edged front, from `at` to the right.
function blast(L, at, len, half, seed = 1) {
  for (let s = 0; s <= len; s += 0.5) {
    const f = s / len;
    const w = half * Math.sqrt(Math.min(1, f * 2.5)) * (f > 0.6 ? 1 - (f - 0.6) * 1.6 : 1) + (hash(Math.round(s) + seed) - 0.5) * 2;
    for (let dy = -w; dy <= w; dy += 0.5) {
      const ragged = f > 0.55 && hash(Math.round(dy) * 7 + seed) < (f - 0.55) * 2.2;
      if (!ragged) L.set(at[0] + s, at[1] + dy, Math.abs(dy) > w - 1.2 ? 'l' : 'w');
    }
  }
  for (let i = 0; i < 6; i++) { // flame tongues off the edges
    const s = len * (0.3 + 0.7 * hash(seed + i)); const side = i % 2 ? 1 : -1;
    line(L, [at[0] + s, at[1] + side * half * 0.8], [at[0] + s + 4, at[1] + side * (half + 2 + 2 * hash(i))], 'l');
  }
}
// Spent magic: broken violet curls drifting off to the right.
function smoke(L, c, t, spread = 10, seed = 3) {
  for (let i = 0; i < 9; i++) {
    const cx = c[0] + (hash(seed + i) - 0.3) * spread * 2 + t * 6; const cy = c[1] + (hash(seed + i + 20) - 0.5) * spread * 2 - t * 3;
    const r = 1.5 + 2.5 * hash(seed + i + 40); const a0 = hash(seed + i + 60) * 6;
    const keep = 1 - t * 0.7;
    for (let s = 0; s < 4 * keep; s += 0.4) {
      const a = a0 + s * 0.9; const rr = r * (1 - s / 6);
      disc(L, [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr], Math.max(0.5, 0.9 - s * 0.08), s < 1.2 ? 'l' : 'm');
    }
  }
}
// A crescent swoosh (the staff's swing), angles in degrees, clockwise from +x.
function arc(L, c, r, a0, a1, thick, k = 'w') {
  for (let a = a0; a <= a1; a += 0.5) {
    const f = (a - a0) / (a1 - a0); const th = thick * Math.sin(Math.PI * Math.min(1, f * 1.1));
    for (let d = -th / 2; d <= th / 2; d += 0.5) {
      const rad = (a * Math.PI) / 180;
      L.set(c[0] + Math.cos(rad) * (r + d), c[1] + Math.sin(rad) * (r + d), Math.abs(d) > th / 2 - 0.8 ? 'p' : k);
    }
  }
}
// A loose page, flipping: `turn` 0..1 squashes it edge-on.
function page(L, [x, y], turn = 0, tilt = 0) {
  const w = Math.max(1, Math.round(3 * Math.abs(Math.cos(turn * Math.PI)))); const h = 2;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) L.set(x + i + Math.round(tilt * j), y + j, j ? 'Q' : 'q');
}

// Speed lines trailing a dash: short streaks behind `c`, opposite `dir`.
function speedLines(L, c, dir, count, len, seed = 0) {
  const [dx, dy] = dir; const nx = -dy; const ny = dx; // across the dash
  for (let i = 0; i < count; i++) {
    const off = (hash(seed * 13 + i) - 0.5) * 26; const back = 6 + hash(seed * 7 + i + 3) * 10;
    const l = len * (0.5 + 0.5 * hash(seed + i + 11));
    const x0 = c[0] - dx * back + nx * off; const y0 = c[1] - dy * back + ny * off;
    line(L, [x0, y0], [x0 - dx * l, y0 - dy * l], i % 2 ? 'p' : 'l');
  }
}

// Outline a layer: an `o` (violet ink) pixel wherever an effect meets empty
// space; pages and shards get ink.
function outlineLayer(L) {
  const { size, keys } = L; const add = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (keys[y * size + x]) continue;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const k = keys[(y + dy) * size + x + dx];
      if (x + dx >= 0 && x + dx < size && y + dy >= 0 && y + dy < size && k && k !== 'o' && k !== 'k') { add.push([y * size + x, /[qQcC]/.test(k) ? 'k' : 'o']); break; }
    }
  }
  for (const [i, k] of add) keys[i] = k;
}

// Composite: behind effects, the posed figure, front effects, on a canvas of
// `size` (>= CANVAS, figure centred).
function drawFrame(pose, { behind, front, size = CANVAS, patch = false, outline = true } = {}) {
  const base = render(pose, { patch });
  const out = Buffer.alloc(size * size * 4);
  const off = (size - CANVAS) / 2;
  const paint = (fn) => {
    if (!fn) return;
    const L = layer(size); fn(L, pose.$);
    if (outline) outlineLayer(L);
    L.keys.forEach((k, i) => { if (k) { out.set(FX[k], i * 4); out[i * 4 + 3] = 255; } });
  };
  paint(behind);
  for (let y = 0; y < CANVAS; y++) for (let x = 0; x < CANVAS; x++) {
    const s = (y * CANVAS + x) * 4;
    if (base[s + 3]) base.copy(out, ((y + off) * size + x + off) * 4, s, s + 4);
  }
  paint(front);
  out.$ = pose.$;
  return out;
}

module.exports = { FX, MARGIN, drawFrame, layer, disc, line, orb, wisp, sparks, blast, smoke, arc, page, speedLines, hash };
