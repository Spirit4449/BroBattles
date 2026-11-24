#!/usr/bin/env node
// Imports Ozzy's crouch and animated wall slide from generated
// stills drawn over the in-game idle at 8 screen px per art px on flat
// #FF00FF (output/ozzy-pixel/gen/ref-idle.png was the reference):
//   node scripts/art/ozzy-pixel/poses-image.cjs <image folder> [--install]
// Previews -> output/ozzy-pixel/poses-image/. --install replaces duck00 and
// the sing loop in public/assets/ozzy/spritesheet.webp.
//
// 1. Key: the magenta backdrop and its blended fringe become transparent.
// 2. Sample: the art grid (8 px, phase measured from the image's edges); each
//    art pixel is the median of its inner block, or empty when the block is
//    mostly backdrop.
// 3. Colour: every pixel takes the nearest colour of the shipped idle frames,
//    so the poses share the video-imported animations' palette.
// 4. Place: the crouch's soles on the idle's sole row; the wall slide where
//    the old code-drawn slide frame stood (OLD_SLIDE: its right edge on the
//    wall, its soles), since it is a repaint of that pose.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const V = require('./video-clip.cjs');

const SCALE = 8; // screen px per art px in the reference and the stills
const SOLE_ROW = 104; // the idle's sole row (rig feet)
const OLD_SLIDE = { x1: 68, y1: 103 }; // the old sing00's right edge and sole row
const POSES = [
  { name: 'duck', file: 'crouch.png', place: 'ground' },
  { name: 'sing', file: 'wallslide-v2.png', place: 'wall' },
];

const isBackdrop = (r, g, b) => (r - 255) ** 2 + g ** 2 + (b - 255) ** 2 < 140 ** 2;

// Grid phase (0..SCALE) along an axis from colour edges in the image.
function phase(data, w, h, axis) {
  let c = 0; let s = 0;
  for (let y = 0; y < h - 1; y++) for (let x = 0; x < w - 1; x++) {
    const i = (y * w + x) * 4; const j = axis === 'x' ? i + 4 : i + w * 4;
    if (Math.abs(data[i] - data[j]) + Math.abs(data[i + 1] - data[j + 1]) + Math.abs(data[i + 2] - data[j + 2]) <= 60) continue;
    const a = 2 * Math.PI * ((axis === 'x' ? x : y) + 1) / SCALE; c += Math.cos(a); s += Math.sin(a);
  }
  return ((Math.atan2(s, c) / (2 * Math.PI)) * SCALE + SCALE) % SCALE;
}

const median = (v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };

async function idlePalette() {
  const sheet = await sharp(path.join(V.ASSETS, 'spritesheet.webp')).raw().toBuffer({ resolveWithObject: true });
  const atlas = JSON.parse(fs.readFileSync(path.join(V.ASSETS, 'animations.json'), 'utf8'));
  const colours = new Map();
  for (const row of atlas.frames) if (/^(idle|running)\d+$/.test(row.filename)) {
    const { x, y } = row.frame;
    for (let yy = 0; yy < V.CELL; yy++) for (let xx = 0; xx < V.CELL; xx++) {
      const i = ((y + yy) * sheet.info.width + x + xx) * 4;
      if (sheet.data[i + 3]) colours.set((sheet.data[i] << 16) | (sheet.data[i + 1] << 8) | sheet.data[i + 2], 1);
    }
  }
  return [...colours.keys()].map((k) => [k >> 16, (k >> 8) & 255, k & 255]);
}

async function importPose(file, palette) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = phase(data, w, h, 'x'); const py = phase(data, w, h, 'y');
  const cols = Math.floor((w - px) / SCALE); const rows = Math.floor((h - py) / SCALE);
  const art = Buffer.alloc(cols * rows * 4);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = [[], [], []]; let bg = 0; let n = 0;
    for (let y = Math.round(py + r * SCALE + 2); y < py + (r + 1) * SCALE - 2; y++) for (let x = Math.round(px + c * SCALE + 2); x < px + (c + 1) * SCALE - 2; x++) {
      const i = (y * w + x) * 4; n++;
      if (isBackdrop(data[i], data[i + 1], data[i + 2])) { bg++; continue; }
      ch[0].push(data[i]); ch[1].push(data[i + 1]); ch[2].push(data[i + 2]);
    }
    if (!n || bg * 2 >= n) continue;
    const rgb = ch.map(median);
    let best = palette[0]; let bestD = Infinity;
    for (const p of palette) { const d = (p[0] - rgb[0]) ** 2 + (p[1] - rgb[1]) ** 2 + (p[2] - rgb[2]) ** 2; if (d < bestD) { bestD = d; best = p; } }
    const o = (r * cols + c) * 4; art[o] = best[0]; art[o + 1] = best[1]; art[o + 2] = best[2]; art[o + 3] = 255;
  }
  return { art, cols, rows, phase: [px, py] };
}

function toCell({ art, cols, rows }, [dx, dy]) {
  const cell = Buffer.alloc(V.CELL * V.CELL * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const s = (y * cols + x) * 4; if (!art[s + 3]) continue;
    const tx = x + dx; const ty = y + dy;
    if (tx >= 0 && ty >= 0 && tx < V.CELL && ty < V.CELL) art.copy(cell, (ty * V.CELL + tx) * 4, s, s + 4);
  }
  return cell;
}

// A ripple travels from the shoulder into the two loose cape folds. Fade the
// displacement out above the staff and keep the wall-facing side and feet fixed.
function wallSlideFrames(base) {
  const clamp = (v) => Math.max(0, Math.min(1, v));
  return Array.from({ length: 8 }, (_, frame) => {
    const cell = Buffer.from(base);
    const phase = frame * Math.PI / 4;
    for (let x = 18; x < 44; x++) {
      const trail = clamp((44 - x) / 22);
      const lag = trail * 1.5;
      const ripple = (Math.sin(phase - lag) + Math.sin(lag)) * 3.5 * trail;
      for (let y = 57; y < 90; y++) {
        const weight = clamp((89 - y) / 11);
        const sourceY = y + Math.round(ripple * weight);
        const source = (sourceY * V.CELL + x) * 4;
        base.copy(cell, (y * V.CELL + x) * 4, source, source + 4);
      }
    }
    return cell;
  });
}

async function main() {
  const dir = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!dir) throw new Error('usage: poses-image.cjs <image folder> [--install]');
  const OUT = path.join(V.ROOT, 'output/ozzy-pixel/poses-image');
  const palette = await idlePalette();
  const groups = [];
  for (const pose of POSES) {
    const sampled = await importPose(path.join(dir, pose.file), palette);
    // The still is drawn over the cell at SCALE, so a sampled pixel's column
    // is already its cell column; placement only nudges it.
    const s = V.stats(toCell(sampled, [0, 0]));
    const shift = pose.place === 'ground' ? [0, SOLE_ROW - s.y1] : [OLD_SLIDE.x1 - s.x1, OLD_SLIDE.y1 - s.y1];
    const cell = V.cleanFrames([toCell(sampled, shift)], { majority: false })[0];
    const t = V.stats(cell);
    console.log(`${pose.name}: grid phase ${sampled.phase.map((v) => v.toFixed(1)).join(',')} | box x ${t.x0}-${t.x1} y ${t.y0}-${t.y1} | shift ${shift}`);
    const sliding = pose.place === 'wall';
    const cells = sliding ? wallSlideFrames(cell) : [cell];
    await V.writePreviews(OUT, pose.name, cells, cells.map(() => sliding ? 100 : 1000));
    groups.push({ name: pose.name, cells });
  }
  if (process.argv.includes('--install')) await V.installCells(groups);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
