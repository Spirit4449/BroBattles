#!/usr/bin/env node
// Installs the animated pieces set into Iron Junction's walls.
//
//   node scripts/art/install-iron-junction-deco.cjs
//
// Each source in output/bank-bust-art/v5 is a four-frame strip painted by Codex on
// flat magenta. The generator does not keep an object in exactly the same place
// from frame to frame, so each frame is slid onto the first by whichever offset
// overlaps it best. Everything is then cropped to one box, so the frames swap in
// place, and reduced to a 2-world-pixel grid with hard-edged alpha.

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..", "..");
const SRC = path.join(ROOT, "output", "bank-bust-art", "v5");
const OUT = path.join(ROOT, "public", "assets", "bank-bust");
const sharp = require(path.join(ROOT, "spritesheet-generator", "node_modules", "sharp"));

const FRAMES = 4;
const GRID = 2;
const SEARCH = 28;
// World width of one frame.
const WIDTHS = { clock: 88, coinchute: 80, furnace: 96, fusebox: 104, rat: 96, valve: 104 };

const isKey = (r, g, b) => r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 90;

async function frames(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const w = Math.floor(info.width / FRAMES), h = info.height;
  return Array.from({ length: FRAMES }, (_, f) => {
    const px = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * info.width + f * w + x) * 4;
      if (isKey(data[s], data[s + 1], data[s + 2])) continue;
      data.copy(px, (y * w + x) * 4, s, s + 4);
    }
    return { px, w, h };
  });
}

/** Offset of `b` that best lines its solid pixels up with `a`. */
function alignment(a, b) {
  let best = { dx: 0, dy: 0, score: -1 };
  const { w, h } = a;
  for (let dy = -SEARCH; dy <= SEARCH; dy += 2) for (let dx = -SEARCH; dx <= SEARCH; dx += 2) {
    let score = 0;
    for (let y = 0; y < h; y += 6) for (let x = 0; x < w; x += 6) {
      const sx = x - dx, sy = y - dy;
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const i = (y * w + x) * 4, j = (sy * w + sx) * 4;
      if (a.px[i + 3] && b.px[j + 3] && Math.abs(a.px[i] - b.px[j]) + Math.abs(a.px[i + 2] - b.px[j + 2]) < 50) score++;
    }
    if (score > best.score) best = { dx, dy, score };
  }
  return best;
}

function shifted(frame, dx, dy) {
  const { w, h } = frame;
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const sx = x - dx, sy = y - dy;
    if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
    frame.px.copy(px, (y * w + x) * 4, (sy * w + sx) * 4, (sy * w + sx) * 4 + 4);
  }
  return { px, w, h };
}

function bounds(list) {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (const { px, w, h } of list) for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!px[(y * w + x) * 4 + 3]) continue;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  return { left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

async function install(name) {
  const width = WIDTHS[name], out = `deco-${name}.webp`;
  const raw = await frames(path.join(SRC, `${name}.png`));
  const aligned = raw.map((frame, i) => {
    if (!i) return frame;
    const { dx, dy } = alignment(raw[0], frame);
    return shifted(frame, dx, dy);
  });
  const box = bounds(aligned);
  const w = Math.round(width / GRID);
  const h = Math.round((box.height * w) / box.width);
  const sheet = Buffer.alloc(w * FRAMES * h * 4);
  for (const [f, frame] of aligned.entries()) {
    const small = await sharp(frame.px, { raw: { width: frame.w, height: frame.h, channels: 4 } })
      .extract(box).resize(w, h, { kernel: "lanczos3", fit: "fill" }).raw().toBuffer();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (y * w + x) * 4, t = (y * w * FRAMES + f * w + x) * 4;
      if (small[s + 3] < 128) continue;
      for (let c = 0; c < 3; c++) sheet[t + c] = Math.min(255, Math.round(small[s + c] / 12) * 12);
      sheet[t + 3] = 255;
    }
  }
  const image = sharp(sheet, { raw: { width: w * FRAMES, height: h, channels: 4 } });
  await image.resize(w * FRAMES * GRID, h * GRID, { kernel: "nearest" }).webp({ lossless: true, effort: 6 })
    .toFile(path.join(OUT, out));
  console.log(`${out} ${w * GRID}x${h * GRID} x${FRAMES}`);
}

(async () => {
  for (const file of fs.readdirSync(OUT)) if (file.startsWith("deco-")) fs.unlinkSync(path.join(OUT, file));
  for (const name of Object.keys(WIDTHS)) await install(name);
})();
