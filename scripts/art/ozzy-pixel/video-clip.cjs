// Imports Ozzy's animations from image-to-video clips (grey backdrop),
// keeping the clips' own pixels with light cleanup. idle-video.cjs and
// run-video.cjs import looping clips (importClip); actions-video.cjs picks
// frames out of one-shot clips with the stages below.
//
// 1. Sample: the clips were animated from the game art, so one art pixel is a
//    fixed GRID-px square. Every frame is sampled on the same grid (no
//    per-frame fit or resize); each art pixel is the median of its inner
//    block, which ignores compression ringing at the cell edges.
// 2. Key: the flat backdrop and the soft ground shadow get hard alpha.
// 3. Place: the clip's first frame (the rest pose) is aligned to the
//    code-drawn idle00: soles on its sole row, then the best horizontal
//    overlap. Every frame gets that same offset, so motion in the clip is
//    kept (a one-shot clip may then re-anchor frames, see anchorCells).
// 4. Colour: the clip's own colours, reduced to a palette learned from it.
// 5. Loop: cut between the two most similar frames whose distance lies in
//    [minLoop, maxLoop], starting no earlier than `from` (skips a lead-in).
// 6. Clean: with `majority` each played frame is the per-pixel majority of
//    three neighbouring source frames, so one-frame flickers drop out. Lone
//    specks are removed. Nothing else is changed.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE } = require('./pose.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const ASSETS = path.join(ROOT, 'public/assets/ozzy');
const CELL = 128;
const ART_AT = [16, 104 - SIZE]; // sheet.cjs: rest-art origin in the cell
const GRID = 16.59; // video px per art px of the idle and run clips (fitted to their edges)
const SOURCE_FPS = 24;
const COLOURS = 32; // palette learned from the clip
const REVIEW_BG = '#303947';

function decode(file) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file]).toString().trim().split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:v:0',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 2 ** 31 });
  const count = raw.length / (w * h * 3);
  return { w, h, count, frame: (f) => raw.subarray(f * w * h * 3, (f + 1) * w * h * 3) };
}

// Grid phase from edge positions; the vertical phase from the bottom quarter
// (planted legs) only, since a breathing torso drifts by sub-pixels.
function phase(video, axis, region, GRID) {
  let c = 0; let s = 0;
  for (let f = 0; f < video.count; f += 6) {
    const px = video.frame(f);
    for (let y = region.y0; y < region.y1; y += 2) for (let x = region.x0; x < region.x1; x++) {
      const i = (y * video.w + x) * 3; const j = axis === 'x' ? i + 3 : i + video.w * 3;
      if (Math.abs(px[i] - px[j]) + Math.abs(px[i + 1] - px[j + 1]) + Math.abs(px[i + 2] - px[j + 2]) <= 50) continue;
      const a = 2 * Math.PI * ((axis === 'x' ? x : y) + 0.5) / GRID; c += Math.cos(a); s += Math.sin(a);
    }
  }
  return ((Math.atan2(s, c) / (2 * Math.PI)) * GRID + GRID) % GRID;
}

const median = (v) => { v.sort((a, b) => a - b); return v[v.length >> 1]; };

function sample(video, f, grid, bg) {
  const px = video.frame(f); const { cols, rows, x0, y0, size: GRID } = grid;
  const r4 = Math.max(2, Math.round(GRID / 4)); // inner block half-size
  const out = Buffer.alloc(cols * rows * 4);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const cx = x0 + (c + 0.5) * GRID; const cy = y0 + (r + 0.5) * GRID;
    const ch = [[], [], []];
    for (let y = Math.round(cy - r4); y <= Math.round(cy + r4); y++) for (let x = Math.round(cx - r4); x <= Math.round(cx + r4); x++) {
      const i = (y * video.w + x) * 3; ch[0].push(px[i]); ch[1].push(px[i + 1]); ch[2].push(px[i + 2]);
    }
    const [R, G, B] = ch.map(median);
    const dist = Math.abs(R - bg[0]) + Math.abs(G - bg[1]) + Math.abs(B - bg[2]);
    // The ground shadow is the backdrop grey, darker: neutral, g and b a few
    // levels above r. The art's outline and boots are warmer or much darker.
    const shadow = R >= 50 && R <= bg[0] && G - R >= 2 && G - R <= 10 && Math.abs(G - B) <= 4;
    if (dist < 30 || shadow) continue;
    const o = (r * cols + c) * 4;
    out[o] = R; out[o + 1] = G; out[o + 2] = B; out[o + 3] = 255;
  }
  return out;
}

// Drop specks: opaque pixels with no opaque 4-neighbour.
function despeckle(buf, w, h) {
  const a = (x, y) => x >= 0 && y >= 0 && x < w && y < h && buf[(y * w + x) * 4 + 3];
  const out = Buffer.from(buf);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y) && !(a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) out.fill(0, (y * w + x) * 4, (y * w + x) * 4 + 4);
  }
  return out;
}

const keyOf = (f, p) => (f[p + 3] ? (f[p] << 16) | (f[p + 1] << 8) | f[p + 2] : -1);
const put = (out, p, k) => { if (k === -1) out.fill(0, p, p + 4);
  else { out[p] = k >> 16; out[p + 1] = (k >> 8) & 255; out[p + 2] = k & 255; out[p + 3] = 255; } };
const diff = (a, b) => { let n = 0; for (let p = 0; p < a.length; p += 4) if (keyOf(a, p) !== keyOf(b, p)) n++; return n; };
function modeOf(list, p, prefer) {
  const counts = new Map();
  for (const f of list) { const k = keyOf(f, p); counts.set(k, (counts.get(k) || 0) + 1); }
  let best = keyOf(prefer, p); let bestN = counts.get(best) || 0;
  for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
  return [best, bestN];
}

// Keyed like sample(), at full video resolution.
const isArt = (px, i, bg) => {
  const R = px[i]; const G = px[i + 1]; const B = px[i + 2];
  const shadow = R >= 50 && R <= bg[0] && G - R >= 2 && G - R <= 10 && Math.abs(G - B) <= 4;
  return Math.abs(R - bg[0]) + Math.abs(G - bg[1]) + Math.abs(B - bg[2]) >= 30 && !shadow;
};

// Video px per art px for a clip framed at another zoom: the rest pose's
// height against the reference art's gives a first guess, then the size
// whose grid best lines up with the art's pixel edges (horizontal edges of
// the opening frames) within 4% of it.
function fitGrid(video, bg, artHeight) {
  const px = video.frame(0); let top = video.h; let bottom = -1;
  for (let y = 0; y < video.h; y++) for (let x = 0; x < video.w; x += 2) if (isArt(px, (y * video.w + x) * 3, bg)) { top = Math.min(top, y); bottom = Math.max(bottom, y); }
  const guess = (bottom - top + 1) / artHeight;
  const edges = [];
  for (let f = 0; f < Math.min(6, video.count); f += 2) {
    const fr = video.frame(f);
    for (let y = Math.max(0, top - 4); y < Math.min(video.h, bottom + 4); y += 2) for (let x = 0; x < video.w - 1; x++) {
      const i = (y * video.w + x) * 3; const j = i + 3;
      if (Math.abs(fr[i] - fr[j]) + Math.abs(fr[i + 1] - fr[j + 1]) + Math.abs(fr[i + 2] - fr[j + 2]) > 50) edges.push(x + 0.5);
    }
  }
  let best = null;
  for (let size = guess * 0.96; size <= guess * 1.04; size += 0.002) {
    let c = 0; let s = 0;
    for (const x of edges) { const a = 2 * Math.PI * x / size; c += Math.cos(a); s += Math.sin(a); }
    const score = Math.hypot(c, s) / edges.length;
    if (!best || score > best.score) best = { size, score };
  }
  return { size: +best.size.toFixed(3), guess: +guess.toFixed(3), coherence: +best.score.toFixed(3) };
}

// Stages 1-4 for a whole clip: every source frame as a placed, palette-reduced
// CELL x CELL RGBA buffer. `clipped` counts the pixels each frame loses
// outside the cell.
// The staff crystal's soft glow keyed as art: the grey backdrop tinted cyan.
// The crystal itself is far brighter (green 160+) or a dark outline (red < 50).
const isGlow = ([r, g, b]) => r >= 60 && g - r >= 20 && b - r >= 20 && g < 140;

// gridSize: video px per art px, or 'fit' to measure it (fitGrid).
// dropGlow: palette colours that are crystal glow become transparent.
// distinct: palette slots kept for rare, distinct colours (learnPalette).
function prepareClip(file, { gridSize = GRID, dropGlow = false, distinct = 0 } = {}) {
  const video = decode(file);
  const bg = [0, 1, 2].map((k) => median([[5, 5], [video.w - 6, 5], [5, video.h - 6], [video.w - 6, video.h - 6]]
    .map(([x, y]) => video.frame(0)[(y * video.w + x) * 3 + k])));

  // Reference: the code-drawn idle00 (idle.cjs) as sheet.cjs places it, so a
  // rerun after --install still lines up against the original art.
  const refFrame = require('./idle.cjs').FRAMES[0];
  const side = Math.sqrt(refFrame.length / 4); const margin = (side - SIZE) / 2;
  const ref = Buffer.alloc(CELL * CELL * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const tx = x + ART_AT[0] - margin; const ty = y + ART_AT[1] - margin; const s = (y * side + x) * 4;
    if (refFrame[s + 3] && tx >= 0 && ty >= 0 && tx < CELL && ty < CELL) refFrame.copy(ref, (ty * CELL + tx) * 4, s, s + 4);
  }
  const refA = (x, y) => ref[(y * CELL + x) * 4 + 3] > 0;
  let refTop = CELL; let refBottom = -1;
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (refA(x, y)) { refTop = Math.min(refTop, y); refBottom = y; }

  const fit = gridSize === 'fit' ? fitGrid(video, bg, refBottom - refTop + 1) : null;
  const size = fit ? fit.size : gridSize;
  const px = phase(video, 'x', { x0: 0, x1: video.w - 1, y0: 0, y1: video.h - 1 }, size);
  const py = phase(video, 'y', { x0: 0, x1: video.w - 1, y0: Math.round(video.h * 0.75), y1: video.h - 2 }, size);
  // Whole cells only: a cell cut by the frame edge would sample outside it.
  const grid = { x0: px, y0: py, size, fit };
  grid.cols = Math.floor((video.w - grid.x0) / size); grid.rows = Math.floor((video.h - grid.y0) / size);
  const { cols, rows } = grid;
  const raw = [];
  for (let f = 0; f < video.count; f++) raw.push(despeckle(sample(video, f, grid, bg), cols, rows));

  // Place: soles on the reference's sole row, then the horizontal shift with
  // the most overlap. Every clip opens on the rest pose.
  const first = raw[0];
  const box = { x0: cols, y0: rows, x1: -1, y1: -1 };
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) if (first[(y * cols + x) * 4 + 3]) {
    box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y); }
  const dy = refBottom - box.y1;
  let place = null;
  for (let dx = -box.x0 - 20; dx < CELL - box.x1 + 20; dx++) {
    let hit = 0;
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) {
      const tx = x + dx; const ty = y + dy;
      if (first[(y * cols + x) * 4 + 3] && tx >= 0 && tx < CELL && ty >= 0 && ty < CELL && refA(tx, ty)) hit++;
    }
    if (!place || hit > place.hit) place = { dx, hit };
  }
  place.dy = dy;

  // Colour: keep the clip's own colours, reduced to a COLOURS-colour palette
  // learned from the pixels placed in the cell (k-means), which drops
  // compression noise. Every pixel is then mapped to it, so pixels a one-shot
  // clip later anchors into the cell have a colour too.
  const samples = [];
  for (const buf of raw) for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const tx = x + place.dx; const ty = y + dy; const s = (y * cols + x) * 4;
    if (buf[s + 3] && tx >= 0 && ty >= 0 && tx < CELL && ty < CELL) samples.push([buf[s], buf[s + 1], buf[s + 2]]);
  }
  const { centres, palette } = learnPalette(samples, { distinct });
  const nearest = nearestOf(centres); // unrounded centres choose, rounded ones paint
  const frames = raw.map((buf) => {
    const out = Buffer.from(buf);
    for (let i = 0; i < out.length; i += 4) if (out[i + 3]) {
      const p = palette[nearest([buf[i], buf[i + 1], buf[i + 2]])];
      if (dropGlow && isGlow(p)) { out.fill(0, i, i + 4); continue; }
      out[i] = p[0]; out[i + 1] = p[1]; out[i + 2] = p[2];
    }
    return out;
  });
  return { file, video: { w: video.w, h: video.h, count: video.count }, bg, grid, place, palette, frames,
    cell: (f, shift = [0, 0]) => toCell(frames[f], grid, [place.dx + shift[0], place.dy + shift[1]]) };
}

const nearestOf = (palette) => (c) => { let best = 0; let bestD = Infinity;
  palette.forEach((p, n) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bestD) { bestD = d; best = n; } });
  return best; };

// distinct: that many of the starting colours are picked as the colours
// farthest from the others (among those on at least MIN_DISTINCT pixels)
// instead of the most common, so a small bright detail such as the staff
// crystal keeps its own colour.
const MIN_DISTINCT = 40;
function learnPalette(samples, { distinct = 0 } = {}) {
  const bins = new Map();
  for (const c of samples) { const b = ((c[0] >> 3) << 10) | ((c[1] >> 3) << 5) | (c[2] >> 3); const e = bins.get(b) || [0, 0, 0, 0];
    e[0] += c[0]; e[1] += c[1]; e[2] += c[2]; e[3]++; bins.set(b, e); }
  const byCount = [...bins.values()].sort((a, b) => b[3] - a[3]).map((e) => [e[0] / e[3], e[1] / e[3], e[2] / e[3], e[3]]);
  let centres = byCount.slice(0, COLOURS - distinct).map((e) => e.slice(0, 3));
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  for (let k = 0; k < distinct; k++) {
    let far = null;
    for (const e of byCount) if (e[3] >= MIN_DISTINCT) {
      const d = Math.min(...centres.map((c) => d2(c, e)));
      if (!far || d > far.d) far = { d, e };
    }
    if (far) centres.push(far.e.slice(0, 3));
  }
  for (let iter = 0; iter < 12; iter++) {
    const nearest = nearestOf(centres);
    const sums = centres.map(() => [0, 0, 0, 0]);
    for (let n = 0; n < samples.length; n += 3) { const c = samples[n]; const s = sums[nearest(c)]; s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; s[3]++; }
    centres = centres.map((p, n) => (sums[n][3] ? sums[n].slice(0, 3).map((v) => v / sums[n][3]) : p));
  }
  return { centres, palette: centres.map((p) => p.map(Math.round)) };
}

// A sampled frame (grid cols x rows) moved by `offset` into a CELL x CELL cell.
function toCell(buf, grid, [dx, dy]) {
  const { cols, rows } = grid;
  const out = Buffer.alloc(CELL * CELL * 4); let clipped = 0;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    const s = (y * cols + x) * 4; if (!buf[s + 3]) continue;
    const tx = x + dx; const ty = y + dy;
    if (tx < 0 || ty < 0 || tx >= CELL || ty >= CELL) { clipped++; continue; }
    buf.copy(out, (ty * CELL + tx) * 4, s, s + 4);
  }
  out.clipped = clipped;
  return out;
}

// Opaque-pixel statistics of a cell: bounding box and centre of mass.
function stats(cell) {
  let n = 0; let sx = 0; let sy = 0; const box = { x0: CELL, y0: CELL, x1: -1, y1: -1 };
  for (let y = 0; y < CELL; y++) for (let x = 0; x < CELL; x++) if (cell[(y * CELL + x) * 4 + 3]) {
    n++; sx += x; sy += y; box.x0 = Math.min(box.x0, x); box.y0 = Math.min(box.y0, y); box.x1 = Math.max(box.x1, x); box.y1 = Math.max(box.y1, y);
  }
  return { n, cx: n ? sx / n : 0, cy: n ? sy / n : 0, ...box };
}

// Stage 6 for a chosen list of source frames. `around` gives each played
// frame's neighbours for the majority: 'loop' wraps, 'clamp' repeats the ends.
function cleanFrames(cells, { majority = true, around = 'clamp' } = {}) {
  const len = cells.length;
  return cells.map((cell, i) => {
    let out = cell;
    if (majority && cell.neighbours) {
      out = Buffer.alloc(CELL * CELL * 4);
      for (let p = 0; p < out.length; p += 4) put(out, p, modeOf(cell.neighbours, p, cell)[0]);
    } else if (majority) {
      const at = (k) => (around === 'loop' ? cells[(k + len) % len] : cells[Math.max(0, Math.min(len - 1, k))]);
      const near = [at(i - 1), cell, at(i + 1)];
      out = Buffer.alloc(CELL * CELL * 4);
      for (let p = 0; p < out.length; p += 4) put(out, p, modeOf(near, p, cell)[0]);
    }
    return despeckle(out, CELL, CELL);
  });
}

// Previews: a 4x GIF on the review backdrop and a strip of every pose.
async function writePreviews(dir, name, cells, durations) {
  fs.mkdirSync(dir, { recursive: true });
  const SCALE = 4;
  // Composite first: sharp applies resize before composite in one pipeline.
  const preview = async (cell) => sharp(await sharp({ create: { width: CELL, height: CELL, channels: 4, background: REVIEW_BG } })
    .composite([{ input: cell, raw: { width: CELL, height: CELL, channels: 4 } }]).png().toBuffer())
    .resize(CELL * SCALE, CELL * SCALE, { kernel: 'nearest' }).raw().toBuffer();
  const big = await Promise.all(cells.map(preview));
  await sharp(Buffer.concat(big), { raw: { width: CELL * SCALE, height: CELL * SCALE * big.length, channels: 4, pageHeight: CELL * SCALE } })
    .gif({ delay: durations.map(Math.round), loop: 0 }).toFile(path.join(dir, `${name}.gif`));
  await sharp({ create: { width: CELL * SCALE * cells.length, height: CELL * SCALE, channels: 4, background: REVIEW_BG } })
    .composite(big.map((b, i) => ({ input: b, raw: { width: CELL * SCALE, height: CELL * SCALE, channels: 4 }, left: i * CELL * SCALE, top: 0 })))
    .png().toFile(path.join(dir, name === 'idle' || name === 'running' ? 'frames.png' : `${name}-frames.png`));
}

// Replaces each group's `<name>NN` cells in the sheet and atlas: reuses the
// group's existing cells, then free cells left by other groups, then appends
// rows. Groups whose name no longer has frames free their cells too.
async function installCells(groups, { remove = [] } = {}) {
  const sheet = await sharp(path.join(ASSETS, 'spritesheet.webp')).raw().toBuffer({ resolveWithObject: true });
  const atlas = JSON.parse(fs.readFileSync(path.join(ASSETS, 'animations.json'), 'utf8'));
  const W = sheet.info.width; const COLS = W / CELL;
  const owns = (row, name) => new RegExp(`^${name}\\d+$`).test(row.filename);
  const replaced = [...groups.map((g) => g.name), ...remove];
  const keep = atlas.frames.filter((r) => !replaced.some((n) => owns(r, n)));
  const freed = atlas.frames.filter((r) => replaced.some((n) => owns(r, n))).map((r) => r.frame);
  const ownFree = new Map(groups.map((g) => [g.name, atlas.frames.filter((r) => owns(r, g.name)).map((r) => r.frame)]));
  const usedKeep = new Set(keep.map((r) => `${r.frame.x},${r.frame.y}`));
  const taken = new Set(usedKeep);
  const pool = freed.filter((f) => !usedKeep.has(`${f.x},${f.y}`));
  let next = Math.ceil(Math.max(0, ...[...usedKeep, ...pool.map((f) => `${f.x},${f.y}`)]
    .map((k) => { const [x, y] = k.split(',').map(Number); return (y / CELL) * COLS + x / CELL + 1; })) / COLS) * COLS;
  const claim = (f) => { const k = `${f.x},${f.y}`; if (taken.has(k)) return false; taken.add(k); return true; };
  const rows = [];
  for (const g of groups) {
    const own = [...ownFree.get(g.name)];
    g.cells.forEach((cell, i) => {
      let slot = own.find(claim);
      if (slot) own.splice(own.indexOf(slot), 1);
      else slot = pool.find(claim);
      if (!slot) { do { slot = { x: (next % COLS) * CELL, y: Math.floor(next / COLS) * CELL }; next++; } while (!claim(slot)); }
      rows.push({ name: `${g.name}${String(i).padStart(2, '0')}`, slot, cell });
    });
  }
  const height = Math.max(...keep.map((r) => r.frame.y + CELL), ...rows.map((r) => r.slot.y + CELL));
  const data = Buffer.alloc(W * height * 4);
  sheet.data.copy(data, 0, 0, Math.min(sheet.data.length, data.length));
  for (const f of freed) if (f.y + CELL <= height) for (let y = 0; y < CELL; y++) data.fill(0, ((f.y + y) * W + f.x) * 4, ((f.y + y) * W + f.x + CELL) * 4);
  for (const r of rows) for (let y = 0; y < CELL; y++) r.cell.copy(data, ((r.slot.y + y) * W + r.slot.x) * 4, y * CELL * 4, (y + 1) * CELL * 4);
  await sharp(data, { raw: { width: W, height, channels: 4 } }).webp({ lossless: true }).toFile(path.join(ASSETS, 'spritesheet.webp'));
  const atlasRow = (r) => ({ filename: r.name, frame: { x: r.slot.x, y: r.slot.y, w: CELL, h: CELL }, rotated: false, trimmed: false,
    spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
  const idleRows = rows.filter((r) => /^idle\d+$/.test(r.name)).map(atlasRow);
  atlas.frames = [...idleRows, ...keep, ...rows.filter((r) => !/^idle\d+$/.test(r.name)).map(atlasRow)];
  atlas.meta.size = { w: W, h: height };
  fs.writeFileSync(path.join(ASSETS, 'animations.json'), `${JSON.stringify(atlas, null, 1)}\n`);
  for (const g of groups) console.log(`installed ${g.cells.length} ${g.name} frames`);
}

// name: atlas frame prefix (idle, running). step: play every step-th source
// frame. from/minLoop/maxLoop: loop search bounds in source frames.
async function importClip({ file, name, step = 1, majority = true, from = 0, minLoop, maxLoop = Infinity, install = false }) {
  const playFps = SOURCE_FPS / step;
  const OUT = path.join(ROOT, `output/ozzy-pixel/${name}-video`);
  const clip = prepareClip(file);
  const count = clip.frames.length;
  const frames = clip.frames.map((_, f) => clip.cell(f));

  // Loop cut: the most similar pair within the bounds, a multiple of step
  // frames so every step-th frame divides it.
  let cut = null;
  for (let a = from; a < count; a++) for (let b = a + minLoop; b < count && b - a <= maxLoop; b += 1) {
    if ((b - a) % step) continue;
    const score = diff(frames[a], frames[b]);
    if (!cut || score < cut.score || (score === cut.score && b - a > cut.b - cut.a)) cut = { a, b, score };
  }
  const len = cut.b - cut.a;
  const loop = frames.slice(cut.a, cut.b);
  loop.forEach((c, i) => { if (c.clipped) console.warn(`warning: source frame ${cut.a + i} loses ${c.clipped} px outside the cell`); });

  // Every step-th frame plays; each is the majority of its circular neighbours.
  const picked = []; const sourceFrames = [];
  for (let i = 0; i < len; i += step) {
    const cell = loop[i];
    cell.neighbours = [loop[(i - 1 + len) % len], loop[i], loop[(i + 1) % len]];
    picked.push(cell); sourceFrames.push(cut.a + i);
  }
  const cells = cleanFrames(picked, { majority });
  const steps = cells.map((c, i) => diff(c, cells[(i + 1) % cells.length]));
  console.log(`loop ${cut.a}-${cut.b} (seam ${cut.score}) | ${cells.length} frames | steps ${steps.slice(0, -1).join(' ')} | wrap ${steps[steps.length - 1]}`);

  fs.mkdirSync(OUT, { recursive: true });
  const meta = { source: path.basename(file), grid: { size: clip.grid.size, x0: +clip.grid.x0.toFixed(2), y0: +clip.grid.y0.toFixed(2) },
    background: clip.bg, palette: clip.palette.map((c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`),
    loop: { from: cut.a, to: cut.b, seamScore: cut.score }, fps: playFps,
    placement: { dx: clip.place.dx, dy: clip.place.dy }, frames: sourceFrames.map((f, i) => ({ name: `${name}${String(i).padStart(2, '0')}`, sourceFrame: f })) };
  fs.writeFileSync(path.join(OUT, `${name}-video.json`), `${JSON.stringify(meta, null, 2)}\n`);
  await writePreviews(OUT, name, cells, cells.map(() => 1000 / playFps));
  console.log(`wrote ${cells.length} poses to ${path.relative(ROOT, OUT)}`);
  if (install) await installCells([{ name, cells }]);
  return meta;
}

module.exports = { importClip, prepareClip, cleanFrames, installCells, writePreviews, stats, diff, CELL, SOURCE_FPS, ROOT, ASSETS };
