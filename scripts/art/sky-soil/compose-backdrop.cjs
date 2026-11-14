#!/usr/bin/env node
// Sky Soil backdrop from Codex-generated BB-style islands.
//
//   node scripts/art/sky-soil/compose-backdrop.cjs [--out <dir>] [--install]
//
// Sources (codex-sources/): island-a.png, island-b.png and islets.png, generated
// with Codex image_gen in BB style on flat #FF00FF (prompts in the art README).
// Each is keyed, its own pixel grid is detected, and it is resampled one sample
// per art pixel, so every pixel lands on a true grid. Layers, back to front:
//   sky-v4.webp         smooth gradient sky, sun glow and blurred distant islands
//   far-isles-v4.webp   hazed, half-size islands over a far cloud sea
//   cloud-sea.webp      the arena's cloud sea + an animated billowing strip
//   near-isles-v4.webp  framing islands, drifting islets + animated waterfalls
// Clouds in the sky come only from the scenery clouds feature.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const kit = require('./pixel-kit.cjs');
const { Canvas, hex, mix, hazed, cloudSea, puff, CLOUD, WIN, FULL_W, FULL_H } = kit;

const ROOT = path.resolve(__dirname, '../../..');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(ROOT, 'output/sky-soil-v4/build'));
const INSTALL = argv.includes('--install');
const SRC = path.join(__dirname, 'codex-sources');
const NEAR_PX = 3, SEA_PX = 2, FAR_PX = 2;
const SEA_FRAMES = 12, SEA_FPS = 5, FALL_FRAMES = 8, FALL_FPS = 14;

// ------------------------------------------------------------ pixelation
const isKey = (r, g, b) => r > 150 && b > 150 && g < 120 && Math.abs(r - b) < 90;

// Period and phase of the source's pixel grid along one axis, from where colour
// edges fall.
function detectGrid(profile) {
  let best = { p: 12, o: 0, s: -1 };
  for (let p = 9; p <= 15; p += 0.02) for (let o = 0; o < p; o += 0.25) {
    let hit = 0, n = 0;
    for (let k = o; k < profile.length; k += p) { const i = Math.round(k); hit += profile[i] || 0; n++; }
    const score = hit / n;
    if (score > best.s) best = { p, o, s: score };
  }
  return best;
}

async function pixelate(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  for (let i = 0; i < data.length; i += 4) if (isKey(data[i], data[i + 1], data[i + 2])) data[i + 3] = 0;
  const colEdge = new Float64Array(w), rowEdge = new Float64Array(h);
  const diff = (i, j) => (data[i + 3] !== data[j + 3] ? 200 : Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]));
  for (let y = 1; y < h; y++) for (let x = 1; x < w; x++) {
    const i = (y * w + x) * 4;
    if (diff(i, i - 4) > 40) colEdge[x]++;
    if (diff(i, i - w * 4) > 40) rowEdge[y]++;
  }
  const gx = detectGrid(colEdge), gy = detectGrid(rowEdge);
  const cols = Math.floor((w - gx.o) / gx.p), rows = Math.floor((h - gy.o) / gy.p);
  const cv = new Canvas(cols, rows);
  // Each art pixel takes the most common colour of its cell's inner samples.
  for (let cy = 0; cy < rows; cy++) for (let cx = 0; cx < cols; cx++) {
    const counts = new Map();
    for (let sy = 0.25; sy < 0.8; sy += 0.25) for (let sx = 0.25; sx < 0.8; sx += 0.25) {
      const x = Math.floor(gx.o + (cx + sx) * gx.p), y = Math.floor(gy.o + (cy + sy) * gy.p), i = (y * w + x) * 4;
      const key = data[i + 3] < 128 ? 'clear' : `${data[i] >> 3},${data[i + 1] >> 3},${data[i + 2] >> 3}`;
      const e = counts.get(key) || { n: 0, i };
      e.n++; counts.set(key, e);
    }
    let win = null;
    for (const [k, e] of counts) if (!win || e.n > win.n) win = { k, ...e };
    if (win.k === 'clear') continue;
    cv.set(cx, cy, [data[win.i], data[win.i + 1], data[win.i + 2]]);
  }
  return { cv, grid: [gx.p, gy.p] };
}

function trim(cv) {
  let x0 = cv.w, y0 = cv.h, x1 = -1, y1 = -1;
  for (let y = 0; y < cv.h; y++) for (let x = 0; x < cv.w; x++) if (cv.alpha(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const out = new Canvas(x1 - x0 + 1, y1 - y0 + 1);
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const i = ((y + y0) * cv.w + x + x0) * 4, j = (y * out.w + x) * 4;
    for (let k = 0; k < 4; k++) out.d[j + k] = cv.d[i + k];
  }
  return out;
}

// Separate connected pieces (for the islets sheet), largest first, left to right.
function pieces(cv) {
  const seen = new Uint8Array(cv.w * cv.h), list = [];
  for (let s = 0; s < seen.length; s++) {
    if (seen[s] || !cv.d[s * 4 + 3]) continue;
    const q = [s]; seen[s] = 1;
    for (let k = 0; k < q.length; k++) {
      const v = q[k], x = v % cv.w, y = (v / cv.w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const X = x + dx, Y = y + dy, n = Y * cv.w + X;
        if (X >= 0 && Y >= 0 && X < cv.w && Y < cv.h && !seen[n] && cv.d[n * 4 + 3]) { seen[n] = 1; q.push(n); }
      }
    }
    if (q.length > 40) list.push(q);
  }
  return list.map(q => {
    const c = new Canvas(cv.w, cv.h);
    for (const v of q) for (let k = 0; k < 4; k++) c.d[v * 4 + k] = cv.d[v * 4 + k];
    return trim(c);
  }).sort((a, b) => a.minX - b.minX);
}

function blit(dst, src, x0, y0, { flip = false, tint = null, t = 0 } = {}) {
  for (let y = 0; y < src.h; y++) for (let x = 0; x < src.w; x++) {
    const sx = flip ? src.w - 1 - x : x, i = (y * src.w + sx) * 4;
    if (!src.d[i + 3]) continue;
    let c = [src.d[i], src.d[i + 1], src.d[i + 2]];
    if (tint) c = mix(c, tint, t);
    dst.set(x0 + x, y0 + y, c);
  }
}

// Half-size re-render: each new pixel takes the most common colour of a 2x2 block.
function half(src) {
  const out = new Canvas(Math.ceil(src.w / 2), Math.ceil(src.h / 2));
  for (let y = 0; y < out.h; y++) for (let x = 0; x < out.w; x++) {
    const votes = new Map();
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const X = x * 2 + dx, Y = y * 2 + dy;
      if (X >= src.w || Y >= src.h) continue;
      const i = (Y * src.w + X) * 4;
      const key = src.d[i + 3] ? `${src.d[i]},${src.d[i + 1]},${src.d[i + 2]}` : 'clear';
      votes.set(key, (votes.get(key) || 0) + (key === 'clear' ? 0.9 : 1));
    }
    let win = null;
    for (const [k, n] of votes) if (!win || n > win.n) win = { k, n };
    if (win.k !== 'clear') out.set(x, y, win.k.split(',').map(Number));
  }
  return out;
}

// Grass top of a placed island: first opaque row per column.
function surface(cv, x0, x1) {
  const tops = [];
  for (let x = x0; x <= x1; x++) { let y = 0; while (y < cv.h && !cv.alpha(x, y)) y++; tops.push(y); }
  return tops;
}

// ------------------------------------------------------------ waterfall
const WATER = [hex('#ffffff'), hex('#d4f6fb'), hex('#9be3f0'), hex('#5cc6df'), hex('#3aa6c8')];
// Looping frames of a falling stream with a churning foam cap at the bottom.
function waterfallFrames(w, h) {
  const frames = [];
  const offs = Array.from({ length: w }, (_, i) => (i * 5) % 16);
  for (let f = 0; f < FALL_FRAMES; f++) {
    const cv = new Canvas(w + 8, h + 6);
    for (let y = 0; y < h; y++) for (let i = 0; i < w; i++) {
      const s = (y - f * 2 + offs[i] + 64) % 16;
      let c = s < 3 ? WATER[0] : s < 7 ? WATER[1] : s < 12 ? WATER[2] : WATER[1];
      if (i === 0) c = s < 8 ? WATER[3] : WATER[4];
      if (i === w - 1) c = s < 10 ? WATER[0] : WATER[1];
      if (y < 2) c = WATER[0];
      cv.set(i + 4, y, c);
    }
    // Foam: three puffs that swell in turn.
    for (let k = 0; k < 3; k++) {
      const wave = Math.sin(2 * Math.PI * (f / FALL_FRAMES + k / 3));
      puff(cv, 4 + Math.round(w * (k + 0.5) / 3), h - 1, 2.6 + w * 0.18 + wave * 0.8, { ...CLOUD, deep: CLOUD.shade });
    }
    frames.push(cv);
  }
  return frames;
}

async function sheet(frames, scale, file) {
  const fw = frames[0].w * scale, fh = frames[0].h * scale;
  const parts = await Promise.all(frames.map(f => sharp(Buffer.from(f.d.buffer), { raw: { width: f.w, height: f.h, channels: 4 } })
    .resize(fw, fh, { kernel: 'nearest' }).png().toBuffer()));
  await sharp({ create: { width: fw, height: fh * frames.length, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(parts.map((input, i) => ({ input, left: 0, top: i * fh }))).webp({ lossless: true, effort: 6 }).toFile(file);
  return { frameWidth: fw, frameHeight: fh };
}

// ================================================================== layers
async function buildNear(isles) {
  const cv = new Canvas(FULL_W / NEAR_PX, Math.ceil(FULL_H / NEAR_PX));
  const u = f => Math.round((WIN.near.x0 + (WIN.near.x1 - WIN.near.x0) * f) / NEAR_PX);
  const v = f => Math.round((WIN.near.y0 + (WIN.near.y1 - WIN.near.y0) * f) / NEAR_PX);
  const dim = hex('#cdeee0');
  // Drifting islets between the arena and the framing islands, slightly hazed.
  const [small1, small2, small3] = isles.islets;
  blit(cv, small1, u(0.19) - small1.w / 2, v(0.24), { tint: dim, t: 0.18 });
  blit(cv, small3, u(0.84) - small3.w / 2, v(0.18), { tint: dim, t: 0.18, flip: true });
  blit(cv, small2, u(0.13) - small2.w / 2, v(0.6), { tint: dim, t: 0.25 });
  // Framing islands, flush with the window edges.
  const A = isles.a, B = isles.b;
  const ax = u(0.17) - A.w, ay = v(0.36);
  const bx = u(0.83), by = v(0.4);
  blit(cv, A, ax, ay);
  blit(cv, B, bx, by, { flip: true });
  // Waterfalls pour off each island's inner grass lip down into the cloud sea.
  // The lip is found on the island sprite itself: the first column in from the
  // inner edge whose topmost lime-grass pixel sits on the soil (not a tree).
  const lime = (d, i) => d[i + 3] && d[i + 1] > 170 && d[i] > 120 && d[i + 2] < 90;
  const lip = (spr, fromRight) => {
    for (let k = 2; k < spr.w / 3; k++) {
      const x = fromRight ? spr.w - 1 - k : k;
      for (let y = 0; y < spr.h; y++) {
        const i = (y * spr.w + x) * 4;
        if (!spr.d[i + 3]) continue;
        if (lime(spr.d, i)) {
          // Soil within a few rows below means this is the ground, not foliage.
          for (let d = 2; d < 8; d++) { const j = ((y + d) * spr.w + x) * 4; if (spr.d[j + 3] && spr.d[j] > spr.d[j + 1] + 30) return { x, y }; }
        }
        break;
      }
    }
    return null;
  };
  const falls = [], seaY = v(0.73);
  const la = lip(A, true), lb = lip(B, true); // B is drawn flipped, so its right side faces in
  if (la) falls.push({ x: ax + la.x - 8, y: ay + la.y + 1, w: 7 });
  if (lb) falls.push({ x: bx + (B.w - 1 - lb.x) + 2, y: by + lb.y + 1, w: 6 });
  for (const f of falls) f.h = seaY - f.y;
  return { cv, falls };
}

async function buildFar(isles) {
  const cv = new Canvas(FULL_W / FAR_PX, Math.ceil(FULL_H / FAR_PX));
  const u = f => Math.round((WIN.far.x0 + (WIN.far.x1 - WIN.far.x0) * f) / FAR_PX);
  const v = f => Math.round((WIN.far.y0 + (WIN.far.y1 - WIN.far.y0) * f) / FAR_PX);
  const haze = hex('#bfe6e0');
  const farMist = hazed(CLOUD, '#bfe7de', 0.22);
  cloudSea(cv, 49, v(0.6), farMist, { puffMin: 7, puffMax: 16, amp: 16, rows: 3, rowGap: 20 });
  const a = isles.a, b = isles.b, [s1, , s3] = isles.islets;
  blit(cv, b, u(0.08) - b.w / 2, v(0.3), { tint: haze, t: 0.45 });
  blit(cv, a, u(0.95) - a.w / 2, v(0.26), { tint: haze, t: 0.45, flip: true });
  blit(cv, s3, u(0.3) - s3.w / 2, v(0.47), { tint: haze, t: 0.5 });
  blit(cv, s1, u(0.72) - s1.w / 2, v(0.44), { tint: haze, t: 0.5, flip: true });
  return cv;
}

// The cloud sea the arena floats in. The static image holds frame 0 plus the
// solid body below; an animated part plays the billowing strip on top.
function buildSea() {
  const W = FULL_W / SEA_PX, H = FULL_H / SEA_PX;
  const y = Math.round((WIN.near.y0 + (WIN.near.y1 - WIN.near.y0) * 0.66) / SEA_PX);
  const frames = [];
  for (let f = 0; f < SEA_FRAMES; f++) {
    const cv = new Canvas(W, H);
    cloudSea(cv, 75, y, CLOUD, { puffMin: 8, puffMax: 20, amp: 23, rows: 4, rowGap: 35, phase: f / SEA_FRAMES, breathe: 1, sway: 1 });
    frames.push(cv);
  }
  // Rows that ever differ between frames form the animated strip.
  let y0 = H, y1 = 0;
  for (let yy = 0; yy < H; yy++) for (let x = 0; x < W; x++) {
    const i = (yy * W + x) * 4;
    for (const f of frames) if (f.d[i] !== frames[0].d[i] || f.d[i + 1] !== frames[0].d[i + 1] || f.d[i + 3] !== frames[0].d[i + 3]) { y0 = Math.min(y0, yy); y1 = Math.max(y1, yy); break; }
  }
  y0 = Math.max(0, y0 - 2); y1 = Math.min(H - 1, y1 + 2);
  const strips = frames.map(f => {
    const s = new Canvas(W, y1 - y0 + 1);
    s.d.set(f.d.subarray(y0 * W * 4, (y1 + 1) * W * 4));
    return s;
  });
  return { base: frames[0], strips, y0 };
}

// Smooth sky: gradient, sun glow, and blurred distant island silhouettes and
// cloud banks. Not on a pixel grid; filtered linearly in the game.
async function buildSky(isles) {
  const W = FULL_W, H = FULL_H, img = Buffer.alloc(W * H * 4);
  const stops = [[0, '#1586bd'], [0.28, '#25a4d0'], [0.55, '#4cc4dc'], [0.75, '#86dcdc'], [0.9, '#bdeed8'], [1, '#d6f3d6']].map(([t, c]) => [t, hex(c)]);
  const yTop = WIN.sky.y0, yBot = WIN.sky.y1;
  const sx = W * 0.8, sy = yTop + (yBot - yTop) * 0.11;
  for (let y = 0; y < H; y++) {
    const t = Math.min(1, Math.max(0, (y - yTop) / (yBot - yTop)));
    let k = 0; while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const f = (t - stops[k][0]) / (stops[k + 1][0] - stops[k][0]);
    const base = mix(stops[k][1], stops[k + 1][1], Math.min(1, Math.max(0, f)));
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - sx, y - sy);
      const glow = Math.exp(-((d / 230) ** 2)) * 0.55 + Math.exp(-((d / 520) ** 2)) * 0.2;
      let c = mix(base, hex('#fff4c8'), Math.min(1, glow));
      if (d < 34) c = hex('#fffbe8'); else if (d < 40) c = mix(c, hex('#fffbe8'), (40 - d) / 6);
      const i = (y * W + x) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
    }
  }
  // Distant figures: blurred, sky-tinted islands and soft cloud banks.
  const ghost = hex('#8fcfdc');
  const shapes = [];
  const sil = async (src, w, x, y, t, blur, flip = false) => {
    const scaled = await sharp(Buffer.from(src.d.buffer), { raw: { width: src.w, height: src.h, channels: 4 } })
      .resize(Math.round(w), Math.round(w * src.h / src.w), { kernel: 'nearest' }).flop(flip).raw().toBuffer({ resolveWithObject: true });
    const d = scaled.data;
    for (let i = 0; i < d.length; i += 4) { const c = mix([d[i], d[i + 1], d[i + 2]], ghost, t); d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = Math.round(d[i + 3] * 0.85); }
    shapes.push({ input: await sharp(d, { raw: scaled.info }).blur(blur).png().toBuffer(), left: Math.round(x), top: Math.round(y) });
  };
  const yy = f => yTop + (yBot - yTop) * f;
  await sil(isles.b, 330, 160, yy(0.4), 0.72, 5);
  await sil(isles.a, 280, 1000, yy(0.47), 0.75, 6, true);
  await sil(isles.islets[0], 90, 590, yy(0.36), 0.8, 3);
  await sil(isles.islets[2], 120, 860, yy(0.3), 0.8, 3, true);
  // Soft cloud banks along the horizon.
  const bank = new Canvas(W / 4, 90);
  for (let k = 0; k < 26; k++) puff(bank, Math.round(k * 15.5 + (k % 3) * 4), 60 + (k % 2) * 8, 16 + (k * 7) % 11, { rim: hex('#ffffff'), light: hex('#f6fbf0'), mid: hex('#e4f4ec'), shade: hex('#cdeae6'), deep: hex('#c0e4e2') });
  shapes.push({ input: await sharp(Buffer.from(bank.d.buffer), { raw: { width: bank.w, height: bank.h, channels: 4 } }).resize(W, 360).blur(14).png().toBuffer(), left: 0, top: Math.round(yy(0.72)) });
  return sharp(img, { raw: { width: W, height: H, channels: 4 } }).composite(shapes).removeAlpha();
}

// ================================================================== main
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const a = await pixelate(path.join(SRC, 'island-a.png')), b = await pixelate(path.join(SRC, 'island-b.png')), s = await pixelate(path.join(SRC, 'islets.png'));
  console.log('detected grids', a.grid, b.grid, s.grid);
  const isles = { a: trim(a.cv), b: trim(b.cv), islets: pieces(s.cv) };
  isles.islets.sort((p, q) => p.w - q.w);
  isles.islets = [isles.islets[1], isles.islets[0], isles.islets[2]]; // pine islet, bare rock, blossom islet

  const save = (cv, px, file, h) => sharp(Buffer.from(cv.d.buffer), { raw: { width: cv.w, height: cv.h, channels: 4 } })
    .resize(cv.w * px, cv.h * px, { kernel: 'nearest' }).raw().toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => sharp(data, { raw: info }).extract({ left: 0, top: 0, width: info.width, height: Math.min(h ?? info.height, info.height) }).webp({ lossless: true, effort: 6 }).toFile(path.join(OUT, file)));

  await (await buildSky(isles)).webp({ quality: 92 }).toFile(path.join(OUT, 'sky-v4.webp'));
  await save(await buildFar(isles), FAR_PX, 'far-isles-v4.webp', FULL_H);
  const near = await buildNear(isles);
  await save(near.cv, NEAR_PX, 'near-isles-v4.webp', FULL_H);
  const sea = buildSea();
  // The sea layer image is stored at native size; the runtime's cover fit then
  // scales it exactly 2x, matching the near layer, and the part frames stay small.
  await sharp(Buffer.from(sea.base.d.buffer), { raw: { width: sea.base.w, height: sea.base.h, channels: 4 } }).webp({ lossless: true, effort: 6 }).toFile(path.join(OUT, 'cloud-sea.webp'));
  const seaSheet = await sheet(sea.strips, 1, path.join(OUT, 'cloud-sea-anim.webp'));
  const fallParts = [];
  for (const [k, f] of near.falls.entries()) {
    const frames = waterfallFrames(f.w, f.h);
    const meta = await sheet(frames, NEAR_PX, path.join(OUT, `waterfall-${k + 1}.webp`));
    fallParts.push({ url: `/assets/sky-soil/waterfall-${k + 1}.webp`, ...meta, frameRate: FALL_FPS, frames: frames.map((_, i) => i),
      x: (f.x - 4 + frames[0].w / 2) * NEAR_PX, y: (f.y + frames[0].h / 2) * NEAR_PX });
  }
  const seaPart = { url: '/assets/sky-soil/cloud-sea-anim.webp', ...seaSheet, frameRate: SEA_FPS, frames: sea.strips.map((_, i) => i),
    x: sea.base.w / 2, y: sea.y0 + sea.strips[0].h / 2 };
  // Lobby background: flattened still of every layer.
  await sharp(path.join(OUT, 'sky-v4.webp')).composite([
    { input: path.join(OUT, 'far-isles-v4.webp') },
    { input: await sharp(path.join(OUT, 'cloud-sea.webp')).resize(FULL_W, FULL_H, { kernel: 'nearest' }).png().toBuffer() },
    { input: path.join(OUT, 'near-isles-v4.webp') },
  ]).webp({ quality: 90 }).toFile(path.join(OUT, 'background.webp'));
  fs.writeFileSync(path.join(OUT, 'parts.json'), JSON.stringify({ seaPart, fallParts }, null, 2));
  console.log('wrote', OUT);
  if (!INSTALL) return;

  const dest = path.join(ROOT, 'public/assets/sky-soil');
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.webp')) fs.copyFileSync(path.join(OUT, f), path.join(dest, f));
  for (const file of ['src/shared/maps/2.json', 'data/maps/2.json']) {
    const full = path.join(ROOT, file), m = JSON.parse(fs.readFileSync(full, 'utf8'));
    const layers = m.scenery.layers, byId = id => layers.find(l => l.id === id);
    const sky = byId('sky'); sky.url = '/assets/sky-soil/sky-v4.webp'; delete sky.filter;
    const far = byId('far-peaks'); far.url = '/assets/sky-soil/far-isles-v4.webp'; far.filter = 'nearest';
    const near = byId('forest-ridges'); near.url = '/assets/sky-soil/near-isles-v4.webp'; near.filter = 'nearest'; near.parts = fallParts;
    const seaLayer = { id: 'cloud-sea', url: '/assets/sky-soil/cloud-sea.webp', scroll: near.scroll, fit: near.fit, y: near.y, filter: 'nearest', parts: [seaPart] };
    const i = layers.findIndex(l => l.id === 'cloud-sea');
    if (i >= 0) layers[i] = seaLayer; else layers.splice(layers.indexOf(near), 0, seaLayer);
    m.metadata.lobbyBgAsset = '/assets/sky-soil/background.webp';
    fs.writeFileSync(full, JSON.stringify(m, null, 2) + '\n');
  }
  console.log('installed');
})().catch(e => { console.error(e); process.exit(1); });
