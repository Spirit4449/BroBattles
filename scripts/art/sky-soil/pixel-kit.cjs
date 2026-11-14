// Pixel-art drawing kit for Sky Soil's code-drawn parts: cumulus clouds, the
// animated cloud sea, waterfalls and soil islands, rasterised on a true grid
// with small hand-picked palettes and no anti-aliasing. Used by
// compose-backdrop.cjs and library-clouds.cjs.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const FULL_W = 1536, FULL_H = 1024;

// ---------------------------------------------------------------- utilities
const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Smooth 1D value noise in [-1, 1].
function noise1(seed, scale) {
  const r = rng(seed), table = Array.from({ length: 512 }, () => r() * 2 - 1);
  return x => {
    const p = x / scale, i = Math.floor(p), f = p - i, u = f * f * (3 - 2 * f);
    const a = table[((i % 512) + 512) % 512], b = table[(((i + 1) % 512) + 512) % 512];
    return a + (b - a) * u;
  };
}
function fbm(seed, scale, octaves = 3) {
  const layers = Array.from({ length: octaves }, (_, i) => noise1(seed + i * 101, scale / 2 ** i));
  return x => layers.reduce((sum, n, i) => sum + n(x) / 2 ** i, 0) / (2 - 2 ** (1 - octaves));
}
const BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]];
const bayer = (x, y) => (BAYER[y & 3][x & 3] + 0.5) / 16;

class Canvas {
  constructor(w, h) { this.w = w; this.h = h; this.d = new Uint8ClampedArray(w * h * 4); }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.w && y < this.h; }
  set(x, y, c) {
    x = Math.round(x); y = Math.round(y);
    if (!this.inside(x, y)) return;
    const i = (y * this.w + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = 255;
  }
  alpha(x, y) { return this.inside(x, y) ? this.d[(y * this.w + x) * 4 + 3] : 0; }
  rect(x, y, w, h, c) { for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c); }
  vline(x, y0, y1, c) { for (let y = Math.round(y0); y <= Math.round(y1); y++) this.set(x, y, c); }
  hline(x0, x1, y, c) { for (let x = Math.round(x0); x <= Math.round(x1); x++) this.set(x, y, c); }
  async save(file, scale, cropH) {
    const big = sharp(Buffer.from(this.d.buffer), { raw: { width: this.w, height: this.h, channels: 4 } })
      .resize(this.w * scale, this.h * scale, { kernel: 'nearest' });
    const buf = await big.raw().toBuffer();
    const h = Math.min(cropH ?? this.h * scale, this.h * scale);
    await sharp(buf, { raw: { width: this.w * scale, height: this.h * scale, channels: 4 } })
      .extract({ left: 0, top: 0, width: this.w * scale, height: h })
      .webp({ lossless: true, effort: 6 }).toFile(file);
  }
}

// --------------------------------------------------------------- palettes
const SKY_BANDS = ['#1993c4', '#1fa1cc', '#28aed3', '#34bad8', '#43c5db', '#57cfdd', '#6fd8dd', '#8ae0db', '#a6e8d8', '#c2eed4'].map(hex);
const SUN = { core: hex('#fffbe6'), ring: ['#fff3bf', '#ffe9a3', '#f5e8a6'].map(hex) };
const CLOUD = {
  rim: hex('#fffdf2'), light: hex('#fdf2d0'), mid: hex('#e4ecd6'), shade: hex('#b8dfd6'), deep: hex('#90c8cc'),
};
const WISP = [hex('#d9f6ee'), hex('#fff8dc')];

// Near soil island palette matches the main island's terracotta sandstone.
const NEAR = {
  grassHi: hex('#b5e35a'), grass: hex('#7cc43f'), grassMid: hex('#58a334'), grassDark: hex('#3c7b2e'),
  topsoil: hex('#6b3a25'),
  soil: ['#e7a05c', '#d4834a', '#c06c3c', '#a65833', '#8a462b', '#6d3624'].map(hex),
  rim: hex('#f6c37d'), shadow: hex('#57291e'), deep: hex('#3f1f1a'),
  root: hex('#5a3322'), rootHi: hex('#86513a'), vine: hex('#4f9a3a'), leaf: hex('#86c94a'),
  pine: [hex('#1f5341'), hex('#2a6a4b'), hex('#3d8656'), hex('#62a75d')], trunk: hex('#4b2c20'),
  flower: [hex('#ff8fb7'), hex('#ffe066'), hex('#ffffff')],
  blossom: [hex('#d9668e'), hex('#f48fb1'), hex('#ffc6d9')],
  water: [hex('#ffffff'), hex('#d4f6fb'), hex('#9be3f0'), hex('#5cc6df')],
};

// Distant palettes are the near palette pulled toward the horizon haze.
function hazed(pal, haze, t) {
  const h = hex(haze), f = c => mix(c, h, t);
  const out = {};
  for (const [k, v] of Object.entries(pal)) out[k] = Array.isArray(v[0]) ? v.map(f) : f(v);
  return out;
}

// ------------------------------------------------------------- primitives
// Cumulus puff with hard tonal bands; light comes from the upper right.
// Each lobe gets a lit crescent on its upper right and a shaded crescent on its
// lower left (the circle minus a shifted copy of itself), so overlapping lobes
// separate cleanly instead of reading as striped spheres.
function puff(cv, cx, cy, r, tones, opts = {}) {
  const { baseY = Infinity } = opts;
  const R = Math.ceil(r), rr = r * r + r * 0.6;
  const a = Math.max(1, r * 0.22), b = Math.max(1.5, r * 0.42);
  const out = (dx, dy, ox, oy) => (dx - ox) ** 2 + (dy - oy) ** 2 > rr;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    if (dx * dx + dy * dy > rr) continue;
    const y = cy + dy, x = cx + dx;
    if (y > baseY) continue;
    let c = tones.mid;
    if (out(dx, dy, a * 0.8, -b * 0.8)) c = tones.shade;
    if (out(dx, dy, a * 0.35, -b * 0.35) && dy > 0) c = tones.deep;
    if (out(dx, dy, -a, b)) c = tones.light;
    if (out(dx, dy, -a * 0.4, b * 0.4)) c = tones.rim;
    if (y >= baseY - 1) c = tones.deep;
    else if (y >= baseY - 3 && c !== tones.rim) c = tones.shade;
    cv.set(x, y, c);
  }
}

// A cumulus: puffs on a flat base, larger towards the middle, drawn back to front.
function cumulus(cv, seed, cx, baseY, width, height, tones) {
  const r = rng(seed), puffs = [];
  const n = Math.max(4, Math.round(width / 7));
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1) * 2 - 1;
    const hump = 1 - t * t;
    const rad = Math.max(3, height * (0.32 + 0.38 * hump) * (0.75 + r() * 0.5));
    puffs.push({ x: cx + t * width / 2 + (r() - 0.5) * 4, y: baseY - rad * 0.55 - hump * height * 0.45 * r(), r: rad });
  }
  for (let i = 0; i < Math.round(n / 2); i++) {
    const t = (r() * 2 - 1) * 0.6;
    const rad = height * (0.25 + r() * 0.2);
    puffs.push({ x: cx + t * width / 2, y: baseY - height * 0.75 - rad * 0.2, r: rad });
  }
  puffs.sort((a, b) => a.y - b.y);
  for (const p of puffs) puff(cv, Math.round(p.x), Math.round(p.y), p.r, tones, { baseY });
}

// Wind wisp: a thin tapered streak, lit on top.
function wisp(cv, x, y, len, c1, c2) {
  for (let i = 0; i < len; i++) {
    const t = i / len, thick = t < 0.15 || t > 0.8 ? 1 : 2;
    cv.set(x + i, y, c2);
    if (thick === 2) cv.set(x + i, y + 1, c1);
  }
}

function pine(cv, x, baseY, h, pal, seed) {
  const r = rng(seed), [dark, mid, light, hi] = pal.pine;
  cv.vline(x, baseY - 2, baseY, pal.trunk);
  const tiers = Math.max(2, Math.round(h / 5));
  for (let t = 0; t < tiers; t++) {
    const ty = baseY - 2 - t * (h - 3) / tiers;
    const half = Math.max(1, Math.round((tiers - t) * h / tiers / 2.6 + 0.5));
    for (let row = 0; row <= half + 1; row++) {
      const y = Math.round(ty - row * 1.1), w = Math.max(0, half - row);
      for (let dx = -w; dx <= w; dx++) {
        const c = dx < 0 ? dark : dx === w && w > 0 ? light : mid;
        cv.set(x + dx, y, row === 0 && dx < 0 ? dark : c);
      }
      if (w > 0 && r() < 0.35) cv.set(x + w, y, hi);
    }
  }
  cv.set(x, Math.round(baseY - h - 1), mid);
}

function blossom(cv, x, baseY, h, pal) {
  const [dark, mid, light] = pal.blossom, rad = Math.max(3, Math.round(h * 0.42));
  cv.vline(x, baseY - h + rad, baseY, pal.trunk);
  cv.set(x + 1, baseY - Math.round(h * 0.45), pal.trunk);
  for (const [ox, oy, k] of [[-rad * 0.6, 0.15, 0.8], [rad * 0.6, 0.1, 0.8], [0, -0.35, 1]]) {
    const cx = x + Math.round(ox), cy = baseY - h + rad + Math.round(oy * rad), rr = rad * k;
    for (let dy = -Math.ceil(rr); dy <= Math.ceil(rr); dy++) for (let dx = -Math.ceil(rr); dx <= Math.ceil(rr); dx++) {
      if (dx * dx + dy * dy > rr * rr + rr * 0.5) continue;
      const lit = dx * 0.6 - dy * 0.8 > rr * 0.35, shade = dx * 0.6 - dy * 0.8 < -rr * 0.45;
      cv.set(cx + dx, cy + dy, lit ? light : shade ? dark : mid);
    }
  }
}

function bird(cv, x, y, c) {
  cv.set(x - 2, y - 1, c); cv.set(x - 1, y, c); cv.set(x, y + 1, c); cv.set(x + 1, y, c); cv.set(x + 2, y - 1, c);
}

function bush(cv, x, baseY, w, pal) {
  for (let dx = -w; dx <= w; dx++) {
    const h = Math.round(Math.sqrt(1 - (dx / (w + 0.5)) ** 2) * (w * 0.8 + 1));
    for (let dy = 0; dy < h; dy++) {
      const c = dy === h - 1 && dx > -w / 3 ? pal.grassHi : dx > w / 3 ? pal.grass : dy < h / 2 ? pal.grassDark : pal.grassMid;
      cv.set(x + dx, baseY - dy, c);
    }
  }
}

function waterfall(cv, x, y0, y1, w, pal, seed, fadeLen = 14, mist = null) {
  const r = rng(seed), [white, foam, blue, deep] = pal.water;
  const streakOffset = Array.from({ length: w }, () => Math.floor(r() * 9));
  for (let y = y0; y <= y1; y++) {
    const fade = y > y1 - fadeLen ? (y - (y1 - fadeLen)) / fadeLen : 0;
    for (let i = 0; i < w; i++) {
      if (fade && bayer(x + i, y) < fade) continue;
      const s = (y + streakOffset[i]) % 9;
      let c = i === 0 ? deep : i === w - 1 ? white : s < 2 ? white : s < 5 ? foam : blue;
      if (y - y0 < 2) c = white;
      cv.set(x + i, y, c);
    }
  }
  if (mist) for (let k = 0; k < 4; k++) {
    const mx = x + w / 2 + (k - 1.5) * (w + 2), my = y1 - fadeLen * 0.4 + (k % 2) * 3;
    puff(cv, Math.round(mx), Math.round(my), 4 + w * 0.8 + (k % 2) * 2, { ...mist, deep: mist.shade });
  }
}

// ------------------------------------------------------------- islands
// A floating soil island: grassy plateau, terracotta strata tapering to a keel.
function island(cv, o) {
  const pal = o.pal, r = rng(o.seed);
  const half = o.width / 2, x0 = Math.round(o.cx - half), x1 = Math.round(o.cx + half);
  const topN = noise1(o.seed + 1, 9), botN = fbm(o.seed + 2, o.width / 5, 3), toothN = noise1(o.seed + 3, 2.2);
  const strataN = fbm(o.seed + 4, 38, 2);
  const top = [], bot = [];
  const lobeCount = o.lobes ?? 3;
  const lobes = Array.from({ length: lobeCount }, (_, k) => ({
    c: (lobeCount === 1 ? 0 : -0.55 + 1.1 * k / (lobeCount - 1)) * 0.85 + (r() - 0.5) * 0.2,
    w: 0.28 + r() * 0.16, h: k === Math.floor((o.lobes ?? 3) / 2) ? 1 : 0.62 + r() * 0.25,
  }));
  for (let x = x0; x <= x1; x++) {
    const t = (x - o.cx) / half;
    const shoulder = Math.abs(t) > 0.86 ? Math.round((Math.abs(t) - 0.86) * 14) : 0;
    top[x - x0] = o.top + Math.round(topN(x) * (o.bumps ?? 1.2)) + shoulder;
    const profile = lobes.reduce((m, l) => Math.max(m, l.h * Math.exp(-(((t - l.c) / l.w) ** 2))), 0)
      * Math.min(1, (1 - Math.abs(t)) * 5) + 0.18 * (1 - t * t);
    let depth = o.depth * Math.min(1, profile) * (0.9 + 0.12 * botN(x));
    if (profile > 0.3 && toothN(x) > 0.6) depth += Math.round((toothN(x) - 0.6) * o.depth * 0.35);
    bot[x - x0] = top[x - x0] + Math.max(3, Math.round(depth));
  }
  // Hold the underside in 2-pixel runs so it reads as stepped rock, not noise.
  for (let i = 1; i < bot.length; i += 2) bot[i] = bot[i - 1];
  const cols = x1 - x0;
  for (let i = 0; i <= cols; i++) {
    const x = x0 + i, yt = top[i], yb = bot[i];
    const leftEdge = i < 2 || top[i - 2] > yt + 1, rightEdge = i > cols - 2 || top[i + 2] > yt + 1;
    for (let y = yt; y <= yb; y++) {
      const fromTop = y - yt, fromBot = yb - y;
      let c;
      if (fromTop === 0) c = pal.grassHi;
      else if (fromTop <= 2) c = pal.grass;
      else if (fromTop === 3) c = pal.grassDark;
      else if (fromTop <= 5) c = pal.topsoil;
      else {
        const band = Math.floor((y - o.top + strataN(x) * 3) / (o.band ?? 5));
        c = pal.soil[Math.min(pal.soil.length - 1, Math.floor(band * 0.7) % 2 + Math.min(3, Math.floor(fromTop / ((o.depth || 20) / 4))))];
        // Sun from the upper right: lit right flank, shaded left flank and keel.
        const flankL = i, flankR = cols - i;
        if (flankR <= 1 || (bot[i + 2] !== undefined && bot[i + 2] < y && flankR < cols / 2)) c = pal.rim;
        if (flankL <= 1 || (bot[i - 2] !== undefined && bot[i - 2] < y && flankL < cols / 2)) c = pal.shadow;
        if (fromBot === 0) c = pal.deep;
        else if (fromBot === 1) c = pal.shadow;
        // Strata seam highlight.
        if ((y - o.top + Math.round(strataN(x) * 3)) % (o.band ?? 5) === 0 && fromBot > 2 && flankL > 1 && flankR > 1) c = mix(c, pal.rim, 0.45);
      }
      cv.set(x, y, c);
    }
    // Grass lip drips over the side and in short tufts along the face.
    if (leftEdge || rightEdge) for (let k = 1; k <= 3; k++) cv.set(x, yt + 3 + k, k === 3 ? pal.grassDark : pal.grassMid);
    if (r() < 0.22) cv.set(x, yt + 4, pal.grassMid);
    if (r() < 0.08) cv.set(x, yt + 5, pal.grassDark);
    if (r() < 0.25 && !leftEdge && !rightEdge) cv.set(x, yt - 1, r() < 0.5 ? pal.grass : pal.grassHi);
  }
  // Rounded stone slabs embedded in the soil.
  if (o.detail !== false) {
    for (let k = 0; k < cols / 9; k++) {
      const i = 3 + Math.floor(r() * (cols - 8)), w = 3 + Math.floor(r() * 4), h = 2 + Math.floor(r() * 2);
      const yt = top[i] + 8, yb = Math.min(bot[i], bot[Math.min(cols, i + w)]) - h - 3;
      if (yb - yt < 1) continue;
      const y = Math.round(yt + r() * (yb - yt)), x = x0 + i;
      for (let dy = 0; dy <= h; dy++) for (let dx = 0; dx < w; dx++) {
        if ((dy === 0 || dy === h) && (dx === 0 || dx === w - 1)) continue;
        cv.set(x + dx, y + dy, dy === 0 ? pal.rim : dy === h ? pal.soil[4] : dx === 0 ? pal.soil[2] : pal.soil[0]);
      }
      cv.hline(x + 1, x + w - 2, y + h + 1, pal.soil[5]);
    }
  }
  // Hanging roots and vines from the underside.
  const hangs = Math.round(cols / (o.hangEvery ?? 6));
  for (let k = 0; k < hangs; k++) {
    const i = Math.floor(r() * cols), xb = x0 + i, yb = bot[i];
    const t = Math.abs((xb - o.cx) / half);
    if (t > 0.85) continue;
    const vine = r() < 0.35;
    let x = xb, len = Math.round((3 + r() * (o.hangLen ?? 10)) * (1 - t * 0.6));
    for (let s = 1; s <= len; s++) {
      cv.set(x, yb + s, vine ? pal.vine : s % 4 === 1 ? pal.rootHi : pal.root);
      if (vine && s % 3 === 0) cv.set(x + (s % 6 === 0 ? 1 : -1), yb + s, pal.leaf);
      if (!vine && r() < 0.18) x += r() < 0.5 ? -1 : 1;
    }
  }
  return { top: x => top[Math.round(x) - x0] ?? null, bot: x => bot[Math.round(x) - x0] ?? null, x0, x1 };
}

function decorate(cv, isle, o) {
  const r = rng(o.seed + 99), pal = o.pal;
  const items = [];
  for (let k = 0; k < (o.pines ?? 0); k++) {
    const x = Math.round(isle.x0 + 3 + r() * (isle.x1 - isle.x0 - 6));
    items.push({ kind: 'pine', x, h: Math.round((o.pineH ?? 14) * (0.6 + r() * 0.6)) });
  }
  for (let k = 0; k < (o.blossoms ?? 0); k++) items.push({ kind: 'blossom', x: Math.round(isle.x0 + (isle.x1 - isle.x0) * (0.25 + 0.5 * r())), h: Math.round((o.pineH ?? 14) * (0.55 + r() * 0.2)) });
  for (let k = 0; k < (o.bushes ?? 0); k++) items.push({ kind: 'bush', x: Math.round(isle.x0 + 2 + r() * (isle.x1 - isle.x0 - 4)), w: 1 + Math.floor(r() * 3) });
  items.sort((a, b) => (a.kind === 'bush') - (b.kind === 'bush') || (b.h ?? 0) - (a.h ?? 0));
  for (const it of items) {
    const y = isle.top(it.x);
    if (y == null) continue;
    if (it.kind === 'pine') pine(cv, it.x, y - 1, it.h, pal, o.seed + it.x);
    else if (it.kind === 'blossom') blossom(cv, it.x, y - 1, it.h, pal);
    else bush(cv, it.x, y - 1, it.w, pal);
  }
  for (let k = 0; k < (o.flowers ?? 0); k++) {
    const x = Math.round(isle.x0 + 2 + r() * (isle.x1 - isle.x0 - 4)), y = isle.top(x);
    if (y != null) cv.set(x, y - 1, pal.flower[k % pal.flower.length]);
  }
}

// Cloud sea: stacked banks, back to front. Each bank shows only a scalloped,
// lit upper edge over a flat body, and casts a thin shade onto the bank behind
// it, so the sea reads as a few big rolling shelves rather than a bubble field.
function cloudSea(cv, seed, y, baseTones, { puffMin = 6, puffMax = 14, amp = 10, rows = 3, rowGap, haze = '#9fdcdc', phase = 0, breathe = 0, sway = 0 } = {}) {
  const r = rng(seed), gap = rowGap ?? Math.round(puffMax * 0.9);
  for (let row = 0; row < rows; row++) {
    // Back banks recede toward the sky colour.
    const tones = hazed(baseTones, haze, (rows - 1 - row) * 0.13);
    const mound = fbm(seed + 5 + row * 13, 60 + row * 25, 3), size = noise1(seed + 6 + row * 7, 22 + row * 8);
    const grow = 1 + row * 0.18, baseY = y + row * gap;
    const puffs = [];
    for (let x = -puffMax * 2; x < cv.w + puffMax * 2;) {
      const lift = Math.max(-0.2, mound(x)) * amp * (1 - row * 0.15);
      const rad = (puffMin + (puffMax - puffMin) * (0.5 + 0.5 * size(x))) * grow;
      // Looping motion: each lobe swells on its own phase, each bank sways.
      const ph = (Math.sin(puffs.length * 12.9898 + row * 78.233) * 43758.5453) % 1;
      const wave = Math.sin(2 * Math.PI * (phase + ph));
      const dx = sway * Math.sin(2 * Math.PI * (phase + row * 0.27));
      puffs.push({ x: Math.round(x + dx), y: Math.round(baseY - lift - breathe * 0.5 * wave), r: rad + breathe * wave });
      x += rad * (1.05 + r() * 0.5);
    }
    const body = row === rows - 1 ? tones.light : tones.mid;
    // Cast shade on the bank behind.
    if (row > 0) for (const p of puffs) {
      const R = Math.ceil(p.r);
      for (let dy = -R; dy <= 0; dy++) for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > p.r * p.r + p.r * 0.6) continue;
        const yy = p.y + dy - 2, xx = p.x + dx - 1;
        if (cv.alpha(xx, yy)) cv.set(xx, yy, tones.shade);
      }
    }
    for (const p of puffs) puff(cv, p.x, p.y, p.r, { ...tones, deep: tones.mid, shade: tones.mid }, { baseY: p.y });
    // Flat body down to the canvas bottom; later banks paint over it.
    let prev = null;
    for (let x = 0; x < cv.w; x++) {
      while (prev === null || (prev + 1 < puffs.length && puffs[prev + 1].x <= x)) prev = prev === null ? 0 : prev + 1;
      const a = puffs[prev], b = puffs[Math.min(puffs.length - 1, prev + 1)];
      const t = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      const yy = Math.round(a.y + (b.y - a.y) * t);
      // Lit top, then a dithered step into shade toward the bank's base.
      for (let k = yy; k < cv.h; k++) {
        const t = (k - yy) / gap;
        const c = t < 0.4 ? body : t < 0.7 ? (bayer(x, k) < (t - 0.4) / 0.3 ? tones.shade : body) : tones.shade;
        cv.set(x, k, c);
      }
    }
    // A single highlight row along the top of each puff's lit side.
    for (const p of puffs) for (let dx = Math.round(-p.r * 0.1); dx <= Math.round(p.r * 0.7); dx++) {
      const yy = Math.round(p.y - Math.sqrt(Math.max(0, p.r * p.r - dx * dx)));
      if (cv.alpha(p.x + dx, yy)) cv.set(p.x + dx, yy, tones.rim);
    }
  }
}

// Each layer is cover-scaled by the scenery runtime, so only a window of its
// canvas is on screen. WIN is that window (in full 1536x1024 image pixels),
// measured from a game render of the whole camera bounds.
const WIN = {
  sky: { x0: 0, x1: 1536, y0: 124, y1: 877 },
  far: { x0: 47, x1: 1495, y0: 213, y1: 920 },
  near: { x0: 151, x1: 1372, y0: 146, y1: 742 },
};
function framer(win, px) {
  return {
    u: f => Math.round((win.x0 + (win.x1 - win.x0) * f) / px),
    v: f => Math.round((win.y0 + (win.y1 - win.y0) * f) / px),
    s: n => Math.round(n * (win.x1 - win.x0) / px / 1000), // size in thousandths of window width
  };
}

module.exports = { Canvas, hex, mix, rng, noise1, fbm, bayer, hazed, puff, cumulus, wisp, cloudSea, waterfall, CLOUD, NEAR, WIN, framer, FULL_W, FULL_H };
