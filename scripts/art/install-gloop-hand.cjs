#!/usr/bin/env node
//   node scripts/art/install-gloop-hand.cjs [source.png]
//
// Installs Gloop's hook-hand grip sheet: eight poses in a 4x2 grid, open to
// fist. The redraw arrives on flat magenta at many times game density, so each
// cell is resampled onto a coarse 32px grid (the majority colour of every
// block) and blown back up with hard edges. At the hook's draw scale one art
// pixel lands near the arm ribbon's 3px screen grid.
//
// Each block is then recoloured to the arm ribbon's palette (special.js), so
// the hand reads as the end of the same slime trail.

const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = process.argv[2] || path.join(ROOT, "output", "gloop-art", "hand-grip-pixel.png");
const DEST = path.join(ROOT, "public", "assets", "gloop", "hand-grip.webp");
const sharp = require(path.join(ROOT, "spritesheet-generator", "node_modules", "sharp"));

const COLS = 4, ROWS = 2, GRID = 32, UPSCALE = 4;

// Redraw shade -> ribbon colour: ink outline, blue rim, teal flesh, and a
// highlight halfway to the ribbon's pale dither.
const PALETTE = [
  [[0x00, 0x10, 0x30], [0x07, 0x1c, 0x38]],
  [[0x00, 0x60, 0xc0], [0x11, 0x76, 0xaa]],
  [[0x00, 0xc0, 0xc0], [0x10, 0xb6, 0xbc]],
  [[0x40, 0xe0, 0xd0], [0x51, 0xca, 0xc2]],
];
function ribbonColour(r, g, b) {
  let best = PALETTE[0], bestDistance = Infinity;
  for (const entry of PALETTE) {
    const [sr, sg, sb] = entry[0];
    const distance = (r - sr) ** 2 + (g - sg) ** 2 + (b - sb) ** 2;
    if (distance < bestDistance) { best = entry; bestDistance = distance; }
  }
  return best[1];
}

const isKey = (r, g, b) => r > 140 && b > 140 && g < 110 && r - g > 60;

async function main() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const outW = COLS * GRID, outH = ROWS * GRID;
  const out = Buffer.alloc(outW * outH * 4);
  const cellW = info.width / COLS, cellH = info.height / ROWS;
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const cx = Math.floor(ox / GRID), cy = Math.floor(oy / GRID);
      const x0 = Math.round(cx * cellW + (ox % GRID) * cellW / GRID);
      const x1 = Math.round(cx * cellW + (ox % GRID + 1) * cellW / GRID);
      const y0 = Math.round(cy * cellH + (oy % GRID) * cellH / GRID);
      const y1 = Math.round(cy * cellH + (oy % GRID + 1) * cellH / GRID);
      const counts = new Map();
      let solid = 0, total = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * info.width + x) * 4;
          total++;
          if (data[i + 3] < 128 || isKey(data[i], data[i + 1], data[i + 2])) continue;
          solid++;
          // Bucket near-identical shades so stray antialiasing can't win a block.
          const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
          const entry = counts.get(key) || { n: 0, r: 0, g: 0, b: 0 };
          entry.n++; entry.r += data[i]; entry.g += data[i + 1]; entry.b += data[i + 2];
          counts.set(key, entry);
        }
      }
      if (solid * 2 < total) continue;
      let best = null;
      for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
      const o = (oy * outW + ox) * 4;
      const [r, g, b] = ribbonColour(best.r / best.n, best.g / best.n, best.b / best.n);
      out[o] = r; out[o + 1] = g; out[o + 2] = b;
      out[o + 3] = 255;
    }
  }
  await sharp(out, { raw: { width: outW, height: outH, channels: 4 } })
    .resize(outW * UPSCALE, outH * UPSCALE, { kernel: "nearest" })
    .webp({ lossless: true })
    .toFile(DEST);
  console.log(`wrote ${path.relative(ROOT, DEST)} (${outW * UPSCALE}x${outH * UPSCALE})`);
}

main().catch(error => { console.error(error); process.exit(1); });
