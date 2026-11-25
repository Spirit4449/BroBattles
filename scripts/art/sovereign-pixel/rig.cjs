const fs = require('node:fs');
const path = require('node:path');
const PALETTE = require('./palette.cjs');
const { createRig, rotateAbout, mul, translate } = require('../pixel-rig/rig.cjs');

const SIZE = 72;
const DRAWINGS = new Map();
for (const block of fs.readFileSync(path.join(__dirname, 'poses.txt'), 'utf8').matchAll(
  /^\[(\w+) (\d+) (\d+)\]\n([.\w\n]+?)(?=\n\[|(?![\s\S]))/gm,
)) {
  const [, name, x, y, rows] = block;
  const grid = rows.trimEnd().split('\n');
  const width = Math.max(...grid.map(row => row.length));
  DRAWINGS.set(name, { at: [Number(x), Number(y)], rows: grid.map(row => row.padEnd(width, '.')) });
}

// Separate a key drawing into registered layers for independent transforms.
// Leave the original key drawing readable as one pixel map in poses.txt.
function split(name, selection) {
  const part = DRAWINGS.get(name);
  const layers = Object.fromEntries(['back', 'body', 'front'].map(key => [key, {
    at: part.at, rows: part.rows.map((row, ry) => [...row].map((ch, rx) =>
      selection(part.at[0] + rx, part.at[1] + ry) === key ? ch : '.').join('')),
  }]));
  return layers;
}

const cached = new Map();
function layersRig(layers) {
  const parts = Object.fromEntries(layers.map(([key, name, includes = () => true]) => {
    const { at, rows } = DRAWINGS.get(name);
    return [key, { at, rows: rows.map((row, dy) => [...row].map((ch, dx) =>
      includes(at[0] + dx, at[1] + dy) ? ch : '.').join('')) }];
  }));
  return createRig({ SIZE, PALETTE, PARTS: parts, outline: { k: '1' }, newOutline: 'k' });
}

function rigFor(name, selection) {
  if (!cached.has(name)) {
    const parts = selection ? split(name, selection) : { body: DRAWINGS.get(name) };
    cached.set(name, createRig({ SIZE, PALETTE, PARTS: parts, outline: { k: '1' }, newOutline: 'k' }));
  }
  return cached.get(name);
}

const mix = (a, b, t) => a + (b - a) * t;
function displacement(at, deltas, x, y) {
  let sx = 0; let sy = 0; let sum = 0;
  for (const [i, [px, py]] of at.entries()) {
    const d2 = (x - px) ** 2 + (y - py) ** 2;
    const weight = 1 / (d2 + 10) ** 1.65;
    sx += deltas[i][0] * weight;
    sy += deltas[i][1] * weight;
    sum += weight;
  }
  return [sx / sum, sy / sum];
}

// Resample a single drawn key through its interpolated landmarks, so halfway
// poses stay on one crisp palette and never crossfade into a second silhouette.
function retarget(key, at) {
  const deltas = at.map(([x, y], i) => [key.points[i][0] - x, key.points[i][1] - y]);
  return rigFor(key.name).renderPose({ body: { warp: (x, y) => {
    const [dx, dy] = displacement(at, deltas, x, y);
    return [x + dx, y + dy];
  } } }, { patch: false });
}

function inBetween(from, to, t) {
  if (t === 0) return rigFor(from.name).compose();
  if (t === 1) return rigFor(to.name).compose();
  const key = t <= 0.5 ? from : to;
  const at = from.points.map(([x, y], i) => [mix(x, to.points[i][0], t), mix(y, to.points[i][1], t)]);
  return retarget(key, at);
}

function stamp(pixels, name) {
  const overlay = rigFor(name).compose();
  for (let i = 0; i < pixels.length; i += 4) {
    if (overlay[i + 3]) overlay.copy(pixels, i, i, i + 4);
  }
  return pixels;
}

function pitched(name, pivot, degrees, shift = [0, 0]) {
  const m = mul(translate(...shift), rotateAbout(pivot, degrees));
  // Rotating a long cape can extend past the native cell. Render with room,
  // then shift the whole pose in just enough to preserve its outline.
  const margin = 14;
  const side = SIZE + margin * 2;
  const pixels = rigFor(name).renderPose({ body: { m } }, { patch: false, size: side });
  let left = side; let top = side; let right = 0; let bottom = 0;
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    if (!pixels[(y * side + x) * 4 + 3]) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  if (right - left + 1 > SIZE - 2 || bottom - top + 1 > SIZE - 2) {
    throw new Error(`${name} at ${degrees}° is too large for the Sovereign cell`);
  }
  const x = Math.max(right - SIZE + 2, Math.min(margin, left - 1));
  const y = Math.max(bottom - SIZE + 2, Math.min(margin, top - 1));
  const crop = Buffer.alloc(SIZE * SIZE * 4);
  for (let row = 0; row < SIZE; row++) {
    const start = ((y + row) * side + x) * 4;
    pixels.copy(crop, row * SIZE * 4, start, start + SIZE * 4);
  }
  return crop;
}

module.exports = { SIZE, rigFor, layersRig, inBetween, pitched, stamp };
