#!/usr/bin/env node
// Sky Soil's main island, redrawn to match the small floating platforms.
//
//   node scripts/art/sky-soil/main-platform.cjs [--out <dir>] [--install]
//
// The small platform (small-platform-sharp.webp, 0.4x) is drawn on a 5-texture-
// pixel grid, i.e. 2 world px per art pixel, with lime grass over warm brown
// soil. This draws the main island on the same 2-world-px grid and palette, with
// extra texture: soil strata, embedded stone slabs, roots and vines.
//
// The silhouette comes from the previous island art (so the grassy ledges stay
// on the unchanged invisible collision rows), opened to drop plant overhangs and
// stray specks. Output keeps the 1100x680 world frame of the old island layer.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../../..');
const argv = process.argv.slice(2);
const OUT = path.resolve(argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : path.join(ROOT, 'output/sky-soil-platform'));
const INSTALL = argv.includes('--install');
const SRC = path.join(__dirname, 'platform-masks');

const WORLD_W = 1100, WORLD_H = 680, CELL = 2, UP = 3; // 2 world px per art pixel, 3 texture px per art pixel
const W = WORLD_W / CELL, H = WORLD_H / CELL;

const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
// Sampled from small-platform-sharp.webp.
const P = {
  grassTop: hex('#d7ea66'), grassHi: hex('#c9e536'), grass: hex('#bbdd08'), grassMid: hex('#a4c447'),
  grassLow: hex('#90a030'), grassEdge: hex('#66991e'), grassDark: hex('#476b15'),
  rim: hex('#ba6b42'), soilHi: hex('#9f592e'), soil: hex('#8c4a1f'), soilMid: hex('#83451e'),
  soilLow: hex('#783f1c'), soilDeep: hex('#6f3e20'), soilDark: hex('#623416'), base: hex('#542c14'),
  speck: hex('#c68664'), stone: hex('#b07754'), stoneLo: hex('#9b5a34'),
};

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
function noise1(seed, scale) {
  const r = rng(seed), table = Array.from({ length: 1024 }, () => r() * 2 - 1);
  return x => {
    const p = x / scale, i = Math.floor(p), f = p - i, u = f * f * (3 - 2 * f);
    const a = table[((i % 1024) + 1024) % 1024], b = table[(((i + 1) % 1024) + 1024) % 1024];
    return a + (b - a) * u;
  };
}

// Old island alpha -> art-pixel mask, then morphological opening to drop ferns,
// grass blades and dangling vines while keeping the ledges and lobed underside.
async function loadMask(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sx = info.width / W, sy = info.height / H;
  let m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let on = 0, n = 0;
    for (let yy = Math.floor(y * sy); yy < Math.floor((y + 1) * sy); yy++) for (let xx = Math.floor(x * sx); xx < Math.floor((x + 1) * sx); xx++) {
      n++; if (data[(yy * info.width + xx) * 4 + 3] > 127) on++;
    }
    m[y * W + x] = on * 2 > n ? 1 : 0;
  }
  const morph = (src, r, erode) => {
    const out = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let v = erode ? 1 : 0;
      for (let dy = -r; dy <= r && v === (erode ? 1 : 0); dy++) for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r + r) continue;
        const X = x + dx, Y = y + dy, s = X >= 0 && Y >= 0 && X < W && Y < H ? src[Y * W + X] : 0;
        if (erode && !s) { v = 0; break; }
        if (!erode && s) { v = 1; break; }
      }
      out[y * W + x] = v;
    }
    return out;
  };
  const opened = morph(morph(m, 7, true), 7, false);
  // Opening rounds the ledge corners; restore the original mask wherever a
  // pixel is within the opened shape's horizontal span on a ledge row.
  for (let i = 0; i < m.length; i++) if (m[i] && !opened[i]) {
    const x = i % W, y = (i / W) | 0;
    let support = 0;
    for (let d = 1; d <= 6; d++) if (y + d < H && opened[(y + d) * W + x]) support++;
    if (support >= 5 && x > 0 && x < W - 1 && (opened[i - 1] || opened[i + 1] || support === 6)) opened[i] = 1;
  }
  return flattenTops(keepLargest(opened));
}

// Ledge tops wobble by a cell or two after resampling; snap each column's top
// to the median of its neighbours unless the change is a real ledge step.
function flattenTops(m) {
  const top = Array.from({ length: W }, (_, x) => { for (let y = 0; y < H; y++) if (m[y * W + x]) return y; return -1; });
  const out = new Uint8Array(m);
  for (let x = 0; x < W; x++) {
    if (top[x] < 0) continue;
    const win = [];
    for (let d = -5; d <= 5; d++) if (top[x + d] >= 0 && Math.abs(top[x + d] - top[x]) <= 3) win.push(top[x + d]);
    win.sort((a, b) => a - b);
    const t = win[win.length >> 1];
    if (t === top[x]) continue;
    for (let y = Math.min(t, top[x]); y < Math.max(t, top[x]); y++) out[y * W + x] = y >= t ? 1 : 0;
  }
  return out;
}

function keepLargest(m) {
  const seen = new Uint8Array(W * H); let best = [];
  for (let s = 0; s < m.length; s++) {
    if (seen[s] || !m[s]) continue;
    const q = [s]; seen[s] = 1;
    for (let h = 0; h < q.length; h++) {
      const v = q[h], x = v % W, y = (v / W) | 0;
      for (const n of [x > 0 ? v - 1 : -1, x < W - 1 ? v + 1 : -1, y > 0 ? v - W : -1, y < H - 1 ? v + W : -1])
        if (n >= 0 && !seen[n] && m[n]) { seen[n] = 1; q.push(n); }
    }
    if (q.length > best.length) best = q;
  }
  const out = new Uint8Array(W * H);
  for (const v of best) out[v] = 1;
  return out;
}

function draw(mask, seed) {
  const r = rng(seed), img = new Uint8ClampedArray(W * H * 4);
  const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && mask[y * W + x] === 1;
  const set = (x, y, c, any = false) => {
    if (x < 0 || y < 0 || x >= W || y >= H || (!any && !on(x, y))) return;
    const i = (y * W + x) * 4; img[i] = c[0]; img[i + 1] = c[1]; img[i + 2] = c[2]; img[i + 3] = 255;
  };
  const get = (x, y) => { const i = (y * W + x) * 4; return img[i + 3] ? [img[i], img[i + 1], img[i + 2]] : null; };
  const fromTop = new Int16Array(W * H), toBot = new Int16Array(W * H);
  for (let x = 0; x < W; x++) {
    let d = 0;
    for (let y = 0; y < H; y++) { d = on(x, y) ? d + 1 : 0; fromTop[y * W + x] = d - 1; }
    d = 0;
    for (let y = H - 1; y >= 0; y--) { d = on(x, y) ? d + 1 : 0; toBot[y * W + x] = d - 1; }
  }
  // Broad two-tone strata with long, stepped boundaries (held for 3-cell runs).
  const wave = noise1(seed + 1, 55), wave2 = noise1(seed + 2, 23);
  const BAND = 16;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!on(x, y)) continue;
    const hx = x - (x % 3);
    const wy = y + Math.round(wave(hx) * 6 + wave2(hx) * 2);
    const band = Math.floor(wy / BAND), inBand = ((wy % BAND) + BAND) % BAND;
    const below = toBot[y * W + x];
    let c = band % 2 ? P.soilLow : P.soil;
    if (band % 2 === 0 && inBand < 2) c = P.soilHi;
    if (below < 30) c = band % 2 ? P.soilDeep : P.soilMid;
    if (below < 16) c = band % 2 ? P.soilDeep : P.soilLow;
    if (below < 7) c = P.soilDark;
    if (below < 3) c = P.base;
    set(x, y, c);
  }
  // Rims like the small platform: light left walls, dark right walls.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!on(x, y) || toBot[y * W + x] < 3) continue;
    if (!on(x - 1, y)) { set(x, y, P.rim); set(x + 1, y, P.rim); set(x + 2, y, P.soilHi); }
    else if (!on(x + 1, y)) { set(x, y, P.soilDark); set(x - 1, y, P.soilDeep); }
  }
  // Big rounded stones with dark outlines and a lit top, as in the BB islands.
  const stones = [];
  for (let k = 0; k < 600 && stones.length < 13; k++) {
    const w = 14 + Math.floor(r() * 10), h = 8 + Math.floor(r() * 4);
    const x = 4 + Math.floor(r() * (W - w - 8)), y = 4 + Math.floor(r() * (H - h - 8));
    let ok = true;
    for (let dy = -2; dy <= h + 2 && ok; dy++) for (let dx = -2; dx <= w + 1; dx++)
      if (!on(x + dx, y + dy) || fromTop[(y + dy) * W + x + dx] < 10 || toBot[(y + dy) * W + x + dx] < 8) { ok = false; break; }
    if (!ok || stones.some(s => Math.abs(s.x - x) < 40 && Math.abs(s.y - y) < 24)) continue;
    stones.push({ x, y, w, h });
  }
  // Rounded slab: ellipse-ish outline, lit top-left, shaded bottom-right.
  for (const { x, y, w, h } of stones) {
    const cx = (w - 1) / 2, cy = (h - 1) / 2;
    const inside = (dx, dy) => ((dx - cx) / (cx + 0.5)) ** 4 + ((dy - cy) / (cy + 0.5)) ** 4 <= 1;
    for (let dy = 0; dy < h; dy++) for (let dx = 0; dx < w; dx++) {
      if (!inside(dx, dy)) continue;
      const edge = !inside(dx - 1, dy) || !inside(dx + 1, dy) || !inside(dx, dy - 1) || !inside(dx, dy + 1);
      let c = P.stone;
      if (edge) c = P.base;
      else if (!inside(dx, dy - 2) || !inside(dx - 2, dy)) c = P.speck;
      else if (!inside(dx, dy + 2) || !inside(dx + 2, dy)) c = P.stoneLo;
      set(x + dx, y + dy, c);
    }
    for (let dx = 2; dx < w - 2; dx++) if (inside(dx, h - 1)) set(x + dx, y + h, P.soilDark);
  }
  // Small pebbles and speckles.
  for (let k = 0; k < 900; k++) {
    const x = Math.floor(r() * (W - 3)), y = Math.floor(r() * (H - 3));
    if (!on(x, y) || fromTop[y * W + x] < 9 || toBot[y * W + x] < 6) continue;
    const c0 = get(x, y), c1 = get(x + 2, y + 1);
    if (!c0 || !c1 || c0[0] === P.stone[0] || c0[0] === P.base[0] || c1[0] === P.base[0] || c1[0] === P.stone[0]) continue;
    if (r() < 0.1) { set(x, y, P.speck); set(x + 1, y, P.stone); set(x, y + 1, P.stoneLo); set(x + 1, y + 1, P.soilDark); }
    else { set(x, y, P.soilDeep); if (r() < 0.5) set(x + 1, y, P.soilDeep); if (r() < 0.3) set(x, y + 1, P.soilDark); }
  }
  // Grass caps: 6 cells, like the small platform's band, with drips below.
  const grassTopY = new Int16Array(W).fill(-1);
  for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) {
    if (!on(x, y) || on(x, y - 1)) continue;
    let span = 1;
    for (let d = 1; d < 4; d++) { if (on(x - d, y) && !on(x - d, y - 1)) span++; if (on(x + d, y) && !on(x + d, y - 1)) span++; }
    if (span < 2) continue;
    if (grassTopY[x] < 0) grassTopY[x] = y;
    for (let d = 0; d < 6; d++) set(x, y + d, d === 0 ? P.grassHi : d < 4 ? P.grass : d === 4 ? P.grassLow : P.grassEdge);
    const drip = (x * 7 + y) % 11;
    if (drip < 3) set(x, y + 6, P.grassEdge);
    if (drip === 0) set(x, y + 7, P.grassEdge);
  }
  // Grass runs a little way down each ledge wall.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!on(x, y) || fromTop[y * W + x] < 6 || fromTop[y * W + x] > 9) continue;
    if (!on(x - 1, y) || !on(x + 1, y)) set(x, y, P.grassEdge);
  }
  // Grass bumps standing on top, as on the small platform.
  for (let x = 3; x < W - 8; x++) {
    const y = grassTopY[x];
    if (y < 1 || r() > 0.035) continue;
    const w = 4 + Math.floor(r() * 5);
    let flat = true;
    for (let dx = -1; dx <= w; dx++) if (grassTopY[x + dx] !== y) flat = false;
    if (!flat) continue;
    for (let dx = 0; dx < w; dx++) { set(x + dx, y - 1, P.grassHi, true); set(x + dx, y - 2, dx === 0 || dx === w - 1 ? P.grassHi : P.grassTop, true); }
    x += w + 6;
  }
  // Leafy vines down the faces.
  const vineCols = [];
  for (let k = 0; k < 200 && vineCols.length < 9; k++) {
    const x = 8 + Math.floor(r() * (W - 16));
    if (grassTopY[x] < 0 || vineCols.some(v => Math.abs(v - x) < 30)) continue;
    vineCols.push(x);
  }
  for (const x0 of vineCols) {
    let x = x0, y = grassTopY[x0] + 6;
    const len = 16 + Math.floor(r() * 30);
    const leaf = (lx, ly) => { set(lx, ly, P.grass); set(lx + 1, ly, P.grass); set(lx, ly + 1, P.grassMid); set(lx + 1, ly + 1, P.grassLow); set(lx, ly - 1, P.grassHi); };
    for (let s = 0; s < len && on(x, y + 2) && toBot[y * W + x] > 5; s++, y++) {
      set(x, y, P.grassEdge); set(x + 1, y, P.grassLow);
      if (s % 6 === 2) leaf(x - 2, y);
      if (s % 6 === 5) leaf(x + 2, y);
    }
    leaf(x - 1, y);
  }
  // Branching roots hanging below the underside.
  for (let k = 0, made = 0; k < 300 && made < 7; k++) {
    const x0 = 20 + Math.floor(r() * (W - 40));
    let y = H - 1;
    while (y > 0 && !on(x0, y)) y--;
    if (y < H * 0.45 || !on(x0, y) || on(x0, y + 1)) continue;
    made++;
    let x = x0;
    const len = 10 + Math.floor(r() * 14);
    for (let s = 1; s <= len; s++) {
      set(x, y + s, P.soilLow, true); set(x + 1, y + s, s % 3 ? P.soilDeep : P.soilDark, true); set(x + 2, y + s, P.base, true);
      if (s === Math.floor(len / 2)) for (let b = 1; b <= 5; b++) { set(x - b, y + s + b, P.soilLow, true); set(x - b + 1, y + s + b, P.soilDeep, true); }
      if (r() < 0.2) x += r() < 0.5 ? -1 : 1;
    }
  }
  return img;
}

async function build(maskFile, outFile, seed) {
  const mask = await loadMask(maskFile);
  const img = draw(mask, seed);
  await sharp(Buffer.from(img.buffer), { raw: { width: W, height: H, channels: 4 } })
    .resize(W * UP, H * UP, { kernel: 'nearest' }).webp({ lossless: true, effort: 6 }).toFile(outFile);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // Built-in layout (original pillar height) and the saved Map Studio layout.
  await build(path.join(SRC, 'builtin.webp'), path.join(OUT, 'island-v4.webp'), 301);
  await build(path.join(SRC, 'saved.webp'), path.join(OUT, 'island-saved-v4.webp'), 301);
  console.log('wrote', OUT);
  if (!INSTALL) return;
  const dest = path.join(ROOT, 'public/assets/sky-soil');
  for (const f of ['island-v4.webp', 'island-saved-v4.webp']) fs.copyFileSync(path.join(OUT, f), path.join(dest, f));
  for (const [file, name] of [['src/shared/maps/2.json', 'island-v4.webp'], ['data/maps/2.json', 'island-saved-v4.webp']]) {
    const full = path.join(ROOT, file), m = JSON.parse(fs.readFileSync(full, 'utf8'));
    const base = m.scenery.layers.find(l => l.id === 'island-base');
    base.url = '/assets/sky-soil/' + name;
    base.scale = WORLD_W / (W * UP);
    base.filter = 'nearest';
    fs.writeFileSync(full, JSON.stringify(m, null, 2) + '\n');
  }
  console.log('installed');
})().catch(e => { console.error(e); process.exit(1); });
