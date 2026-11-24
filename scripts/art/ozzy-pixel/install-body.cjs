#!/usr/bin/env node
// Installs Ozzy's body art (lobby, character select, portraits) from a
// generated 1254px still on flat #FF00FF:
//   node scripts/art/ozzy-pixel/install-body.cjs <image.png> [--base <original.webp>]
// With --base the image is an edit of that art (the cape added to the
// original body): the original's own pixels are kept exactly wherever it is
// drawn, and only what the edit added is taken from the image.
// The backdrop (flood-filled from the border) becomes transparent, then any
// magenta-tinted fringe pixel
// touching it (blended edges); the art itself is outlined, so its pinks are
// never next to the backdrop. Rebuild portraits afterwards:
//   node scripts/art/build-portraits.cjs
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');

const OUT = path.resolve(__dirname, '../../../public/assets/ozzy/body.webp');
const backdrop = (r, g, b) => (r - 255) ** 2 + g ** 2 + (b - 255) ** 2 < 150 ** 2;
// Backdrop blended into an edge, from bright pink to dark magenta against the
// near-black outline: red and blue together, green far below both. The hood's
// purple is bluer than this (red and blue 80+ apart).
const fringe = (r, g, b) => g < r - 30 && g < b - 30 && Math.abs(r - b) < 60;

async function main() {
  const args = process.argv.slice(2);
  const baseAt = args.indexOf('--base');
  const base = baseAt >= 0 ? args[baseAt + 1] : null;
  const file = args.find((a, i) => !a.startsWith('--') && (baseAt < 0 || i !== baseAt + 1));
  if (!file) throw new Error('usage: install-body.cjs <image.png> [--base <original.webp>]');
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  // Only backdrop connected to the border: the robe's pinks sit inside the
  // outline and must stay.
  const stack = [];
  for (let x = 0; x < w; x++) stack.push([x, 0], [x, h - 1]);
  for (let y = 0; y < h; y++) stack.push([0, y], [w - 1, y]);
  while (stack.length) {
    const [x, y] = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const i = (y * w + x) * 4;
    if (!data[i + 3] || !backdrop(data[i], data[i + 1], data[i + 2])) continue;
    data[i + 3] = 0;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  // Pockets the outline closes off (between staff and cape) are near-pure
  // backdrop; the robe's pinks are all far from it (distance 110+).
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i] - 255) ** 2 + data[i + 1] ** 2 + (data[i + 2] - 255) ** 2 < 60 ** 2) data[i + 3] = 0;
  }
  for (let pass = 0; pass < 3; pass++) {
    const clear = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (!data[i + 3] || !fringe(data[i], data[i + 1], data[i + 2])) continue;
      const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
        const nx = x + dx; const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= w || ny >= h || !data[((ny * w) + nx) * 4 + 3];
      });
      if (open) clear.push(i);
    }
    for (const i of clear) data[i + 3] = 0;
  }
  if (base) {
    const original = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    if (original.info.width !== w || original.info.height !== h) throw new Error('Base and cape edit must align');
    // The staff divides this cape into two visible pieces. Start inside each
    // piece and take only connected additions outside the original silhouette.
    for (const [x, y] of [[273, 1015], [400, 813]]) {
      const pending = [y * w + x];
      if (!data[pending[0] * 4 + 3] || original.data[pending[0] * 4 + 3]) throw new Error('Cape seed outside addition');
      while (pending.length) {
        const pixel = pending.pop();
        const i = pixel * 4;
        if (!data[i + 3] || original.data[i + 3]) continue;
        data.copy(original.data, i, i, i + 4);
        if (pixel % w > 0) pending.push(pixel - 1);
        if (pixel % w < w - 1) pending.push(pixel + 1);
        if (pixel >= w) pending.push(pixel - w);
        if (pixel < w * (h - 1)) pending.push(pixel + w);
      }
    }
    original.data.copy(data);
  }
  const encoding = base ? { lossless: true } : { quality: 95, alphaQuality: 100 };
  await sharp(data, { raw: { width: w, height: h, channels: 4 } }).webp(encoding).toFile(OUT);
  console.log(`wrote ${path.relative(process.cwd(), OUT)} (${w}x${h})`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
