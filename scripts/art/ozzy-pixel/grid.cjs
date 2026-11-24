#!/usr/bin/env node
// Legacy frames redrawn on this art's coordinate grid (rest-art px; the 64px
// rest canvas is 0-63), with a line every 5 px, for reading off foot, hand and
// staff positions to pose against.
//   node scripts/art/ozzy-pixel/grid.cjs <legacyPrefix>  -> output/ozzy-pixel/compare/grid-<prefix>.png
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const ROOT = path.resolve(__dirname, '../../..');
const K = 1.52; const LEGACY_ANCHOR = [82, 140]; const ART_ANCHOR = [12, 63.5];
const X0 = -20; const Y0 = -12; const W = 104; const H = 80; const S = 8;
(async () => {
  const prefix = process.argv[2];
  const atlas = JSON.parse(fs.readFileSync(path.join(__dirname, 'legacy/animations.json'), 'utf8'));
  const frames = atlas.frames.filter((f) => new RegExp(`^${prefix}\\d+$`).test(f.filename)).sort((a, b) => a.filename.localeCompare(b.filename));
  const tiles = [];
  for (const [i, fr] of frames.entries()) {
    const f = fr.frame;
    // legacy px -> art px: art = ART_ANCHOR + (legacy - LEGACY_ANCHOR) / K
    const w = Math.round((f.w / K) * S); const h = Math.round((f.h / K) * S);
    const img = await sharp(path.join(__dirname, 'legacy/spritesheet.webp')).extract({ left: f.x, top: f.y, width: f.w, height: f.h }).resize(w, h, { kernel: 'nearest' }).png().toBuffer();
    const left = Math.round((ART_ANCHOR[0] - LEGACY_ANCHOR[0] / K - X0) * S); const top = Math.round((ART_ANCHOR[1] - LEGACY_ANCHOR[1] / K - Y0) * S);
    let svg = `<svg width="${W * S}" height="${H * S}" xmlns="http://www.w3.org/2000/svg">`;
    for (let x = Math.ceil(X0 / 5) * 5; x < X0 + W; x += 5) svg += `<line x1="${(x - X0) * S}" y1="0" x2="${(x - X0) * S}" y2="${H * S}" stroke="${x % 10 ? '#ffffff40' : '#ffffffa0'}"/><text x="${(x - X0) * S + 2}" y="12" font-size="11" fill="#fff">${x}</text>`;
    for (let y = Math.ceil(Y0 / 5) * 5; y < Y0 + H; y += 5) svg += `<line x1="0" y1="${(y - Y0) * S}" x2="${W * S}" y2="${(y - Y0) * S}" stroke="${y % 10 ? '#ffffff40' : '#ffffffa0'}"/><text x="2" y="${(y - Y0) * S - 2}" font-size="11" fill="#fff">${y}</text>`;
    svg += `<text x="${W * S - 90}" y="${H * S - 8}" font-size="16" fill="#ff0">${fr.filename}</text></svg>`;
    const pad = 2000;
    const base = await sharp({ create: { width: W * S + pad * 2, height: H * S + pad * 2, channels: 4, background: '#6c7280' } }).composite([{ input: img, left: left + pad, top: top + pad }]).png().toBuffer();
    const tile = await sharp(base).extract({ left: pad, top: pad, width: W * S, height: H * S }).composite([{ input: Buffer.from(svg) }]).png().toBuffer();
    tiles.push({ input: tile, left: (i % 2) * W * S, top: Math.floor(i / 2) * H * S });
  }
  const out = path.join(ROOT, 'output/ozzy-pixel/compare'); fs.mkdirSync(out, { recursive: true });
  await sharp({ create: { width: W * S * Math.min(2, frames.length), height: H * S * Math.ceil(frames.length / 2), channels: 4, background: '#000' } }).composite(tiles).png().toFile(path.join(out, `grid-${prefix}.png`));
  console.log('ok');
})();
