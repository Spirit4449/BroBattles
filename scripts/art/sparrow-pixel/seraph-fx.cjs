#!/usr/bin/env node
// Sparrow's Seraph effects, drawn in code as pixel art at world scale (one art
// pixel per world pixel, like her body). Packed into one atlas,
// public/assets/sparrow/seraph-fx.webp + seraph-fx.json, read by
// src/client/game/characters/sparrow/seraphFx.js.
//   shield00-23   angelic shield: a gold-white ring that breathes,
//                 four feather glyphs and orbiting sparkles (24 fps loop)
//   shieldPulse00 the expanding ring, timed by the aim phase in the renderer
//   ray00-03      the soft aim light, repeated along the aim
//   rayStart00-03 its glow at the bow
//   chargeLight00 a tapered streak pulsing in and out during the charge
//   bolt00-07     the gold light bolt with faint blue crackle
//   beam00-05     glowing gold strands weaving behind the bolt
//   flash00-09    the release explosion at the bow
//   radiance00-11 light bursting out around her on release
//   impact00-07   a strike on a target
//   feather00-07  a loose feather tumbling
//   mote00-03     a trailing sparkle
//   node scripts/art/sparrow-pixel/seraph-fx.cjs            -> output/sparrow-pixel/seraph-fx/
//   node scripts/art/sparrow-pixel/seraph-fx.cjs --install  also copies the atlas into public/assets/sparrow/
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel/seraph-fx');
const INSTALL_DIR = path.join(ROOT, 'public/assets/sparrow');

const C = {
  white: [255, 255, 255], cream: [255, 250, 222], pale: [255, 238, 168], gold: [255, 214, 92],
  amber: [226, 160, 52], deep: [170, 104, 34],
  ice: [214, 236, 255], sky: [140, 196, 255], blue: [86, 132, 255], violet: [120, 96, 220],
  feather: [246, 248, 255], fshade: [190, 201, 232], fdark: [120, 132, 176], ink: [24, 28, 52],
};
const TAU = Math.PI * 2;

// Deterministic noise so rebuilds are identical.
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function canvas(w, h, steppedAlpha = true) {
  const px = Buffer.alloc(w * h * 4);
  const plot = (x, y, color, alpha = 1) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h || alpha <= 0) return;
    const i = (y * w + x) * 4;
    // Stepped alpha keeps it pixel art: four levels only.
    const a = Math.min(1, steppedAlpha ? Math.ceil(alpha * 4) / 4 : alpha);
    const under = px[i + 3] / 255;
    const out = a + under * (1 - a);
    for (let c = 0; c < 3; c++) px[i + c] = Math.round((color[c] * a + px[i + c] * under * (1 - a)) / (out || 1));
    px[i + 3] = Math.round(out * 255);
  };
  return { w, h, px, plot };
}

function disc(cv, cx, cy, r, color, alpha = 1) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r) cv.plot(x, y, color, alpha);
  }
}

function ring(cv, cx, cy, r, width, color, alpha = 1, gate = null) {
  for (let y = Math.floor(cy - r - width); y <= cy + r + width; y++) for (let x = Math.floor(cx - r - width); x <= cx + r + width; x++) {
    const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
    if (Math.abs(d - r) > width / 2) continue;
    if (gate && !gate(Math.atan2(y + 0.5 - cy, x + 0.5 - cx), d)) continue;
    cv.plot(x, y, color, alpha);
  }
}

function sparkle(cv, x, y, size, color = C.white, alpha = 1) {
  cv.plot(x, y, color, alpha);
  for (let i = 1; i <= size; i++) {
    const a = alpha * (1 - (i - 1) / (size + 1));
    for (const [dx, dy] of [[i, 0], [-i, 0], [0, i], [0, -i]]) cv.plot(x + dx, y + dy, i === size ? C.pale : color, a);
  }
}

// A jagged crackle from a to b; returns its points.
function crackle(cv, a, b, rand, color, alpha = 1, jitter = 3) {
  const steps = Math.max(2, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 4));
  const nx = -(b[1] - a[1]); const ny = b[0] - a[0]; const nl = Math.hypot(nx, ny) || 1;
  let prev = a; const pts = [a];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps; const off = i === steps ? 0 : (rand() * 2 - 1) * jitter;
    const p = [a[0] + (b[0] - a[0]) * t + (nx / nl) * off, a[1] + (b[1] - a[1]) * t + (ny / nl) * off];
    const n = Math.max(Math.abs(p[0] - prev[0]), Math.abs(p[1] - prev[1]), 1);
    for (let k = 0; k <= n; k++) cv.plot(prev[0] + (p[0] - prev[0]) * k / n, prev[1] + (p[1] - prev[1]) * k / n, color, alpha);
    pts.push(p); prev = p;
  }
  return pts;
}

// --- shield -------------------------------------------------------------------
const SHIELD = 128;
function shieldFrame(f) {
  const cv = canvas(SHIELD, SHIELD); const c = SHIELD / 2; const t = f / 24;
  const breathe = Math.sin(t * TAU);
  const r = 47 + breathe * 1.5;
  // Faint warm fill and a lighter rim band inside the ring.
  ring(cv, c, c, r - 5, 5, C.pale, breathe > 0.3 ? 0.25 : 0.15);
  // The ring: gold edges, a cream-white core, lit upper left.
  ring(cv, c, c, r + 1.5, 1, C.amber, 0.85);
  ring(cv, c, c, r, 2, C.gold, 1);
  ring(cv, c, c, r - 0.5, 1, C.white, 0.9, (a) => Math.cos(a + 2.4) > -0.2);
  ring(cv, c, c, r - 1.5, 1, C.amber, 0.6);
  // Four feather glyphs on the ring, slowly turning.
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * TAU + t * TAU * 0.25 - Math.PI / 4;
    const x = c + Math.cos(a) * r; const y = c + Math.sin(a) * r;
    const ux = Math.cos(a); const uy = Math.sin(a);
    for (let i = -4; i <= 4; i++) {
      const w = 2 - Math.abs(i) / 3;
      for (let j = -Math.ceil(w); j <= Math.ceil(w); j++) {
        cv.plot(x + ux * j - uy * i, y + uy * j + ux * i, Math.abs(j) < w * 0.5 ? C.white : C.gold, Math.abs(j) <= w ? 1 : 0.5);
      }
    }
  }
  // Sparkles orbiting just outside, twinkling in turn.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * TAU - t * TAU * 0.5;
    const tw = (Math.sin((t * 3 + k / 6) * TAU) + 1) / 2;
    if (tw < 0.25) continue;
    sparkle(cv, c + Math.cos(a) * (r + 6), c + Math.sin(a) * (r + 6), tw > 0.75 ? 2 : 1, C.white, tw);
  }
  return cv;
}

function shieldPulseFrame() {
  const cv = canvas(104, 104, false);
  ring(cv, 52, 52, 48, 2.6, C.gold, 0.22);
  ring(cv, 52, 52, 48, 1.15, C.pale, 0.86);
  return cv;
}

// --- the aim light ----------------------------------------------------------------
const RAY = { w: 32, h: 26 };
function rayFrame(f) {
  const cv = canvas(RAY.w, RAY.h, false); const cy = RAY.h / 2;
  for (let x = 0; x < RAY.w; x++) for (let y = 0; y < RAY.h; y++) {
    const d = Math.abs(y + 0.5 - cy);
    if (d < 1) cv.plot(x, y, C.white, 0.86);
    else if (d < 2) cv.plot(x, y, C.cream, 0.64);
    else if (d < 5) cv.plot(x, y, C.pale, 0.3);
    else if (d < 10) cv.plot(x, y, C.gold, 0.18 * (1 - (d - 5) / 5));
  }
  const rand = rng(17);
  for (let k = 0; k < 4; k++) {
    const x = (rand() * RAY.w + f * 8) % RAY.w; const y = cy + (rand() * 2 - 1) * 8;
    cv.plot(x, y, C.white, 0.9); cv.plot(x + 1, y, C.pale, 0.5);
  }
  return cv;
}
function rayStartFrame(f) {
  const cv = canvas(32, 32, false); const c = 16;
  disc(cv, c, c, 12 + (f % 2), C.gold, 0.1);
  disc(cv, c, c, 8, C.pale, 0.24);
  disc(cv, c, c, 5, C.pale, 0.5);
  disc(cv, c, c, 3, C.cream, 1);
  sparkle(cv, c, c, 5 + (f % 2) * 2, C.white, 0.9);
  return cv;
}

function chargeLightFrame() {
  const cv = canvas(32, 9, false);
  const cy = 4;
  for (let x = 1; x < 31; x++) {
    const reach = Math.min(1, (x - 1) / 24);
    const alpha = reach ** 1.4 * Math.min(1, (31 - x) / 6);
    const width = 0.65 + 3.2 * reach;
    for (let y = 0; y < cv.h; y++) {
      const d = Math.abs(y - cy);
      if (d >= width) continue;
      const color = d <= 1 ? C.cream : C.gold;
      cv.plot(x, y, color, alpha * (1 - d / width) ** 0.8);
    }
  }
  sparkle(cv, 25, cy, 2, C.cream, 0.85);
  return cv;
}

// --- the bolt -------------------------------------------------------------------
const BOLT = { w: 88, h: 56 };
function boltFrame(f) {
  const cv = canvas(BOLT.w, BOLT.h, false); const cy = BOLT.h / 2; const head = Math.round(0.83 * BOLT.w);
  const rand = rng(100 + f);
  // A long teardrop, widest just behind the head.
  for (let x = 0; x < BOLT.w; x++) for (let y = 0; y < BOLT.h; y++) {
    const dx = x + 0.5 - head; const dy = y + 0.5 - cy;
    const along = dx < 0 ? -dx / head : dx / 10;
    const width = dx < 0 ? 23 * (1 - along) ** 0.72 : 23 * Math.sqrt(Math.max(0, 1 - along * along));
    const d = Math.abs(dy - 3 * Math.sin(dx * 0.19 - f * 0.6) * Math.max(0, -dx / head)) / Math.max(0.01, width);
    if (d > 1) continue;
    const fade = dx < 0 ? Math.min(1, (1 - along) * 2.8) : 1;
    const color = d < 0.24 ? C.cream : d < 0.45 ? C.pale : C.gold;
    cv.plot(x, y, color, fade * (d < 0.25 ? 1 : (1 - d) ** 1.6));
  }
  disc(cv, head, cy, 6.5 + (f % 2), C.pale, 1);
  disc(cv, head, cy, 4.5, C.cream, 1);
  sparkle(cv, head + 2, cy, 9 + (f % 3), C.cream, 1);
  for (let k = 0; k < 3; k++) {
    const sx = head - 6 - rand() * 30; const sy = cy + (rand() * 2 - 1) * 3;
    const ex = sx - 8 - rand() * 14; const ey = cy + (rand() < 0.5 ? -1 : 1) * (8 + rand() * 9);
    crackle(cv, [sx, sy], [ex, ey], rand, k === 0 ? C.pale : C.sky, k === 0 ? 0.85 : 0.28, 2.5);
  }
  return cv;
}

const BEAM = { w: 224, h: 64 };
function beamFrame(f) {
  const cv = canvas(BEAM.w, BEAM.h, false); const cy = BEAM.h / 2;
  const phase = f / 6 * TAU;
  for (let x = 0; x < BEAM.w; x++) {
    const a = x / BEAM.w * TAU;
    const core = cy + Math.round(2.4 * Math.sin(3 * a + phase) + 1.6 * Math.sin(7 * a - phase));
    const ribbon = cy + 9 * Math.sin(2 * a - phase) + 4 * Math.sin(5 * a + phase);
    const arc = cy - 14 * Math.sin(2 * a - phase + 0.5) + 3 * Math.sin(8 * a + phase);
    const width = 1.28 * (3.1 + 1.35 * Math.sin(3 * a + phase + 1) + 0.8 * Math.cos(7 * a));
    const rim = Math.max(2, Math.round(width * 1.25));
    for (let y = 0; y < BEAM.h; y++) {
      const d = Math.abs(y - core);
      const warm = Math.max(0, 1 - Math.abs(y - Math.round(ribbon)) / 15);
      const cool = Math.max(0, 1 - Math.abs(y - Math.round(arc)) / 9);
      cv.plot(x, y, C.gold, warm ** 2 * 0.68);
      cv.plot(x, y, C.blue, cool ** 2 * 0.13);
      const inner = Math.max(0, 1 - d / (width * 2.7));
      cv.plot(x, y, d < width ? C.cream : C.pale, inner ** 0.97);
      if (d === rim) cv.plot(x, y, C.deep, 0.43);
      if (Math.abs(y - Math.round(ribbon)) <= 1) cv.plot(x, y, C.pale, 0.7);
      if (y === Math.round(arc)) cv.plot(x, y, C.ice, 0.26);
    }
  }
  // Irregular branches and square sparks over the woven strands.
  const rand = rng(304);
  for (let k = 0; k < 7; k++) {
    const x = (9 + k * 29 + f * 5) % BEAM.w; const y = cy + (rand() * 2 - 1) * 22;
    cv.plot(x, y, C.cream, 0.74);
    cv.plot((x + 1) % BEAM.w, y, C.pale, 0.52);
  }
  for (const [x, side] of [[28, -1], [116, 1], [182, -1]]) {
    crackle(cv, [x + f * 3, cy], [x + 23 + f * 2, cy + side * (16 + rand() * 6)], rand, C.sky, 0.23, 4);
  }
  return cv;
}

// --- release ------------------------------------------------------------------
const FLASH = 128;
function flashFrame(f) {
  const cv = canvas(FLASH, FLASH, false); const c = FLASH / 2; const t = f / 9;
  const rand = rng(500);
  const grow = 1 - (1 - t) ** 3;
  const fade = (1 - t) ** 1.4;
  // The white orb swells, then frays into dithered light.
  const r = 14 + grow * 38;
  for (let y = 0; y < FLASH; y++) for (let x = 0; x < FLASH; x++) {
    const dx = x + 0.5 - c; const dy = y + 0.5 - c;
    const a = Math.atan2(dy, dx);
    const d = Math.hypot(dx, dy) / (r * (1 + 0.12 * Math.sin(a * 5 + t) + 0.07 * Math.sin(a * 9)));
    if (d > 1) continue;
    const dither = (x + y) % 2 === 0;
    if (t > 0.55 && d > 0.55 && !dither) continue;
    const color = d < 0.45 ? C.white : d < 0.7 ? C.cream : d < 0.88 ? C.pale : C.gold;
    cv.plot(x, y, color, Math.min(1, (1 - d) * 2.5) * fade);
  }
  // Rays shooting out.
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU + (k % 2) * 0.13;
    const len = Math.min(c - 3, (k % 2 ? 0.7 : 1) * (r + 6 + grow * 20));
    for (let i = r * 0.5; i < len; i++) cv.plot(c + Math.cos(a) * i, c + Math.sin(a) * i, C.cream, fade * (1 - i / len));
  }
  ring(cv, c, c, r + 4 + grow * 7, 2, C.gold, fade * 0.6, (a) => Math.sin(a * 3 + t) > -0.5);
  for (let k = 0; k < 5; k++) {
    const a = rand() * TAU;
    const reach = Math.min(c - 4, r + 14);
    crackle(cv, [c + Math.cos(a) * r * 0.4, c + Math.sin(a) * r * 0.4], [c + Math.cos(a) * reach, c + Math.sin(a) * reach], rand, C.sky, fade, 3);
  }
  return cv;
}

const RAD = 160;
function radianceFrame(f) {
  const cv = canvas(RAD, RAD); const c = RAD / 2; const t = f / 11;
  const fade = 1 - t;
  // Long god rays turning slowly, a halo ring that spreads out.
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * TAU + t * 0.4;
    const len = (k % 2 ? 46 : 70) * (0.6 + 0.4 * Math.min(1, t * 3));
    const half = k % 2 ? 1 : 2;
    for (let i = 18; i < len; i++) {
      const w = half * (1 - (i - 18) / (len - 18));
      for (let j = -Math.ceil(w); j <= Math.ceil(w); j++) {
        const x = c + Math.cos(a) * i - Math.sin(a) * j; const y = c + Math.sin(a) * i + Math.cos(a) * j;
        cv.plot(x, y, j === 0 ? C.cream : C.pale, fade * (j === 0 ? 0.9 : 0.5));
      }
    }
  }
  ring(cv, c, c, 24 + t * 50, 3, C.white, fade);
  ring(cv, c, c, 22 + t * 50, 1, C.gold, fade);
  const rand = rng(700 + f);
  for (let k = 0; k < 10; k++) {
    const a = rand() * TAU; const d = 20 + rand() * (30 + t * 40);
    sparkle(cv, c + Math.cos(a) * d, c + Math.sin(a) * d, 1 + Math.round(rand() * 2), C.white, fade);
  }
  return cv;
}

const IMPACT = 96;
function impactFrame(f) {
  const cv = canvas(IMPACT, IMPACT, false); const c = IMPACT / 2; const t = f / 7;
  const fade = (1 - t) ** 1.2; const spread = 1 - (1 - t) ** 2;
  const rand = rng(913);
  disc(cv, c, c, 19 + 10 * spread, C.blue, fade * 0.2);
  disc(cv, c, c, 14 - 6 * t, C.gold, fade * 0.66);
  disc(cv, c, c, 8 - 5 * t, C.white, fade);
  ring(cv, c, c, 9 + spread * 23, 2, C.pale, fade * 0.8, (a) => Math.sin(4 * a + 0.6) > -0.48);
  for (let k = 0; k < 12; k++) {
    const a = k / 12 * TAU + rand() * 0.45;
    const ux = Math.cos(a); const uy = Math.sin(a);
    const dist = 10 + rand() * 16 + spread * (10 + rand() * 12);
    const end = [c + ux * dist, c + uy * dist];
    const start = 3 + spread * 19;
    crackle(cv, [c + ux * start, c + uy * start], end, rand, k % 3 ? C.pale : C.sky, fade, 4);
    sparkle(cv, ...end, k % 3 ? 1 : 3, C.ice, fade);
  }
  return cv;
}

// --- feathers and motes ---------------------------------------------------------
function featherFrame(f) {
  const cv = canvas(16, 16); const c = 8;
  const a = (f / 8) * TAU;
  // Foreshortened as it tumbles: the vane narrows edge-on.
  const width = 0.35 + 0.65 * Math.abs(Math.cos(a));
  const ux = Math.cos(0.6 + Math.sin(a) * 0.5); const uy = Math.sin(0.6 + Math.sin(a) * 0.5);
  for (let i = -6; i <= 6; i++) {
    const w = (2.6 - Math.abs(i + 1) / 3.2) * width;
    for (let j = -3; j <= 3; j++) {
      if (Math.abs(j) > w + 0.2) continue;
      const x = c + ux * i - uy * j; const y = c + uy * i + ux * j;
      cv.plot(x, y, j < -0.5 ? C.fshade : C.feather, 1);
    }
    if (i > -6) cv.plot(c + ux * i, c + uy * i, i > 3 ? C.fdark : C.fshade, 1);
  }
  // Ink outline around it.
  const filled = (x, y) => x >= 0 && y >= 0 && x < 16 && y < 16 && cv.px[(y * 16 + x) * 4 + 3] > 0;
  const add = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!filled(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => filled(x + dx, y + dy))) add.push([x, y]);
  }
  for (const [x, y] of add) cv.plot(x, y, C.ink, 1);
  return cv;
}

function moteFrame(f) {
  const cv = canvas(9, 9);
  sparkle(cv, 4, 4, [1, 2, 3, 2][f], f % 2 ? C.pale : C.white, 1);
  return cv;
}

const SETS = {
  shield: Array.from({ length: 24 }, (_, f) => shieldFrame(f)),
  shieldPulse: [shieldPulseFrame()],
  ray: Array.from({ length: 4 }, (_, f) => rayFrame(f)),
  rayStart: Array.from({ length: 4 }, (_, f) => rayStartFrame(f)),
  chargeLight: [chargeLightFrame()],
  bolt: Array.from({ length: 8 }, (_, f) => boltFrame(f)),
  beam: Array.from({ length: 6 }, (_, f) => beamFrame(f)),
  flash: Array.from({ length: 10 }, (_, f) => flashFrame(f)),
  radiance: Array.from({ length: 12 }, (_, f) => radianceFrame(f)),
  impact: Array.from({ length: 8 }, (_, f) => impactFrame(f)),
  feather: Array.from({ length: 8 }, (_, f) => featherFrame(f)),
  mote: Array.from({ length: 4 }, (_, f) => moteFrame(f)),
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Shelf packing, one row per set, 2px gutters.
  const GUTTER = 2;
  const frames = []; const tiles = [];
  let y = 0; let width = 0;
  for (const [name, set] of Object.entries(SETS)) {
    let x = 0; let rowH = 0;
    for (const [i, cv] of set.entries()) {
      const input = await sharp(cv.px, { raw: { width: cv.w, height: cv.h, channels: 4 } }).png().toBuffer();
      tiles.push({ input, left: x, top: y });
      frames.push({ filename: `${name}${String(i).padStart(2, '0')}`, rotated: false, trimmed: false,
        frame: { x, y, w: cv.w, h: cv.h }, spriteSourceSize: { x: 0, y: 0, w: cv.w, h: cv.h }, sourceSize: { w: cv.w, h: cv.h } });
      x += cv.w + GUTTER; rowH = Math.max(rowH, cv.h);
    }
    width = Math.max(width, x); y += rowH + GUTTER;
  }
  const size = { w: width, h: y };
  await sharp({ create: { width: size.w, height: size.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'seraph-fx.webp'));
  fs.writeFileSync(path.join(OUT_DIR, 'seraph-fx.json'), JSON.stringify({ frames, meta: { image: 'seraph-fx.webp', size, scale: 1 } }));
  // Preview on a dark and a light ground, 3x.
  for (const [label, bg] of [['dark', '#1d2433'], ['light', '#9fc08a']]) {
    await sharp(path.join(OUT_DIR, 'seraph-fx.webp')).resize(size.w * 3, size.h * 3, { kernel: 'nearest' })
      .flatten({ background: bg }).png().toFile(path.join(OUT_DIR, `preview-${label}.png`));
  }
  console.log(`wrote ${frames.length} frames (${size.w}x${size.h}) to ${path.relative(ROOT, OUT_DIR)}`);
  if (process.argv.includes('--install')) {
    for (const file of ['seraph-fx.webp', 'seraph-fx.json']) fs.copyFileSync(path.join(OUT_DIR, file), path.join(INSTALL_DIR, file));
    console.log(`installed seraph-fx.webp and seraph-fx.json into ${path.relative(ROOT, INSTALL_DIR)}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { SETS };
