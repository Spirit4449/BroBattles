#!/usr/bin/env node
// Renders the code-defined Huntress (parts.cjs) to pixels.
//   node scripts/art/huntress-pixel/render.cjs            -> output/huntress-pixel/
//   node scripts/art/huntress-pixel/render.cjs --compare  also diffs against public/assets/huntress/body.webp
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, PALETTE, PARTS } = require('./parts.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/huntress-pixel');
const REFERENCE = path.join(ROOT, 'public/assets/huntress/body.webp');
const BODY_SIZE = 1254;

const RGB = Object.fromEntries(Object.entries(PALETTE).map(([ch, hex]) => [ch, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));

// Affine transforms as [a, b, c, d, e, f]: x' = a*x + c*y + e, y' = b*x + d*y + f.
// Angles are degrees, positive = clockwise on screen.
const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const translate = (dx, dy) => [1, 0, 0, 1, dx, dy];
function rotateAbout([px, py], deg) {
  const r = (deg * Math.PI) / 180;
  const c = Math.cos(r); const s = Math.sin(r);
  return [c, s, -s, c, px - c * px + s * py, py - s * px - c * py];
}
const apply = (m, [x, y]) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

// RotSprite-style resampling: each part is upscaled 8x with Scale2x (which keeps
// outlines and diagonals crisp), and transformed parts sample that upscale at
// each output pixel's centre. Small rotations stay pixel-art instead of jaggy.
const UP = 8;
function scale2x(grid) {
  const h = grid.length; const w = grid[0].length;
  const at = (x, y) => grid[Math.min(h - 1, Math.max(0, y))][Math.min(w - 1, Math.max(0, x))];
  const out = Array.from({ length: h * 2 }, () => new Array(w * 2));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const P = at(x, y); const A = at(x, y - 1); const B = at(x + 1, y); const C = at(x - 1, y); const D = at(x, y + 1);
    out[2 * y][2 * x] = C === A && C !== D && A !== B ? A : P;
    out[2 * y][2 * x + 1] = A === B && A !== C && B !== D ? B : P;
    out[2 * y + 1][2 * x] = D === C && D !== B && C !== A ? C : P;
    out[2 * y + 1][2 * x + 1] = B === D && B !== A && D !== C ? D : P;
  }
  return out;
}
const PAD = 1;

// The outer outline (an outline pixel touching empty space in the rest pose) is
// tagged so a pose can rebuild it: rotated 1px outlines otherwise break into
// stair-steps and double up. '1'/'2' draw exactly like 'k'/'K'.
const HINT = { k: '1', K: '2' };
RGB['1'] = RGB.k; RGB['2'] = RGB.K;
const REST_CHARS = Array.from({ length: SIZE }, () => new Array(SIZE).fill('.'));
for (const part of Object.values(PARTS)) if (!part.poseOnly) part.rows.forEach((row, ry) => {
  for (let rx = 0; rx < row.length; rx++) if (row[rx] !== '.') REST_CHARS[part.at[1] + ry][part.at[0] + rx] = row[rx];
});
const emptyAt = (x, y) => (REST_CHARS[y]?.[x] ?? '.') === '.';
const UPSCALED = Object.fromEntries(Object.entries(PARTS).map(([name, part]) => {
  const w = part.rows[0].length + PAD * 2;
  let grid = Array.from({ length: part.rows.length + PAD * 2 }, (_, gy) => Array.from({ length: w }, (_, gx) => {
    const ch = part.rows[gy - PAD]?.[gx - PAD] ?? '.';
    const x = part.at[0] + gx - PAD; const y = part.at[1] + gy - PAD;
    const outer = HINT[ch] && (emptyAt(x - 1, y) || emptyAt(x + 1, y) || emptyAt(x, y - 1) || emptyAt(x, y + 1));
    return outer ? HINT[ch] : ch;
  }));
  for (let s = 1; s < UP; s *= 2) grid = scale2x(grid);
  return [name, grid];
}));

function sample(name, x, y) {
  const part = PARTS[name];
  const gx = Math.floor((x - part.at[0] + PAD) * UP);
  const gy = Math.floor((y - part.at[1] + PAD) * UP);
  return UPSCALED[name][gy]?.[gx];
}

// pose: { [partName]: { m, warp, hidden } }. `m` maps rest-pose canvas points to
// where they are drawn; `warp(x, y)` instead returns the rest-pose point to read
// for an output point (for bends an affine can't express). Unlisted parts stay put.
// Returns the drawn chars, back to front, so the outline pass knows what is fill,
// and for each pixel the rest-pose pixel it was read from. A `size` above SIZE
// renders onto a larger canvas with the rest art centred, for poses (mid-air,
// tilted bow) that reach past the 64px canvas.
function composeChars(pose = {}, size = SIZE) {
  const margin = (size - SIZE) / 2;
  const chars = new Array(size * size).fill('.');
  const src = new Int32Array(size * size).fill(-1);
  for (const name of Object.keys(PARTS)) {
    const p = pose[name] || {};
    if (p.hidden || (PARTS[name].poseOnly && !pose[name])) continue;
    // A part that only slides lands on whole pixels: sampling the Scale2x upscale
    // off-centre would reshape its diagonals (eyes, hair tips) for no visible gain.
    let m = p.m || IDENTITY;
    if (m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1) m = translate(Math.round(m[4]), Math.round(m[5]));
    const inv = invert(m);
    const back = p.warp || ((x, y) => apply(inv, [x, y]));
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const [sx, sy] = back(x + 0.5 - margin, y + 0.5 - margin);
      const ch = sample(name, sx, sy);
      if (ch && ch !== '.') {
        chars[y * size + x] = ch;
        src[y * size + x] = Math.floor(sy) * SIZE + Math.floor(sx);
      }
    }
  }
  chars.src = src;
  return chars;
}

function toPixels(chars) {
  const px = Buffer.alloc(chars.length * 4);
  chars.forEach((ch, i) => {
    const rgb = RGB[ch];
    if (rgb) { px.set(rgb, i * 4); px[i * 4 + 3] = 255; }
  });
  return px;
}

const compose = (pose, size) => toPixels(composeChars(pose, size));

// A posed frame, cleaned the way a pixel artist would after moving limbs:
//  1. drop the outer outline and keep only the fill,
//  2. close seams the pose opened inside the body with the rest-pose fill,
//  3. delete stray single fill pixels,
//  4. redraw a 1px outline: the part's own outline where it still hugs the fill,
//     plus new outline wherever fill was left touching empty space,
//  5. trim outline pixels that only double up a corner.
// The artist left some fill edges bare and some outline corners doubled; those
// rest-pose pixels are passed in as `keep` so steps 4 and 5 leave them alone.
// `patch: false` skips step 2 for poses that move parts far from their rest
// places, where the rest pose's pixels would be the wrong part entirely.
const isHint = (ch) => ch === '1' || ch === '2';
const REST = composeChars();
// `size` above SIZE renders on a larger canvas with the rest art centred (see composeChars).
function renderPose(pose, { keep = REST_KEEP, patch = true, size = SIZE } = {}) {
  const chars = composeChars(pose, size);
  const { src } = chars;
  const hint = chars.map((ch) => isHint(ch));
  const fill = chars.map((ch) => ch !== '.' && !isHint(ch) ? ch : '.');
  const at = (grid, x, y) => (x >= 0 && y >= 0 && x < size && y < size ? grid[y * size + x] : '.');
  const solid = (x, y) => at(fill, x, y) !== '.';
  const N4 = [[-1, 0], [1, 0], [0, -1], [0, 1]];
  const N8 = [...N4, [-1, -1], [1, -1], [-1, 1], [1, 1]];

  const margin = (size - SIZE) / 2;
  const restAt = (x, y) => (x >= 0 && y >= 0 && x < SIZE && y < SIZE ? REST[y * SIZE + x] : '.');
  for (let pass = 0; patch && pass < 3; pass++) {
    const add = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const restCh = restAt(x - margin, y - margin);
      if (solid(x, y) || restCh === '.' || isHint(restCh)) continue;
      const n = N4.filter(([dx, dy]) => solid(x + dx, y + dy)).length;
      const across = (solid(x - 1, y) || solid(x - 2, y)) && (solid(x + 1, y) || solid(x + 2, y));
      const down = (solid(x, y - 1) || solid(x, y - 2)) && (solid(x, y + 1) || solid(x, y + 2));
      if (n >= 3 || across || down) add.push([i, restCh]);
    }
    for (const [i, ch] of add) fill[i] = ch;
  }

  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (solid(x, y) && !N4.some(([dx, dy]) => solid(x + dx, y + dy))) fill[y * size + x] = '.';
  }

  const out = fill.slice();
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    if (solid(x, y) || !hint[i]) continue;
    if (N8.some(([dx, dy]) => solid(x + dx, y + dy))) out[i] = chars[i];
  }
  const filled = (x, y) => at(out, x, y) !== '.';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!solid(x, y) || keep?.bare.has(src[y * size + x])) continue;
    for (const [dx, dy] of N4) {
      if (!filled(x + dx, y + dy) && x + dx >= 0 && y + dy >= 0 && x + dx < size && y + dy < size) out[(y + dy) * size + x + dx] = 'k';
    }
  }

  const line = (x, y) => isHint(at(out, x, y)) || (at(out, x, y) === 'k' && !solid(x, y));
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (!line(x, y) || keep?.corner.has(src[y * size + x]) || N4.some(([dx, dy]) => solid(x + dx, y + dy))) continue;
    const diag = [[-1, -1], [1, -1], [-1, 1], [1, 1]].filter(([dx, dy]) => solid(x + dx, y + dy));
    if (diag.every(([dx, dy]) => line(x + dx, y) && line(x, y + dy))) out[y * size + x] = '.';
  }
  return toPixels(out);
}

// Run the cleanup on the rest pose with nothing protected; whatever it changes
// there is the artist's intent and is protected from then on.
const REST_KEEP = (() => {
  const restPx = compose();
  const cleaned = renderPose({}, { keep: null });
  const bare = new Set(); const corner = new Set();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const was = restPx[i * 4 + 3]; const now = cleaned[i * 4 + 3];
    if (was && !now) corner.add(i);
    if (!was && now) {
      const x = i % SIZE; const y = Math.floor(i / SIZE);
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const j = (y + dy) * SIZE + x + dx;
        if (x + dx >= 0 && y + dy >= 0 && x + dx < SIZE && y + dy < SIZE && REST[j] !== '.' && !isHint(REST[j])) bare.add(j);
      }
    }
  }
  return { bare, corner };
})();

// Moving a part 1-2px opens seams where it used to touch a neighbour. Fill any
// pixel the pose emptied that is now walled in (3+ opaque neighbours, or a slit
// up to 2px wide) with what
// the rest pose had there, so small shifts never show see-through gaps.
function patchHoles(px, rest = compose(), size = SIZE) {
  const alpha = (x, y) => x >= 0 && y >= 0 && x < size && y < size && px[(y * size + x) * 4 + 3];
  for (let pass = 0; pass < 3; pass++) {
    const fill = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (px[i + 3] || !rest[i + 3]) continue;
      const l = alpha(x - 1, y); const r = alpha(x + 1, y); const u = alpha(x, y - 1); const d = alpha(x, y + 1);
      const across = (alpha(x - 1, y) || alpha(x - 2, y)) && (alpha(x + 1, y) || alpha(x + 2, y));
      const down = (alpha(x, y - 1) || alpha(x, y - 2)) && (alpha(x, y + 1) || alpha(x, y + 2));
      if ([l, r, u, d].filter(Boolean).length >= 3 || across || down) fill.push(i);
    }
    for (const i of fill) rest.copy(px, i, i, i + 4);
  }
  return px;
}

const raw = (data, size) => sharp(data, { raw: { width: size, height: size, channels: 4 } });

async function compare(bodyPx) {
  const { data: ref } = await sharp(REFERENCE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let diff = 0;
  for (let i = 0; i < ref.length; i += 4) {
    if (ref[i + 3] !== bodyPx[i + 3] || (ref[i + 3] && (ref[i] !== bodyPx[i] || ref[i + 1] !== bodyPx[i + 1] || ref[i + 2] !== bodyPx[i + 2]))) diff++;
  }
  const total = ref.length / 4;
  console.log(`vs reference: ${total - diff}/${total} pixels identical (${(100 * (1 - diff / total)).toFixed(2)}%)`);
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const logical = compose();
  await raw(logical, SIZE).png().toFile(path.join(OUT_DIR, 'body-64.png'));
  const body = await raw(logical, SIZE).resize(BODY_SIZE, BODY_SIZE, { kernel: 'nearest' }).raw().toBuffer();
  await raw(body, BODY_SIZE).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'body.webp'));
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}/body.webp (${BODY_SIZE}x${BODY_SIZE}) and body-64.png`);
  if (process.argv.includes('--compare')) await compare(body);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { compose, renderPose, patchHoles, mul, translate, rotateAbout, apply, IDENTITY };
