#!/usr/bin/env node
// Turns a generated pose strip (source/<name>.png: equal frames on flat magenta,
// frame 1 the idle stance) into editable pixel poses (poses/*.txt, named in STRIPS).
//   node scripts/art/ninja-pixel/import.cjs <name> [<name> ...]
// Figures are found by the gaps between them. Each is read on the art's own pixel
// grid (one art pixel per drawn cell, nothing resampled), snapped to the palette,
// despeckled, and slid so its lead foot sits exactly where the master idle's does
// (poses/idle.txt). Importing `base` writes that master.
// Importing overwrites the pose files it names: hand edits to those are lost, so
// import once and edit the text afterwards. build.cjs never calls this.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, GROUND, FEET_X, HEIGHT, RGB } = require('./palette.cjs');

const CLOTH = new Set(['D', 'd', 'g']);
const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];

const readPose = (file) => fs.readFileSync(file, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));

async function importStrip(name, expected) {
  const { data, info } = await sharp(path.join(__dirname, 'source', `${name}.png`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width; const H = info.height;
  const isBg = (i) => data[i] > 150 && data[i + 1] < 120 && data[i + 2] > 150;
  const quant = (i) => {
    if (isBg(i)) return '.';
    let best = 'k'; let bd = Infinity;
    for (const [ch, p] of Object.entries(RGB)) {
      const d = (data[i] - p[0]) ** 2 + (data[i + 1] - p[1]) ** 2 + (data[i + 2] - p[2]) ** 2;
      if (d < bd) { bd = d; best = ch; }
    }
    return best;
  };
  // The figures are not evenly spaced: find each one as a run of occupied columns.
  const occupied = Array.from({ length: W }, (_, x) => { for (let y = 0; y < H; y++) if (!isBg((y * W + x) * 4)) return true; return false; });
  const spans = [];
  for (let x = 0, start = -1, gap = 0; x <= W; x++) {
    if (x < W && occupied[x]) { if (start < 0) start = x; gap = 0; continue; }
    if (start >= 0 && (++gap > 24 || x === W)) { spans.push([start, x - gap]); start = -1; }
  }
  if (spans.length !== expected) throw new Error(`${name}: expected ${expected} figures, found ${spans.length}`);
  const box = ([x0, x1]) => {
    let top = H; let bottom = 0;
    for (let y = 0; y < H; y++) for (let x = x0; x <= x1; x++) if (!isBg((y * W + x) * 4)) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
    return { top, bottom };
  };
  // The art is drawn on its own pixel grid. Sample it on that grid, one art pixel
  // per source cell, so nothing is resampled: for each figure find the grid phase
  // whose cells are most uniform, then take each cell's majority colour.
  // The idle in frame 1 is always HEIGHT art pixels tall, which gives the strip's
  // pixel size (about 7.35 source px in most strips; Codex sometimes draws larger).
  const idle = box(spans[0]);
  const cell = (idle.bottom - idle.top + 1) / HEIGHT;
  const frames = [];
  for (const span of spans) {
    const { bottom } = box(span);
    let phase = { score: -1, px: 0, py: 0 };
    for (let py = 0; py < cell; py += 0.5) for (let px = 0; px < cell; px += 0.5) {
      let pure = 0; let n = 0;
      for (let y = bottom + 1 - py - cell; y > bottom - cell * 60 && y >= 0; y -= cell) for (let x = span[0] - cell + px; x + cell <= span[1] + cell; x += cell) {
        const votes = {}; let count = 0;
        for (let yy = Math.round(y + 1); yy < y + cell - 1; yy += 2) for (let xx = Math.round(x + 1); xx < x + cell - 1; xx += 2) {
          if (xx < 0 || xx >= W || yy >= H) continue;
          const ch = quant((yy * W + xx) * 4); votes[ch] = (votes[ch] || 0) + 1; count++;
        }
        if (!count || (votes['.'] === count)) continue;
        n++; pure += Math.max(...Object.values(votes)) / count;
      }
      if (n && pure / n > phase.score) phase = { score: pure / n, px, py };
    }
    const originX = span[0] - cell + phase.px; const originY = bottom + 1 - phase.py; // bottom edge of the lowest row of cells
    const midCol = Math.round(((span[0] + span[1]) / 2 - originX) / cell);
    const grid = [];
    for (let cy = 0; cy < SIZE; cy++) {
      const row = [];
      for (let cx = 0; cx < SIZE; cx++) {
        const y0 = originY - (GROUND - cy) * cell; const x0 = originX + (cx - FEET_X + midCol) * cell;
        const votes = {};
        for (let y = Math.round(y0 + cell * 0.25); y < y0 + cell * 0.75; y++) for (let x = Math.round(x0 + cell * 0.25); x < x0 + cell * 0.75; x++) {
          if (y < 0 || y >= H || x < span[0] - 12 || x > span[1] + 12) continue;
          const ch = quant((y * W + x) * 4);
          votes[ch] = (votes[ch] || 0) + 1;
        }
        const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
        row.push(ranked.length ? ranked[0][0] : '.');
      }
      grid.push(row);
    }
    frames.push(despeckle(settle(grid)));
  }
  return frames;
}

// Drops the figure so its lowest pixels rest on the ground row.
function settle(grid) {
  let last = SIZE - 1;
  while (last > 0 && grid[last].every((ch) => ch === '.')) last--;
  const dy = GROUND - 1 - last;
  return Array.from({ length: SIZE }, (_, y) => grid[y - dy]?.slice() ?? new Array(SIZE).fill('.'));
}

// A lone cloth pixel that matches none of its neighbours is resampling noise:
// give it the tone most of its neighbours have.
function despeckle(grid) {
  const out = grid.map((row) => row.slice());
  for (let y = 1; y < SIZE - 1; y++) for (let x = 1; x < SIZE - 1; x++) {
    const ch = grid[y][x];
    if (!CLOTH.has(ch)) continue;
    const around = N4.map(([dx, dy]) => grid[y + dy][x + dx]);
    if (around.includes(ch)) continue;
    const cloth = around.filter((c) => CLOTH.has(c));
    if (cloth.length < 2) continue;
    const count = {}; for (const c of cloth) count[c] = (count[c] || 0) + 1;
    out[y][x] = Object.entries(count).sort((a, b) => b[1] - a[1])[0][0];
  }
  return out;
}

// Whole-pixel offset that best lays `grid` over the master inside a box of cells.
function alignTo(master, grid, { x0, x1, y0, y1 }, reach = 14) {
  let best = { score: -Infinity, dx: 0, dy: 0 };
  for (let dy = -2; dy <= 2; dy++) for (let dx = -reach; dx <= reach; dx++) {
    let score = 0;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const a = master[y][x]; const b = grid[y - dy]?.[x - dx] ?? '.';
      if (a !== '.' && a === b) score++; else if ((a === '.') !== (b === '.')) score--;
    }
    if (score > best.score) best = { score, dx, dy };
  }
  return best;
}
function shift(grid, dx, dy) {
  return Array.from({ length: SIZE }, (_, y) => Array.from({ length: SIZE }, (_, x) => grid[y - dy]?.[x - dx] ?? '.'));
}
const write = (file, grid, note) => fs.writeFileSync(path.join(__dirname, 'poses', file), `# ${note}\n${grid.map((r) => r.join('')).join('\n')}\n`);

// What each source strip holds after its idle frame, and how its frames are placed.
//   plant: 'lead-foot'  slide the frame so the lead foot sits where the master idle's does
//   plant: 'centre'     leave the figure centred on the stance column, standing on the ground row
//   like: [frames]      a redraw of installed frames: put each figure where the installed
//                       one sits against the feet anchor, so it moves the way it did.
//                       Upright poses are matched on the head (top of the hood and the
//                       front of the face), which is what the eye follows: matching the
//                       whole outline made the body shake as the limbs and scarf swung.
//                       Tumbling poses are matched on the centre of the figure.
const THROW = (name) => ({ poses: ['gather', 'release', 'follow'].map((beat) => `${name}-${beat}`), plant: 'lead-foot' });
const REDRAW = (pose, clip, from, count, anchors = 'head') => ({
  anchors: Array.isArray(anchors) ? anchors : new Array(count).fill(anchors),
  poses: Array.from({ length: count }, (_, i) => `${pose}-${from + i}`),
  like: Array.from({ length: count }, (_, i) => `${clip}${String(from + i).padStart(2, '0')}`) });
const STRIPS = {
  level: THROW('level'), up: THROW('up'), down: THROW('down'), high: THROW('high'), low: THROW('low'),
  runA: REDRAW('run', 'running', 0, 3), runB: REDRAW('run', 'running', 3, 3),
  jumpA: REDRAW('jump', 'jumping', 0, 3, ['head', 'head', 'centre']), jumpB: REDRAW('jump', 'jumping', 3, 3, 'centre'),
  jumpC: REDRAW('jump', 'jumping', 6, 2, ['centre', 'head']),
  fall: REDRAW('fall', 'falling', 0, 3),
  // Two in-betweens that carry the end of the jump into the fall.
  jumpD: { poses: ['jump-8', 'jump-9'], like: ['jumping07', 'falling00'], anchors: ['head', 'head'] },
  wall: { poses: ['wall'], like: ['wall00'], anchors: ['centre'] },
  crouch: { poses: ['crouch'], like: ['duck00'], anchors: ['centre'] },
  // The forward dash is a redraw; the diagonal and upward dashes are the same
  // poses turned, centred where the forward ones are.
  // (Codex returned three of the four forward frames: the start and two of the lunge.)
  dashR: { poses: ['dashright-0', 'dashright-1', 'dashright-2'], like: ['dash00', 'dash01', 'dash03'], anchors: ['centre', 'centre', 'centre'] },
  dashD: { ...REDRAW('dashdiagonal', 'dash', 0, 4, 'centre') },
  dashU: { ...REDRAW('dashup', 'dash', 0, 4, 'centre') },
  // Three tweens from the jump's last pose into the fall's first (drawn from both).
  jumpT: { poses: ['jump-t0', 'jump-t1', 'jump-t2'], plant: 'centre' },
  // Curling into the somersault and out of it (drawn from the leap, tuck and open-out).
  jumpM: { poses: ['jump-m0', 'jump-m1'], plant: 'centre' },
  superA: { poses: ['super-0', 'super-1', 'super-2', 'super-3'], plant: 'lead-foot' },
  superB: { poses: ['super-4', 'super-5', 'super-6', 'super-7'], plant: 'lead-foot' },
  move: { poses: ['duck', 'wall-first', 'land'], plant: 'centre' },
  dashFirst: { poses: ['dashfirst-0', 'dashfirst-1', 'dashfirst-2'], plant: 'centre' },
  die: { poses: ['die-0', 'die-1', 'die-2'], plant: 'centre' },
};

// Geometry of the sheet being redrawn (./legacy): 256px cells, feet anchor at
// column 127, soles on row 251, 0.3 art px per sheet px at matching height.
const INSTALLED = { cell: 256, feetX: 127, sole: 251, perArt: 0.3 };
// Where a figure is, for matching: the centre of its outline, or its head (the
// top row of the hood and the front-most column of the face). `filled(x, y)`.
function locate(filled, w, h, headRows, how) {
  let x0 = w; let x1 = 0; let y0 = h; let y1 = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (filled(x, y)) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (how === 'centre') return [(x0 + x1 + 1) / 2, (y0 + y1 + 1) / 2];
  let front = 0;
  for (let y = y0; y < y0 + headRows; y++) for (let x = 0; x < w; x++) if (filled(x, y)) front = Math.max(front, x);
  return [front + 1, y0];
}
async function installedSpot(frameName, how) {
  const dir = path.join(__dirname, 'legacy');
  const atlas = JSON.parse(fs.readFileSync(path.join(dir, 'animations.json'), 'utf8'));
  const { frame } = atlas.frames.find((f) => f.filename === frameName);
  const { data } = await sharp(path.join(dir, 'spritesheet.webp')).extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h })
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const [x, y] = locate((px, py) => data[(py * frame.w + px) * 4 + 3] > 127, frame.w, frame.h, Math.round(HEAD_ROWS / INSTALLED.perArt), how);
  return [(x - INSTALLED.feetX) * INSTALLED.perArt, (y - INSTALLED.sole - 1) * INSTALLED.perArt];
}
const HEAD_ROWS = 16; // art rows from the top of the hood down to the chin

async function main() {
  for (const name of process.argv.slice(2)) {
    if (name === 'base') {
      const frames = await importStrip(name, 4);
      write('idle.txt', frames[0], 'Master idle, imported from source/base.png frame 1. Edit freely.');
      console.log('wrote poses/idle.txt');
      continue;
    }
    const strip = STRIPS[name];
    if (!strip) throw new Error(`unknown strip ${name}: add it to STRIPS`);
    const frames = await importStrip(name, strip.poses.length + 1);
    const master = readPose(path.join(__dirname, 'poses', 'idle.txt')).map((r) => [...r]);
    for (let f = 1; f < frames.length; f++) {
      const pose = strip.poses[f - 1];
      let fit = { dx: 0, dy: 0 };
      if (strip.plant === 'lead-foot') {
        // The lead foot is the planted one (it carries the throw): put it exactly
        // where the master's is. The back foot is free to step as he winds up.
        fit = alignTo(master, frames[f], { x0: FEET_X + 2, x1: SIZE - 1, y0: GROUND - 4, y1: GROUND - 1 });
      } else if (strip.like) {
        const how = strip.anchors[f - 1];
        const want = await installedSpot(strip.like[f - 1], how);
        const got = locate((x, y) => frames[f][y][x] !== '.', SIZE, SIZE, HEAD_ROWS, how);
        fit = { dx: Math.round(FEET_X + 0.5 + want[0] - got[0]), dy: Math.round(GROUND + want[1] - got[1]) };
      }
      write(`${pose}.txt`, shift(frames[f], fit.dx, fit.dy), `${pose}. Imported from source/${name}.png frame ${f + 1}${strip.like ? `, a redraw of installed ${strip.like[f - 1]}` : ''}.`);
      console.log(`wrote poses/${pose}.txt (moved ${fit.dx},${fit.dy})`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
