#!/usr/bin/env node
// Rebuild Candy Land's painterly scenery on a deliberate screen-pixel grid.
// Existing platform linework receives only edge-safe palette cleanup.
// Usage: node scripts/art/pixelate-candyland.cjs [--install]
// Original scenery masters live beside this script for reproducible rebuilds.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../spritesheet-generator/node_modules/sharp');
const ROOT = path.resolve(__dirname, '../..');
const OUT = path.join(ROOT, 'output/candyland-pixel');
const SOURCE = path.join(__dirname, 'candyland-originals');
const INSTALLED = path.join(ROOT, 'public/assets/candyland');
// Pixel size is selected from texture scale: the floor renders at 0.557x,
// side props at roughly 0.7x, and the other layers at roughly native size.
const ITEMS = [
  ['background', 4, 28], ['lobby-background', 4, 32],
  ['peaks', 4, 28], ['midground-peaks', 4, 32],
  ['side-candy-left', 5, 32], ['side-candy-right', 5, 28],
  ['top', 4, 28], ['bottom', 8, 32],
  ['platform-base', 0, 48], ['platform-tall', 0, 48],
  ['platform-top-arch', 0, 48], ['platform-moving', 0, 36],
  ['lobby-platform', 0, 40],
];
const install = process.argv.includes('--install');
const rgb = (data, i) => [data[i], data[i + 1], data[i + 2]];
const dist = (a, b) => {
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return dr * dr * .28 + dg * dg * .56 + db * db * .16;
};
const nearest = (color, palette) => {
  let best = 0, score = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const d = dist(color, palette[i]);
    if (d < score) { score = d; best = i; }
  }
  return best;
};
function paletteFor(data, width, height, count) {
  const samples = [];
  const stride = Math.max(2, Math.floor(Math.sqrt(width * height / 40000)));
  for (let y = 0; y < height; y += stride) for (let x = 0; x < width; x += stride) {
    const i = (y * width + x) * 4;
    if (data[i + 3] >= 160) samples.push(rgb(data, i));
  }
  const palette = [samples[Math.floor(samples.length / 2)]];
  while (palette.length < count) {
    let far = samples[0], score = -1;
    for (let i = 0; i < samples.length; i += 3) {
      const c = samples[i], d = dist(c, palette[nearest(c, palette)]);
      if (d > score) { score = d; far = c; }
    }
    palette.push(far.slice());
  }
  for (let pass = 0; pass < 10; pass++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const c of samples) {
      const s = sums[nearest(c, palette)];
      s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++;
    }
    palette.forEach((p, i) => {
      const s = sums[i]; if (s[3]) for (let k = 0; k < 3; k++) p[k] = Math.round(s[k] / s[3]);
    });
  }
  return palette;
}
async function render(name, size, colors) {
  const filename = name + '.webp';
  const source = path.join(SOURCE, filename);
  const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = info;
  if (size === 0) return renderPlatform(name, colors, data, width, height);
  const w = Math.ceil(width / size), h = Math.ceil(height / size);
  const palette = paletteFor(data, width, height, colors);
  const cells = new Int16Array(w * h).fill(-1);
  for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
    const votes = new Uint16Array(colors); let opaque = 0, total = 0;
    const x0 = cx * size, y0 = cy * size;
    for (let y = y0; y < Math.min(y0 + size, height); y++) for (let x = x0; x < Math.min(x0 + size, width); x++) {
      const i = (y * width + x) * 4; total++;
      if (data[i + 3] < 128) continue;
      opaque++; votes[nearest(rgb(data, i), palette)]++;
    }
    if (opaque < total * .5) continue;
    let mode = 0;
    for (let i = 1; i < colors; i++) if (votes[i] > votes[mode]) mode = i;
    cells[cy * w + cx] = mode;
  }
  // Resolve one-cell color specks only when surrounding cells agree. Keep
  // silhouette corners and intentional small candy highlights untouched.
  const cleaned = cells.slice();
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, v = cells[i]; if (v < 0) continue;
    const n = [cells[i - 1], cells[i + 1], cells[i - w], cells[i + w]];
    if (n[0] >= 0 && n.every(c => c === n[0]) && dist(palette[v], palette[n[0]]) > 100) cleaned[i] = n[0];
  }
  const logical = Buffer.alloc(w * h * 4);
  for (let i = 0; i < cleaned.length; i++) {
    const c = cleaned[i]; if (c < 0) continue;
    const j = i * 4; logical[j] = palette[c][0]; logical[j + 1] = palette[c][1]; logical[j + 2] = palette[c][2]; logical[j + 3] = 255;
  }
  const candidate = path.join(OUT, filename);
  await sharp(logical, { raw: { width: w, height: h, channels: 4 } })
    .resize(w * size, h * size, { kernel: 'nearest' }).extract({ left: 0, top: 0, width, height })
    .webp({ lossless: true }).toFile(candidate);
  if (install) fs.copyFileSync(candidate, path.join(INSTALLED, filename));
  console.log(`${name}: ${width}x${height}, ${size}px grid, ${colors} colors${install ? ' (installed)' : ''}`);
}
async function renderPlatform(name, colors, source, width, height) {
  const palette = paletteFor(source, width, height, colors);
  const result = Buffer.from(source);
  // The supplied platforms already have carefully placed icing, brick and
  // candy contours. Retain every high-contrast edge and the exact alpha mask.
  // Only flat 2x2 interior patches are snapped to a restrained palette.
  for (let y = 0; y < height - 1; y += 2) for (let x = 0; x < width - 1; x += 2) {
    const pos = [(y * width + x) * 4, (y * width + x + 1) * 4,
      ((y + 1) * width + x) * 4, ((y + 1) * width + x + 1) * 4];
    if (pos.some(i => source[i + 3] < 255)) continue;
    const samples = pos.map(i => rgb(source, i));
    let contrast = 0;
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++)
      contrast = Math.max(contrast, dist(samples[a], samples[b]));
    if (contrast > 120) continue;
    const mode = nearest(samples[0], palette), color = palette[mode];
    for (const i of pos) { result[i] = color[0]; result[i + 1] = color[1]; result[i + 2] = color[2]; }
  }
  const candidate = path.join(OUT, name + '.webp');
  await sharp(result, { raw: { width, height, channels: 4 } }).webp({ lossless: true }).toFile(candidate);
  if (install) fs.copyFileSync(candidate, path.join(INSTALLED, name + '.webp'));
  console.log(`${name}: ${width}x${height}, edge-safe palette cleanup${install ? ' (installed)' : ''}`);
}
(async () => {
  fs.mkdirSync(SOURCE, { recursive: true });
  for (const item of ITEMS) await render(...item);
})().catch(error => { console.error(error); process.exitCode = 1; });
