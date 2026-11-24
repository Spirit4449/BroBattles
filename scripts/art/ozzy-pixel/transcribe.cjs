#!/usr/bin/env node
// One-off source study: transcribes public/assets/ozzy/body.webp (the style
// reference) into pixels.cjs, a 64x64 palette-indexed grid. The renderer never
// reads a raster; after this runs once, puppet.cjs is the editable art.
//   node scripts/art/ozzy-pixel/transcribe.cjs
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const ROOT = path.resolve(__dirname, '../../..');
const median = (a) => a.sort((x, y) => x - y)[a.length >> 1];
(async () => {
  const { data, info } = await sharp(path.join(ROOT, 'public/assets/ozzy/body.webp')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = 64;
  const cells = Array.from({ length: n * n }, (_, i) => {
    const x = i % n; const y = Math.floor(i / n); const ch = [[], [], [], []];
    for (let yy = Math.floor((y + 0.3) * info.height / n); yy < Math.ceil((y + 0.7) * info.height / n); yy++)
      for (let xx = Math.floor((x + 0.3) * info.width / n); xx < Math.ceil((x + 0.7) * info.width / n); xx++)
        for (let c = 0; c < 4; c++) ch[c].push(data[(yy * info.width + xx) * 4 + c]);
    const p = ch.map(median); return p[3] < 128 ? null : p.slice(0, 3);
  });
  const solid = cells.filter(Boolean);
  const dist = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const K = Number(process.argv[2] || 30);
  let palette = [solid[0]];
  while (palette.length < K) palette.push(solid.reduce((a, p) => (Math.min(...palette.map((c) => dist(p, c))) > Math.min(...palette.map((c) => dist(a, c))) ? p : a)));
  const nearest = (p) => palette.reduce((b, c, i) => (dist(p, c) < dist(p, palette[b]) ? i : b), 0);
  for (let k = 0; k < 30; k++) {
    const sums = palette.map(() => [0, 0, 0, 0]);
    for (const p of solid) { const j = nearest(p); p.forEach((v, c) => { sums[j][c] += v; }); sums[j][3]++; }
    palette = palette.map((p, i) => (sums[i][3] ? sums[i].slice(0, 3).map((v) => Math.round(v / sums[i][3])) : p));
  }
  palette.sort((a, b) => a.reduce((s, v) => s + v, 0) - b.reduce((s, v) => s + v, 0));
  const symbols = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
  const rows = Array.from({ length: n }, (_, y) => cells.slice(y * n, (y + 1) * n).map((p) => (p ? symbols[nearest(p)] : '.')).join(''));
  const hex = (p) => '#' + p.map((v) => v.toString(16).padStart(2, '0')).join('');
  fs.writeFileSync(path.join(__dirname, 'pixels.cjs'), `// Transcribed 64x64 Ozzy (public/assets/ozzy/body.webp) by transcribe.cjs.\nmodule.exports = ${JSON.stringify({ size: n, palette: Object.fromEntries(palette.map((p, i) => [symbols[i], hex(p)])), rows }, null, 2)};\n`);
  // Round-trip check against the source.
  const up = Buffer.alloc(n * n * 4);
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (ch !== '.') { up.set([...palette[symbols.indexOf(ch)], 255], (y * n + x) * 4); } }));
  await sharp(up, { raw: { width: n, height: n, channels: 4 } }).resize(n * 8, n * 8, { kernel: 'nearest' }).flatten({ background: '#ffffff' }).png().toFile(path.join(ROOT, 'output/ozzy-pixel/transcribed-8x.png'));
  console.log(Object.entries(palette).map(([i, p]) => `${symbols[i]} ${hex(p)}`).join('  '));
  console.log(rows.map((r, i) => `${String(i).padStart(2)} ${r}`).join('\n'));
})();
