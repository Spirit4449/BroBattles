#!/usr/bin/env node
// Ninja's Shuriken Swarm effects, drawn in code as pixel art at world scale
// (one art pixel per world pixel, like his body). Every effect is drawn twice,
// once per team palette (G = ally green, R = enemy red), and packed in one
// atlas, public/assets/ninja/swarm-fx.webp + swarm-fx.json, read by
// src/client/game/characters/ninja/swarmFx.js.
//   smoke{G,R}00-11   ink smoke poof around him as the barrage starts
//   slash{G,R}00-07   the crescent slash in front of him as the barrage starts
//   wind{G,R}00-05    speed lines streaming off his back during the barrage (loop)
//   aura{G,R}00-07    the spirit ring around each swarm shuriken (loop)
//   glint{G,R}00-07   a steel glint where a shuriken turns back
//   impact{G,R}00-07  a cross slash on a target the swarm cuts
//   spark{G,R}00-05   a small burst where a shuriken leaves or is caught
//   node scripts/art/ninja-pixel/swarm-fx.cjs            -> output/ninja-pixel/swarm-fx/
//   node scripts/art/ninja-pixel/swarm-fx.cjs --install  also copies the atlas into public/assets/ninja/
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/ninja-pixel/swarm-fx');
const INSTALL_DIR = path.join(ROOT, 'public/assets/ninja');
const TAU = Math.PI * 2;

const INK = { dark: [28, 24, 38], mid: [58, 54, 76], light: [98, 94, 120], pale: [150, 148, 174] };
const STEEL = { white: [255, 255, 255], ice: [226, 240, 255], steel: [168, 186, 210] };
const PALETTES = {
  // Ally: the game's team green, pushed toward jade so it reads on grass maps.
  G: { light: [196, 255, 226], team: [96, 234, 160], deep: [30, 150, 112], ink: [18, 70, 60] },
  R: { light: [255, 212, 204], team: [255, 98, 91], deep: [184, 36, 48], ink: [80, 18, 30] },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const clamp01 = (v) => Math.max(0, Math.min(1, v));
const easeOut = (u) => 1 - (1 - u) ** 3;
// 4x4 ordered dither: dissolves effects pixel by pixel instead of fading them.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const kept = (x, y, amount) => BAYER[(y & 3) * 4 + (x & 3)] / 16 >= amount;

function canvas(w, h) {
  const px = Buffer.alloc(w * h * 4);
  const plot = (x, y, color, alpha = 1) => {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= w || y >= h || alpha <= 0) return;
    const i = (y * w + x) * 4;
    // Stepped alpha keeps it pixel art: four levels only.
    const a = Math.min(1, Math.ceil(alpha * 4) / 4);
    const under = px[i + 3] / 255;
    const out = a + under * (1 - a);
    for (let c = 0; c < 3; c++) px[i + c] = Math.round((color[c] * a + px[i + c] * under * (1 - a)) / (out || 1));
    px[i + 3] = Math.round(out * 255);
  };
  return { w, h, px, plot };
}

function disc(cv, cx, cy, r, color, alpha = 1, dissolve = 0) {
  for (let y = Math.floor(cy - r); y <= cy + r; y++) for (let x = Math.floor(cx - r); x <= cx + r; x++) {
    if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r && kept(x, y, dissolve)) cv.plot(x, y, color, alpha);
  }
}

// A line `width` pixels thick from a to b.
function line(cv, ax, ay, bx, by, color, width = 1, alpha = 1) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay)));
  for (let i = 0; i <= n; i++) {
    const x = ax + ((bx - ax) * i) / n, y = ay + ((by - ay) * i) / n;
    if (width <= 1) cv.plot(x, y, color, alpha);
    else disc(cv, x, y, width / 2, color, alpha);
  }
}

// A four-point star: long arms on the axes, short ones on the diagonals.
function star(cv, cx, cy, size, P, alpha = 1) {
  if (size <= 0) return;
  for (let i = -size; i <= size; i++) {
    const tip = Math.abs(i) > size * 0.55;
    cv.plot(cx + i, cy, tip ? P.team : STEEL.white, alpha);
    cv.plot(cx, cy + i, tip ? P.team : STEEL.white, alpha);
  }
  const d = Math.floor(size * 0.4);
  for (let i = 1; i <= d; i++) for (const [sx, sy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) cv.plot(cx + sx * i, cy + sy * i, P.light, alpha * 0.75);
  cv.plot(cx, cy, STEEL.white);
}

// ---------------------------------------------------------------- effects

function smokeFrame(f, P) {
  const cv = canvas(72, 60), cx = 36, cy = 32, u = f / 11, r = rng(7);
  // The pop: a bright core that is gone by the third frame.
  if (f < 3) {
    disc(cv, cx, cy, 9 - f * 2.5, P.light, 0.9 - f * 0.25);
    disc(cv, cx, cy, 5 - f * 1.5, STEEL.white, 1 - f * 0.3);
  }
  const dissolve = clamp01((u - 0.45) / 0.55);
  const puffs = 11;
  for (let i = 0; i < puffs; i++) {
    const a = (i / puffs) * TAU + r() * 0.4;
    const reach = (14 + r() * 10) * easeOut(Math.min(1, u * 1.6));
    const size = (4.5 + r() * 3.5) * (u < 0.2 ? 0.6 + u * 2 : 1 - 0.45 * (u - 0.2));
    // Smoke rolls upward as it spreads.
    const x = cx + Math.cos(a) * reach * 1.25, y = cy + Math.sin(a) * reach * 0.8 - u * 7;
    disc(cv, x, y, size + 1, P.ink, 0.9, dissolve);
    disc(cv, x, y, size, INK.dark, 1, dissolve);
    disc(cv, x - size * 0.25, y - size * 0.3, size * 0.7, INK.mid, 1, dissolve);
    disc(cv, x - size * 0.4, y - size * 0.45, size * 0.35, INK.light, 1, dissolve);
    // Team light catches the outer edge of each puff while it is fresh.
    if (u < 0.6) {
      for (let k = 0; k < 10; k++) {
        const t = a - 0.6 + (k / 9) * 1.2;
        const ex = x + Math.cos(t) * size, ey = y + Math.sin(t) * size * 0.95;
        if (kept(Math.round(ex), Math.round(ey), dissolve + 0.1)) cv.plot(ex, ey, P.team, 1 - u);
      }
    }
  }
  // A few wisps that drift up and out last.
  for (let i = 0; i < 6; i++) {
    const a = r() * TAU, d = (18 + r() * 14) * easeOut(u);
    if (u > 0.15) disc(cv, cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d * 0.7 - u * 12, 2 * (1 - u) + 0.6, INK.pale, 0.75, dissolve);
  }
  return cv;
}

// The crescent opens to the right of x = 6 (his hand); the runtime flips it.
function slashFrame(f, P) {
  const cv = canvas(84, 96), ox = 6, oy = 48, R = 46;
  const reveal = [0.35, 0.75, 1, 1, 1, 1, 1, 1][f];
  const fade = clamp01((f - 2) / 5.5);
  const maxW = [5, 7, 8, 7, 5, 4, 2, 1][f];
  const a0 = -1.2, a1 = 1.2;
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    const dx = x + 0.5 - ox, dy = y + 0.5 - oy, d = Math.hypot(dx, dy), a = Math.atan2(dy, dx);
    if (a < a0 || a > a0 + (a1 - a0) * reveal) continue;
    const along = (a - a0) / (a1 - a0);
    const w = maxW * Math.sin(Math.PI * along) + 0.6;
    const inside = R + 2 * f - d; // the arc drifts outward as it fades
    if (inside < 0 || inside > w) continue;
    if (!kept(x, y, fade * 0.9)) continue;
    const depth = inside / w;
    const color = depth < 0.3 ? STEEL.white : depth < 0.6 ? P.light : depth < 0.85 ? P.team : P.deep;
    cv.plot(x, y, color, 1);
  }
  // Sparks thrown off the blade's path.
  const r = rng(31);
  if (f >= 1) for (let i = 0; i < 10; i++) {
    const a = a0 + r() * (a1 - a0), d = R + 3 + r() * 6 + f * (3 + r() * 3);
    if (r() < fade * 0.8) continue;
    cv.plot(ox + Math.cos(a) * d, oy + Math.sin(a) * d, r() < 0.4 ? STEEL.white : P.team);
  }
  return cv;
}

// Speed lines streaming back from his body; the runtime anchors the right edge on him.
function windFrame(f, P) {
  const cv = canvas(80, 64), r = rng(53);
  for (let i = 0; i < 9; i++) {
    const y = 6 + Math.round(r() * 52), len = 10 + Math.round(r() * 18), speed = 1 + Math.floor(r() * 2);
    const phase = Math.floor(r() * 80);
    const head = 80 - ((phase + f * (80 / 6) * speed) % 96);
    const color = r() < 0.35 ? P.light : STEEL.ice;
    for (let k = 0; k < len; k++) {
      const x = head - k;
      cv.plot(x, y, k < 3 ? STEEL.white : k < len * 0.6 ? color : P.team, k < len * 0.6 ? 0.75 : 0.5);
    }
  }
  return cv;
}

function auraFrame(f, P) {
  const cv = canvas(40, 40), cx = 20, cy = 20, R = 15, spin = (f / 8) * (TAU / 3);
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) {
    const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy);
    if (d < R - 2) { if ((x + y + f) % 3 === 0) cv.plot(x, y, P.team, 0.25); continue; }
    if (d > R + 0.5) continue;
    // Three arcs chase each other around the ring, bright at the head.
    const a = (((Math.atan2(dy, dx) - spin) % (TAU / 3)) + TAU / 3) % (TAU / 3);
    const t = a / (TAU / 3);
    if (t < 0.55) continue;
    const head = t > 0.9;
    cv.plot(x, y, head ? STEEL.white : t > 0.75 ? P.light : P.team, head ? 1 : 0.75);
  }
  return cv;
}

function glintFrame(f, P) {
  const cv = canvas(23, 23);
  const size = [2, 5, 9, 11, 9, 6, 3, 1][f];
  star(cv, 11, 11, size, P, f > 5 ? 0.75 : 1);
  if (f >= 2 && f <= 5) disc(cv, 11, 11, 1.6, STEEL.white);
  return cv;
}

function impactFrame(f, P) {
  const cv = canvas(60, 60), c = 30, L = 22;
  const cut = (dir, progress, width, fade) => {
    const [sx, sy] = dir;
    const n = Math.round(L * 2 * progress);
    for (let i = 0; i <= n; i++) {
      const t = -L + i, x = c + sx * t, y = c + sy * t;
      const taper = 1 - Math.abs(t) / L;
      const w = Math.max(0, width * taper);
      if (!kept(Math.round(x), Math.round(y), fade)) continue;
      if (w > 1.2) disc(cv, x, y, w, P.team);
      if (w > 0.4) disc(cv, x, y, w * 0.55, STEEL.white);
      else cv.plot(x, y, P.light);
    }
  };
  const fade = clamp01((f - 3) / 4.5);
  const width = [3, 3.5, 3.5, 3, 2.4, 1.8, 1.2, 0.8][f];
  cut([1, 1], Math.min(1, (f + 1) / 2), width, fade);
  if (f >= 1) cut([1, -1], Math.min(1, f / 2), width, fade);
  if (f === 2) disc(cv, c, c, 6, STEEL.white, 0.75);
  if (f === 3) disc(cv, c, c, 4, P.light, 0.5);
  const r = rng(71);
  if (f >= 2) for (let i = 0; i < 12; i++) {
    const a = r() * TAU, d = 6 + (f - 2) * (3 + r() * 3);
    if (r() < fade * 0.9) continue;
    const x = c + Math.cos(a) * d, y = c + Math.sin(a) * d;
    cv.plot(x, y, r() < 0.5 ? STEEL.white : P.team);
    cv.plot(x - Math.cos(a), y - Math.sin(a), P.team, 0.5);
  }
  return cv;
}

function sparkFrame(f, P) {
  const cv = canvas(21, 21), c = 10;
  const inner = [0, 1, 2, 4, 6, 7][f], outer = [2, 4, 6, 8, 9, 10][f];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU + (i % 2) * 0.2, long = i % 2 === 0;
    const reach = long ? outer : outer * 0.65;
    for (let d = inner; d <= reach; d++) cv.plot(c + Math.cos(a) * d, c + Math.sin(a) * d, d >= reach - 1 ? P.team : STEEL.white, f > 3 ? 0.5 : 1);
  }
  if (f < 3) disc(cv, c, c, 2.4 - f * 0.6, STEEL.white);
  return cv;
}

const EFFECTS = {
  smoke: { count: 12, draw: smokeFrame },
  slash: { count: 8, draw: slashFrame },
  wind: { count: 6, draw: windFrame },
  aura: { count: 8, draw: auraFrame },
  glint: { count: 8, draw: glintFrame },
  impact: { count: 8, draw: impactFrame },
  spark: { count: 6, draw: sparkFrame },
};

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const tiles = [], frames = {};
  let x = 0, y = 0, rowH = 0;
  const WIDTH = 1024;
  for (const [palette, P] of Object.entries(PALETTES)) {
    for (const [name, { count, draw }] of Object.entries(EFFECTS)) {
      for (let f = 0; f < count; f++) {
        const cv = draw(f, P);
        if (x + cv.w > WIDTH) { x = 0; y += rowH + 1; rowH = 0; }
        const input = await sharp(cv.px, { raw: { width: cv.w, height: cv.h, channels: 4 } }).png().toBuffer();
        tiles.push({ input, left: x, top: y });
        frames[`${name}${palette}${String(f).padStart(2, '0')}`] = {
          frame: { x, y, w: cv.w, h: cv.h }, rotated: false, trimmed: false,
          spriteSourceSize: { x: 0, y: 0, w: cv.w, h: cv.h }, sourceSize: { w: cv.w, h: cv.h },
        };
        x += cv.w + 1; rowH = Math.max(rowH, cv.h);
      }
    }
  }
  const size = { w: WIDTH, h: y + rowH };
  await sharp({ create: { width: size.w, height: size.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'swarm-fx.webp'));
  fs.writeFileSync(path.join(OUT_DIR, 'swarm-fx.json'), JSON.stringify({ frames, meta: { image: 'swarm-fx.webp', size, scale: 1 } }));
  // Previews on a dark and a light backdrop, at 3x.
  for (const [label, bg] of [['dark', { r: 34, g: 40, b: 56 }], ['light', { r: 170, g: 200, b: 230 }]]) {
    await sharp(path.join(OUT_DIR, 'swarm-fx.webp')).flatten({ background: bg })
      .resize(size.w * 3, size.h * 3, { kernel: 'nearest' }).png().toFile(path.join(OUT_DIR, `preview-${label}.png`));
  }
  console.log(`swarm-fx atlas ${size.w}x${size.h}, ${Object.keys(frames).length} frames -> ${path.relative(ROOT, OUT_DIR)}`);
  if (process.argv.includes('--install')) {
    for (const file of ['swarm-fx.webp', 'swarm-fx.json']) fs.copyFileSync(path.join(OUT_DIR, file), path.join(INSTALL_DIR, file));
    console.log(`installed swarm-fx.webp and swarm-fx.json into ${path.relative(ROOT, INSTALL_DIR)}`);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
