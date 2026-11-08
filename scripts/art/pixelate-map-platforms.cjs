#!/usr/bin/env node
// Redraw Mangrove Meadow, Serenity and Candy Land platforms as code pixel art
// following docs/art/code-pixel-art.md: trace each original onto a chunky grid
// sized from its map scale, take the mode of palette-snapped colours per cell,
// clean the silhouette, add a dark outline with a lit top-left rim and a
// two-step bottom-right shadow, then nearest-neighbour upscale back to the
// exact installed texture size.
// Usage: node scripts/art/pixelate-map-platforms.cjs [--install]
// Originals are kept in scripts/art/<map>-originals as tracing sources.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../spritesheet-generator/node_modules/sharp');

const ROOT = path.resolve(__dirname, '../..');
const ASSETS = path.join(ROOT, 'public/assets');
const OUT = path.join(ROOT, 'output/platform-pixel');
const install = process.argv.includes('--install');

// Target on-screen art-pixel size, from the approved Lushy large ledge.
const TARGET = 1.8;
// [file, map scale]; pixel size = round((target ?? TARGET) / scale).
// Mangrove and Serenity use a fine grid to keep the detailed pixel look of
// the original Serenity art.
const MAPS = {
  mangrove: { originals: 'mangrove-repaint', colours: 36, outline: 0.7, items: [
    ['baseMiddle', 0.6], ['baseTop', 0.6], ['baseLeft', 0.6], ['baseRight', 0.6],
    ['lobbyPlatform', 0.4],
  ] },
  serenity: { originals: 'serenity-redesign', colours: 36, outline: 0.7, items: [
    ['largePlatform', 0.45], ['sidePlatform', 0.8], ['smallRock', 0.45], ['logPlatform', 0.6],
    // Lobby art is shown near native size; 3 texture px per art pixel.
    ['lobbyPlatform', 0.6],
  ] },
  candyland: { originals: 'candyland-originals', colours: 34, items: [
    ['platform-base', 0.3456], ['platform-tall', 0.3345], ['platform-top-arch', 0.518],
    ['platform-moving', 0.4321],
  ] },
};

const lum = (c) => c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
const dist = (a, b) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * 0.3 + dg * dg * 0.55 + db * db * 0.15;
};
function nearest(c, pal) {
  let best = 0, s = Infinity;
  for (let i = 0; i < pal.length; i++) { const d = dist(c, pal[i]); if (d < s) { s = d; best = i; } }
  return best;
}

// Deterministic median-cut palette shared by every texture of a map.
function medianCut(pixels, count) {
  let boxes = [pixels];
  while (boxes.length < count) {
    let bi = -1, range = -1, ch = 0;
    boxes.forEach((b, i) => {
      if (b.length < 2) return;
      for (let c = 0; c < 3; c++) {
        let lo = 255, hi = 0;
        for (const p of b) { if (p[c] < lo) lo = p[c]; if (p[c] > hi) hi = p[c]; }
        if (hi - lo > range) { range = hi - lo; bi = i; ch = c; }
      }
    });
    if (bi < 0 || range < 6) break;
    const b = boxes[bi].sort((x, y) => x[ch] - y[ch]);
    const mid = b.length >> 1;
    boxes.splice(bi, 1, b.slice(0, mid), b.slice(mid));
  }
  return boxes.map((b) => {
    const s = [0, 0, 0];
    for (const p of b) { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }
    return s.map((v) => Math.round(v / b.length));
  });
}

function shade(c, f, pal) {
  const t = f > 1 ? c.map((v) => v + (255 - v) * (f - 1)) : c.map((v) => v * f);
  return nearest(t, pal);
}

function trace(img, p, pal) {
  const { data, width: W, height: H } = img;
  const gw = Math.ceil(W / p), gh = Math.ceil(H / p);
  const solid = new Uint8Array(gw * gh);
  const col = new Int16Array(gw * gh).fill(-1);
  const counts = new Map();
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    let opaque = 0, total = 0;
    counts.clear();
    for (let y = gy * p; y < Math.min(H, gy * p + p); y++) for (let x = gx * p; x < Math.min(W, gx * p + p); x++) {
      total++;
      const i = (y * W + x) * 4;
      if (data[i + 3] < 128) continue;
      opaque++;
      const k = nearest([data[i], data[i + 1], data[i + 2]], pal);
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    const g = gy * gw + gx;
    if (opaque * 2 > total) {
      solid[g] = 1;
      let best = -1, n = -1;
      for (const [k, v] of counts) if (v > n || (v === n && k < best)) { best = k; n = v; }
      col[g] = best;
    }
  }
  return { gw, gh, solid, col };
}

function cleanSilhouette(t) {
  const { gw, gh, solid } = t;
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : solid[y * gw + x]);
  // Fill enclosed holes: flood empty space from the border.
  const outside = new Uint8Array(gw * gh);
  const stack = [];
  for (let x = 0; x < gw; x++) stack.push([x, 0], [x, gh - 1]);
  for (let y = 0; y < gh; y++) stack.push([0, y], [gw - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
    const g = y * gw + x;
    if (outside[g] || solid[g]) continue;
    outside[g] = 1;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Only small enclosed holes are filled; large ones are real openings,
  // such as the gaps between a bridge's legs.
  const hole = new Uint8Array(gw * gh);
  for (let g0 = 0; g0 < gw * gh; g0++) {
    if (solid[g0] || outside[g0] || hole[g0]) continue;
    const cells = [], st = [g0]; hole[g0] = 1;
    while (st.length) {
      const c = st.pop(); cells.push(c);
      const x = c % gw, y = (c / gw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy, ng = ny * gw + nx;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || solid[ng] || outside[ng] || hole[ng]) continue;
        hole[ng] = 1; st.push(ng);
      }
    }
    if (cells.length <= 40) for (const c of cells) solid[c] = 2;
  }
  // Remove lone pixels and one-cell spikes; fill one-cell notches.
  for (let pass = 0; pass < 2; pass++) {
    const next = solid.slice();
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      const n4 = (at(x + 1, y) ? 1 : 0) + (at(x - 1, y) ? 1 : 0) + (at(x, y + 1) ? 1 : 0) + (at(x, y - 1) ? 1 : 0);
      const g = y * gw + x;
      if (solid[g] && n4 <= 1) next[g] = 0;
      else if (!solid[g] && n4 >= 3) next[g] = 2;
    }
    solid.set(next);
  }
  // Drop small loose pieces (stray specks), keep anything substantial.
  const seen = new Int32Array(gw * gh).fill(-1);
  const sizes = [];
  for (let g = 0; g < gw * gh; g++) {
    if (!solid[g] || seen[g] >= 0) continue;
    const id = sizes.length; let n = 0;
    const st = [g]; seen[g] = id;
    while (st.length) {
      const c = st.pop(); n++;
      const x = c % gw, y = (c / gw) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ng = ny * gw + nx;
        if (solid[ng] && seen[ng] < 0) { seen[ng] = id; st.push(ng); }
      }
    }
    sizes.push(n);
  }
  const keep = Math.max(...sizes, 0) * 0.01 + 4;
  for (let g = 0; g < gw * gh; g++) if (solid[g] && sizes[seen[g]] < keep) solid[g] = 0;
}

// outline: how dark the silhouette edge is, as a multiple of the edge colour
// (0.32 is near-black; Serenity uses a soft 0.7).
function finishColours(t, pal, outline = 0.32) {
  const { gw, gh, solid, col } = t;
  const at = (x, y) => (x < 0 || y < 0 || x >= gw || y >= gh ? 0 : solid[y * gw + x]);
  const c = (x, y) => col[y * gw + x];
  // Filled cells take the mode of their solid neighbours.
  const modeAround = (x, y) => {
    const m = new Map();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (at(x + dx, y + dy) && c(x + dx, y + dy) >= 0) m.set(c(x + dx, y + dy), (m.get(c(x + dx, y + dy)) || 0) + 1);
    }
    let best = -1, n = 0;
    for (const [k, v] of m) if (v > n || (v === n && k < best)) { best = k; n = v; }
    return [best, n];
  };
  for (let pass = 0; pass < 3; pass++) for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (at(x, y) && c(x, y) < 0) { const [m] = modeAround(x, y); if (m >= 0) col[y * gw + x] = m; }
  }
  for (let g = 0; g < gw * gh; g++) if (solid[g] && col[g] < 0) col[g] = 0;
  // De-speckle: a lone colour surrounded by one dominant colour joins it.
  const next = col.slice();
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!at(x, y)) continue;
    const self = c(x, y);
    const same = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => at(x + dx, y + dy) && c(x + dx, y + dy) === self);
    if (same) continue;
    const [m, n] = modeAround(x, y);
    if (m >= 0 && n >= 5) next[y * gw + x] = m;
  }
  col.set(next);
  // Light from the top left: outline, highlight rim, two-step shadow rim.
  // Art that runs off the texture edge continues into a neighbouring tile,
  // so the border counts as solid there and gets no outline.
  const at2 = (x, y) => at(Math.min(gw - 1, Math.max(0, x)), Math.min(gh - 1, Math.max(0, y)));
  const out = col.slice();
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    const g = y * gw + x;
    if (!solid[g]) continue;
    const base = pal[col[g]];
    const edge = !at2(x + 1, y) || !at2(x - 1, y) || !at2(x, y + 1) || !at2(x, y - 1);
    if (edge) {
      const k = lum(base) < 50 ? Math.max(0.6, outline) : outline;
      out[g] = nearest(base.map((v) => v * k), pal);
    } else if (!at2(x - 2, y) || !at2(x, y - 2)) {
      out[g] = shade(base, 1.18, pal);
    } else if (!at2(x + 2, y) || !at2(x, y + 2)) {
      out[g] = shade(base, 0.72, pal);
    } else if (!at2(x + 3, y) || !at2(x, y + 3)) {
      out[g] = shade(base, 0.86, pal);
    }
  }
  col.set(out);
}

async function load(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

async function run() {
  fs.mkdirSync(OUT, { recursive: true });
  for (const [map, spec] of Object.entries(MAPS)) {
    if (process.env.ONLY_MAP && process.env.ONLY_MAP !== map) continue;
    const origDir = path.join(__dirname, spec.originals);
    fs.mkdirSync(origDir, { recursive: true });
    const imgs = [];
    for (const [name, scale] of spec.items) {
      const orig = path.join(origDir, `${name}.webp`);
      if (!fs.existsSync(orig)) fs.copyFileSync(path.join(ASSETS, map, `${name}.webp`), orig);
      imgs.push({ name, scale, img: await load(orig) });
    }
    const samples = [];
    for (const { img } of imgs) {
      const step = Math.max(1, Math.floor(Math.sqrt(img.width * img.height / 60000)));
      for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
        const i = (y * img.width + x) * 4;
        if (img.data[i + 3] >= 128) samples.push([img.data[i], img.data[i + 1], img.data[i + 2]]);
      }
    }
    const pal = medianCut(samples, spec.colours);
    // Add dark and light ramp ends so outlines and rims have somewhere to land.
    const outline = spec.outline ?? 0.32;
    for (const c of pal.slice()) { pal.push(c.map((v) => Math.round(v * outline))); pal.push(c.map((v) => Math.round(v + (255 - v) * 0.18))); }
    for (const { name, scale, img } of imgs) {
      const p = Math.max(2, Math.round((Number(process.env.PIXEL_TARGET) || spec.target || TARGET) / scale));
      const t = trace(img, p, pal);
      cleanSilhouette(t);
      finishColours(t, pal, outline);
      const buf = Buffer.alloc(img.width * img.height * 4);
      for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
        const g = ((y / p) | 0) * t.gw + ((x / p) | 0);
        if (!t.solid[g]) continue;
        const c = pal[t.col[g]], i = (y * img.width + x) * 4;
        buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
      }
      const target = install ? path.join(ASSETS, map, `${name}.webp`) : path.join(OUT, `${map}-${name}.webp`);
      await sharp(buf, { raw: { width: img.width, height: img.height, channels: 4 } })
        .webp({ lossless: true }).toFile(target);
      console.log(`${map}/${name} ${img.width}x${img.height} pixel ${p} (${(p * scale).toFixed(2)} screen px)`);
    }
  }
}
run().catch((e) => { console.error(e); process.exit(1); });
