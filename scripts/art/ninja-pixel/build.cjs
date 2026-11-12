#!/usr/bin/env node
// Regenerates everything for Ninja from the editable pixel poses (poses/*.txt,
// assembled by frames.cjs):
//   node scripts/art/ninja-pixel/build.cjs            -> output/ninja-pixel/
//   node scripts/art/ninja-pixel/build.cjs --install  also installs the sheet into the game:
//                                                      public/assets/ninja and ninja.json
//
//   candidate/spritesheet.webp         every clip, 4x nearest
//   candidate/animations.json          Phaser atlas for it
//   candidate/animation-settings.json  clip timing plus the `throw` block the client
//                                      reads (poses, release beat, hand points)
//   candidate/character.json           the `presentation` and `rig` for ninja.json
//   idle-comparison.png  throw-strip.png  handoff.png  movement-frames.png  *.gif
//
// Comparisons are against the sheet this one replaces, kept in ./legacy.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, GROUND, FEET_X: FEET_COLUMN, HEIGHT } = require('./palette.cjs');
const { CLIPS, RELEASE_FRAME, toPixels } = require('./frames.cjs');
const JOINTS = { ground: GROUND, feetX: FEET_COLUMN + 0.5 };
const IDLE = CLIPS[0].frames;
const { getCharacterStats } = require('../../../src/shared/characters/characterStats');
const { getResolvedCharacterBodyConfig } = require('../../../src/shared/characters/characterTuning');
const { characterFrames } = require('../../../src/shared/characters');
const projectile = require('../../../src/shared/characters/ninjaProjectile');
const throwing = require('../../../src/client/game/characters/ninja/throwPresentation');

const ROOT = path.resolve(__dirname, '../../..');
const INSTALLED = path.join(__dirname, 'legacy'); // the sheet this one replaces
const GAME_ASSETS = path.join(ROOT, 'public/assets/ninja');
const CHARACTER_JSON = path.join(ROOT, 'src/shared/characters/ninja.json');
const OUT = path.join(ROOT, 'output/ninja-pixel');
const CANDIDATE = path.join(OUT, 'candidate');

// ---- sheet geometry --------------------------------------------------------
const BAKE = 4; // sheet px per art px: the game filters the sheet, so each art pixel is a crisp block
const MARGIN = 4; // art px of empty border, so neighbouring cells never bleed in
const CELL = (SIZE + MARGIN * 2) * BAKE;
// World px per art px: the same standing height as the installed sheet.
const installedArt = { sourceSize: 256, scale: 0.32, groundY: 240, hudTopOffset: -35 }; // the legacy sheet's hiResArt
const INSTALLED_HEIGHT = 180; // installed idle00, head to sole, in its sheet px
const INSTALLED_SOLE = 251; // row of its soles; they sit a little below `groundY`
const ART_SCALE = (INSTALLED_HEIGHT * installedArt.scale) / HEIGHT;
const PER_ART = installedArt.scale / ART_SCALE; // art px per installed sheet px, for drawing both at one scale
const PORTRAIT_ART = 1.2 / ART_SCALE; // art px per portrait grid cell, at the height it is used in game
const SHEET_SCALE = ART_SCALE / BAKE;
const SOLE_ROW = (MARGIN + JOINTS.ground) * BAKE;
const GROUND_Y = Math.round(SOLE_ROW - ((INSTALLED_SOLE - installedArt.groundY) * installedArt.scale) / SHEET_SCALE);
const FEET_X = (MARGIN + JOINTS.feetX) * BAKE;
const PRESENTATION = { hiResArt: { ...installedArt, sourceSize: CELL, scale: Number(SHEET_SCALE.toFixed(4)), groundY: GROUND_Y, requiresFrame: 'attack00', duckFrame: CLIPS.some((c) => c.key === 'ducking') ? 'duck00' : 'idle00' } };
const RIG = { frame: [CELL, CELL], feet: [FEET_X, GROUND_Y] };

// Sheet row of the sprite position (the point the server moves), as
// spritePresentation.js places it for a hi-res sheet.
function originRow(art) {
  const stats = getCharacterStats('ninja'); const body = getResolvedCharacterBodyConfig('ninja');
  const frame = characterFrames.ninja; const legacy = stats.spriteScale || 1;
  const worldHeight = (frame.h - body.heightShrink) * legacy;
  const centerY = body.offsetY * legacy - (frame.h * legacy) / 2 + worldHeight / 2;
  return art.groundY - (worldHeight / 2 + centerY) / art.scale;
}
const ORIGIN = { x: FEET_X, y: originRow(PRESENTATION.hiResArt) };
const INSTALLED_ORIGIN = { x: 127, y: originRow(installedArt) }; // legacy rig feet column
// Art-grid point -> world px from the sprite position, facing right.
const toWorld = ([x, y]) => [((MARGIN + x) * BAKE - ORIGIN.x) * SHEET_SCALE, ((MARGIN + y) * BAKE - ORIGIN.y) * SHEET_SCALE];

// ---- clips -----------------------------------------------------------------
const RELEASE_MS = CLIPS[1].frames.slice(0, RELEASE_FRAME).reduce((sum, f) => sum + f.ms, 0);
const THROW = { releaseMs: RELEASE_MS, blendMs: 90,
  // The free star starts near the size of the held one and grows as it leaves.
  startScale: 0.5,
  directions: CLIPS.filter((c) => c.direction).map((c) => ({ key: c.direction === 'level' ? null : c.direction, name: c.direction,
    elevation: c.elevation, animation: c.key, hand: toWorld(c.drawn[RELEASE_FRAME].hand).map((v) => Number(v.toFixed(2))) })) };

// ---- tiny software canvas for the previews ---------------------------------
const image = (w, h, fill) => {
  const data = Buffer.alloc(w * h * 4);
  if (fill) for (let i = 0; i < w * h; i++) data.set(fill, i * 4);
  return { w, h, data };
};
async function load(file, region) {
  let img = sharp(file).ensureAlpha();
  if (region) img = img.extract(region);
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  return { w: info.width, h: info.height, data };
}
function over(dst, i, r, g, b, a) {
  if (a <= 0) return;
  const d = dst.data; const k = a / 255;
  d[i] = r * k + d[i] * (1 - k); d[i + 1] = g * k + d[i + 1] * (1 - k); d[i + 2] = b * k + d[i + 2] * (1 - k);
  d[i + 3] = Math.max(d[i + 3], a);
}
// Draws `src` so its point (ax, ay) lands on (px, py). `smooth` filters like the
// game does; otherwise nearest neighbour. `rect` picks a sub-rectangle of src.
function draw(dst, src, { px, py, ax = 0, ay = 0, scale = 1, rot = 0, flip = false, smooth = false, rect = null, alpha = 1 }) {
  const r = rect || { x: 0, y: 0, w: src.w, h: src.h };
  const c = Math.cos(rot); const s = Math.sin(rot); const reach = Math.hypot(r.w, r.h) * scale + 2;
  const x0 = Math.max(0, Math.floor(px - reach)); const x1 = Math.min(dst.w - 1, Math.ceil(px + reach));
  const y0 = Math.max(0, Math.floor(py - reach)); const y1 = Math.min(dst.h - 1, Math.ceil(py + reach));
  const at = (x, y) => (x < 0 || y < 0 || x >= r.w || y >= r.h ? -1 : ((r.y + y) * src.w + r.x + x) * 4);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const dx = x + 0.5 - px; const dy = y + 0.5 - py;
    let u = (dx * c + dy * s) / scale; const v = (-dx * s + dy * c) / scale + ay;
    u = (flip ? -u : u) + ax;
    if (!smooth) {
      const i = at(Math.floor(u), Math.floor(v));
      if (i >= 0) over(dst, (y * dst.w + x) * 4, src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3] * alpha);
      continue;
    }
    const fu = u - 0.5; const fv = v - 0.5; const iu = Math.floor(fu); const iv = Math.floor(fv);
    let rr = 0; let gg = 0; let bb = 0; let aa = 0;
    for (const [ox, oy, w] of [[0, 0, (1 - (fu - iu)) * (1 - (fv - iv))], [1, 0, (fu - iu) * (1 - (fv - iv))], [0, 1, (1 - (fu - iu)) * (fv - iv)], [1, 1, (fu - iu) * (fv - iv)]]) {
      const i = at(iu + ox, iv + oy); if (i < 0) continue;
      const a = (src.data[i + 3] / 255) * w; rr += src.data[i] * a; gg += src.data[i + 1] * a; bb += src.data[i + 2] * a; aa += a;
    }
    if (aa > 0.003) over(dst, (y * dst.w + x) * 4, rr / aa, gg / aa, bb / aa, aa * 255 * alpha);
  }
}
function rectFill(dst, x, y, w, h, [r, g, b, a = 255]) {
  for (let yy = Math.max(0, Math.round(y)); yy < Math.min(dst.h, Math.round(y + h)); yy++) {
    for (let xx = Math.max(0, Math.round(x)); xx < Math.min(dst.w, Math.round(x + w)); xx++) over(dst, (yy * dst.w + xx) * 4, r, g, b, a);
  }
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
// labels: [{ x, y, text, size?, anchor?, color? }], rendered once as an overlay.
async function labels(w, h, items) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${items.map((l) =>
    `<text x="${l.x}" y="${l.y}" font-family="Helvetica, Arial, sans-serif" font-size="${l.size || 13}" font-weight="${l.bold ? 700 : 400}" text-anchor="${l.anchor || 'start'}" fill="${l.color || '#1c2230'}">${esc(l.text)}</text>`).join('')}</svg>`;
  const { data } = await sharp(Buffer.from(svg)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { w, h, data };
}
const savePng = (img, file) => sharp(img.data, { raw: { width: img.w, height: img.h, channels: 4 } }).png().toFile(path.join(OUT, file));
function saveGif(frames, file, fps = 50) {
  const { w, h } = frames[0];
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(fps), '-i', '-',
    '-filter_complex', 'split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(OUT, file)],
  { input: Buffer.concat(frames.map((f) => f.data)), maxBuffer: 1 << 30 });
}

const BG = [128, 136, 144, 255]; const PANEL = [116, 124, 132, 255]; const GUIDE = [255, 255, 255, 70]; const FLOOR = [84, 90, 98, 255];
const artImage = (drawn) => ({ w: SIZE, h: SIZE, data: toPixels(drawn.canvas) });
const clipAt = (frames, t, loop) => {
  const total = frames.reduce((s, f) => s + f.ms, 0);
  let left = loop ? ((t % total) + total) % total : t;
  for (let i = 0; i < frames.length; i++) { if (left < frames[i].ms) return i; left -= frames[i].ms; }
  return loop ? 0 : -1;
};

// ---- baking ----------------------------------------------------------------
// One frame at sheet resolution: each art pixel becomes a BAKE x BAKE block. A
// frame with a `warp` (the idle) instead maps every sheet pixel back to the art
// pixel it shows, so its parts can slide by a single sheet pixel.
function bake(drawn) {
  const art = toPixels(drawn.canvas); const side = SIZE * BAKE; const out = Buffer.alloc(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    let ax = Math.floor(x / BAKE); let ay = Math.floor(y / BAKE);
    if (drawn.warp) {
      const [sx, sy] = drawn.warp((x + 0.5) / BAKE, (y + 0.5) / BAKE);
      ax = Math.floor(sx); ay = Math.floor(sy);
      if (ax < 0 || ay < 0 || ax >= SIZE || ay >= SIZE) continue;
    }
    const i = (ay * SIZE + ax) * 4;
    art.copy(out, (y * side + x) * 4, i, i + 4);
  }
  return out;
}
const bakedImage = (drawn) => ({ w: SIZE * BAKE, h: SIZE * BAKE, data: bake(drawn) });
// Draws a frame with its feet on (px, py) at `scale` screen px per art px.
const drawArt = (img, drawn, px, py, scale) => draw(img, bakedImage(drawn), { px, py, ax: JOINTS.feetX * BAKE, ay: JOINTS.ground * BAKE, scale: scale / BAKE });

// ---- sheet -----------------------------------------------------------------
async function writeSheet() {
  const cols = Math.max(...CLIPS.map((c) => c.frames.length));
  const size = { w: cols * CELL, h: CLIPS.length * CELL };
  const tiles = []; const atlas = [];
  for (const [row, clip] of CLIPS.entries()) for (const [col, drawn] of clip.drawn.entries()) {
    const cell = await sharp(bake(drawn), { raw: { width: SIZE * BAKE, height: SIZE * BAKE, channels: 4 } }).png().toBuffer();
    tiles.push({ input: cell, left: col * CELL + MARGIN * BAKE, top: row * CELL + MARGIN * BAKE });
    atlas.push({ filename: `${clip.prefix}${String(col).padStart(2, '0')}`, frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      rotated: false, trimmed: false, spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
  }
  fs.mkdirSync(CANDIDATE, { recursive: true });
  await sharp({ create: { width: size.w, height: size.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ lossless: true }).toFile(path.join(CANDIDATE, 'spritesheet.webp'));
  fs.writeFileSync(path.join(CANDIDATE, 'animations.json'), JSON.stringify({ frames: atlas,
    meta: { image: 'spritesheet.webp', format: 'RGBA8888', size, scale: '1' } }));
  // Clips use Phaser's base interval plus per-frame holds, like the installed idle.
  const animations = CLIPS.map((clip, row) => {
    const shortest = Math.min(...clip.frames.map((f) => f.ms));
    return { key: clip.key, fps: Number((1000 / shortest).toFixed(2)), loop: clip.loop, row,
      frames: clip.drawn.map((_, i) => `${clip.prefix}${String(i).padStart(2, '0')}`), frameDurationsMs: clip.frames.map((f) => f.ms) };
  });
  fs.writeFileSync(path.join(CANDIDATE, 'animation-settings.json'), `${JSON.stringify({ version: 2, cellSize: CELL, animations, throw: THROW }, null, 2)}\n`);
  fs.writeFileSync(path.join(CANDIDATE, 'character.json'), `${JSON.stringify({ presentation: PRESENTATION, rig: RIG }, null, 2)}\n`);
  return size;
}

// ---- previews --------------------------------------------------------------
let installedSheet; let candidateSheet; let star; let portrait;
const settings = JSON.parse(fs.readFileSync(path.join(INSTALLED, 'animation-settings.json'), 'utf8'));
const installedRow = (key) => settings.animations.find((a) => a.key === key);
const installedRect = (key, i) => ({ x: i * 256, y: installedRow(key).row * 256, w: 256, h: 256 });
const candidateRect = (clip, i) => ({ x: i * CELL, y: CLIPS.indexOf(clip) * CELL, w: CELL, h: CELL });

// Portrait, installed idle and candidate at one character height, then all three
// at gameplay size, then the candidate's pixels enlarged.
async function idleComparison() {
  const K = 5; const colW = 360;
  const zoom = 1.5; const big = 10;
  const img = image(colW * 3 + 760, HEIGHT * big + 90, BG);
  const names = ['Portrait (body.webp)', 'Installed idle00', 'Candidate idle00'];
  const text = [{ x: 16, y: 22, text: 'Same pixel scale', bold: true }, { x: 16, y: 40 + HEIGHT * K + 52, text: `Gameplay size (camera zoom ${zoom})`, bold: true },
    { x: colW * 3 + 30, y: 22, text: 'Candidate, nearest-neighbour x10', bold: true }];
  const groundA = 40 + HEIGHT * K + 12; const groundB = groundA + 60 + 110;
  for (let c = 0; c < 3; c++) {
    const cx = colW * c + colW / 2;
    rectFill(img, colW * c + 8, 30, colW - 16, HEIGHT * K + 30, PANEL);
    rectFill(img, colW * c + 8, groundA, colW - 16, 1, GUIDE); rectFill(img, colW * c + 8, groundA - HEIGHT * K, colW - 16, 1, GUIDE);
    text.push({ x: cx, y: groundA + 16, text: names[c], anchor: 'middle' });
    if (c === 0) draw(img, portrait, { px: cx, py: groundA, ax: (32.5 / 64) * portrait.w, ay: portrait.h, scale: (64 * K * PORTRAIT_ART) / portrait.w, smooth: true });
    if (c === 1) draw(img, installedSheet, { rect: installedRect('idle', 0), px: cx, py: groundA, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: K * PER_ART, smooth: true });
    if (c === 2) drawArt(img, CLIPS[0].drawn[0], cx, groundA, K);
    // Gameplay size: each drawn the way the game would, filtered from its sheet.
    const world = INSTALLED_HEIGHT * installedArt.scale * zoom;
    if (c === 0) draw(img, portrait, { px: cx, py: groundB, ax: (32.5 / 64) * portrait.w, ay: portrait.h, scale: (world / 48) * 64 / portrait.w, smooth: true });
    if (c === 1) draw(img, installedSheet, { rect: installedRect('idle', 0), px: cx, py: groundB, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: installedArt.scale * zoom, smooth: true });
    if (c === 2) draw(img, candidateSheet, { rect: candidateRect(CLIPS[0], 0), px: cx, py: groundB, ax: FEET_X, ay: SOLE_ROW, scale: SHEET_SCALE * zoom, smooth: true });
  }
  rectFill(img, colW * 3 + 20, 30, 740, img.h - 50, PANEL);
  drawArt(img, CLIPS[0].drawn[0], colW * 3 + 390, img.h - 30, big);
  draw(img, await labels(img.w, img.h, text), { px: 0, py: 0 });
  await savePng(img, 'idle-comparison.png');
}

// Installed forward throw above the candidate's level throw, then every
// direction, all on one ground line and one foot line.
async function throwStrip() {
  const K = 4; const colW = 360; const rowH = 300; const left = 150;
  const rows = [{ label: 'Installed', sub: '4 frames, 15 fps' }, ...CLIPS.filter((c) => c.direction).map((c) => ({ clip: c,
    label: `Candidate ${c.direction}`, sub: `aim ${c.elevation > 0 ? '+' : ''}${c.elevation} deg` }))];
  // Level first, right under the installed throw.
  rows.splice(1, 0, ...rows.splice(rows.findIndex((r) => r.clip?.direction === 'level'), 1));
  const img = image(left + colW * 4 + 10, rowH * rows.length + 30, BG); const text = [];
  for (const [r, row] of rows.entries()) {
    const ground = 30 + rowH * r + rowH - 22;
    text.push({ x: 12, y: ground - 130, text: row.label, bold: true }, { x: 12, y: ground - 112, text: row.sub, size: 11 });
    const count = row.clip ? row.clip.drawn.length : 4;
    for (let c = 0; c < count; c++) {
      const x0 = left + colW * c; const cx = x0 + 150;
      rectFill(img, x0 + 4, ground - rowH + 34, colW - 8, rowH - 12, PANEL);
      rectFill(img, x0 + 4, ground, colW - 8, 1, GUIDE); rectFill(img, cx, ground - rowH + 34, 1, rowH - 12, GUIDE);
      rectFill(img, x0 + 4, ground - HEIGHT * K, colW - 8, 1, [255, 255, 255, 36]);
      if (row.clip) {
        drawArt(img, row.clip.drawn[c], cx, ground, K);
        text.push({ x: x0 + 10, y: ground + 15, text: `${row.clip.beats[c]}  ${row.clip.frames[c].ms} ms`, size: 11, bold: c === RELEASE_FRAME });
      } else {
        draw(img, installedSheet, { rect: installedRect('attack', c), px: cx, py: ground, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: K * PER_ART, smooth: true });
        text.push({ x: x0 + 10, y: ground + 15, text: `attack0${c}  67 ms${c === 0 ? '  (free star already flying)' : ''}`, size: 11 });
      }
    }
  }
  text.push({ x: left + 4, y: 20, text: 'Lines: ground, stance centre and standing head height. The lead foot is in the same place in every candidate frame.', size: 12 });
  draw(img, await labels(img.w, img.h, text), { px: 0, py: 0 });
  await savePng(img, 'throw-strip.png');
}

// One throw as both versions of the game would present it. Times are ms since
// the press. Returns what to draw: character frame plus where the free star is.
function simulate(elevation) {
  const angle = (-elevation * Math.PI) / 180; const owner = { x: 0, y: 0, flipX: false };
  const flight = projectile.launch(owner, angle, 'preview');
  const path = [{ x: flight.x, y: flight.y, done: false }];
  while (!flight.done && path.length < 400) { projectile.step(flight, owner); path.push({ x: flight.x, y: flight.y, done: flight.done }); }
  const at = (t) => {
    const f = Math.max(0, t) / projectile.STEP_MS; const i = Math.min(path.length - 1, Math.floor(f)); const n = Math.min(path.length - 1, i + 1);
    return { x: path[i].x + (path[n].x - path[i].x) * (f - i), y: path[i].y + (path[n].y - path[i].y) * (f - i), done: path[i].done };
  };
  // The client's own release logic, fed the candidate's throw settings.
  const sprite = { x: 0, y: 0, flipX: false, texture: { key: 'ninja' } };
  const variant = throwing.beginThrow(sprite, angle, 0, THROW);
  const thrown = throwing.claimThrow(sprite);
  const clip = CLIPS.find((c) => c.direction === (variant || 'level'));
  const spin = (t) => (t * flight.cfg.rotationSpeed * Math.PI) / 180000;
  return {
    clip, angle,
    before(t) { const p = at(t); return { star: t >= 0 && !p.done ? { x: p.x, y: p.y, scale: 1, rot: spin(t) } : null }; },
    after(t) {
      if (t < 0) return { star: null };
      const p = at(t); const shown = throwing.presentRelease(thrown, p, sprite, t);
      return { star: shown.visible && !p.done ? { x: shown.x, y: shown.y, scale: shown.scale, rot: spin(t) } : null };
    },
  };
}
function drawBefore(img, t, sim, { px, py, k }) {
  const row = installedRow('attack'); const i = t < 0 ? -1 : Math.floor(t / (1000 / row.fps));
  const rect = i >= 0 && i < row.frames.length ? installedRect('attack', i) : installedRect('idle', 0);
  draw(img, installedSheet, { rect, px, py, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_ORIGIN.y, scale: installedArt.scale * k, smooth: true });
  const s = sim.before(t).star;
  if (s) draw(img, star, { px: px + s.x * k, py: py + s.y * k, ax: star.w / 2, ay: star.h / 2, scale: 0.1 * s.scale * k, rot: s.rot, smooth: true });
}
function drawAfter(img, t, sim, { px, py, k }, idleClock = t) {
  const i = t < 0 ? -1 : clipAt(sim.clip.frames, t, false);
  const rect = i >= 0 ? candidateRect(sim.clip, i) : candidateRect(CLIPS[0], clipAt(IDLE, idleClock, true));
  draw(img, candidateSheet, { rect, px, py, ax: ORIGIN.x, ay: ORIGIN.y, scale: SHEET_SCALE * k, smooth: true });
  const s = sim.after(t).star;
  if (s) draw(img, star, { px: px + s.x * k, py: py + s.y * k, ax: star.w / 2, ay: star.h / 2, scale: 0.1 * s.scale * k, rot: s.rot, smooth: true });
}
const footY = (k) => ((INSTALLED_SOLE - INSTALLED_ORIGIN.y) * installedArt.scale - 3.5) * k; // platform top under the sprite position

// Before / after at gameplay speed: level, up, down, a short rest between throws.
async function throwAnimation(file, k) {
  const view = { w: Math.round(330 * k), h: Math.round(190 * k) };
  const gap = 10; const top = 26;
  const img0 = image(view.w * 2 + gap * 3, view.h + top + gap, BG);
  const shots = CLIPS.filter((c) => ['level', 'up', 'down'].includes(c.direction)).map((c) => ({ name: c.direction, sim: simulate(c.elevation) }));
  const text = await labels(img0.w, img0.h, [{ x: gap + 6, y: 18, text: 'Installed: star visible from the press', bold: true },
    { x: gap * 2 + view.w + 6, y: 18, text: `Candidate: star leaves the hand at ${RELEASE_MS} ms`, bold: true }]);
  const frames = []; const step = 20; const lead = 360; const span = 1300;
  for (const [n, shot] of shots.entries()) for (let t = -lead; t < span - lead; t += step) {
    const img = image(img0.w, img0.h, BG);
    for (let p = 0; p < 2; p++) {
      const x0 = gap + p * (view.w + gap); const at = { px: x0 + 46 * k, py: top + 104 * k, k };
      rectFill(img, x0, top, view.w, view.h, PANEL); rectFill(img, x0, at.py + footY(k), view.w, view.h - (at.py + footY(k) - top), FLOOR);
      const clipped = { ...img, data: img.data };
      if (p === 0) drawBefore(clipped, t, shot.sim, at); else drawAfter(clipped, t, shot.sim, at, n * span + t + lead);
      rectFill(img, x0 + view.w, top, gap, view.h, BG);
    }
    draw(img, text, { px: 0, py: 0 });
    frames.push(img);
  }
  saveGif(frames, file);
  return shots;
}

// The handoff, frozen: last frame the pose holds the star, the first frame it is
// free, and two frames later, for every direction.
async function handoff() {
  const k = 4; const colW = 560; const rowH = 380; const left = 120;
  const times = [RELEASE_MS - 10, RELEASE_MS, RELEASE_MS + 20, RELEASE_MS + 50];
  const heads = [`${times[0]} ms: last held frame`, `${times[1]} ms: first free frame`, `${times[2]} ms`, `${times[3]} ms`];
  const dirs = CLIPS.filter((c) => c.direction);
  const img = image(left + colW * times.length + 10, 34 + rowH * dirs.length, BG); const text = [];
  heads.forEach((h, c) => text.push({ x: left + colW * c + 10, y: 22, text: h, bold: true }));
  for (const [r, clip] of dirs.entries()) {
    const sim = simulate(clip.elevation);
    text.push({ x: 12, y: 34 + rowH * r + 30, text: clip.direction, bold: true }, { x: 12, y: 34 + rowH * r + 48, text: `aim ${clip.elevation} deg`, size: 11 });
    for (const [c, t] of times.entries()) {
      const x0 = left + colW * c; const y0 = 34 + rowH * r; const at = { px: x0 + 190, py: y0 + 190, k };
      const cell = image(colW - 8, rowH - 8, PANEL);
      const local = { px: 190, py: 190, k };
      rectFill(cell, 0, local.py + footY(k), cell.w, cell.h, FLOOR);
      // The exact aim line from the launch point, to judge the wrist against.
      const a = sim.angle; const ox = Math.cos(a) * 30; const oy = -8 + Math.sin(a) * 30;
      for (let d = -30; d < 140; d += 1.5) if (Math.floor(d / 6) % 2 === 0) rectFill(cell, local.px + (ox + Math.cos(a) * d) * k, local.py + (oy + Math.sin(a) * d) * k, 2, 2, [255, 236, 150, 150]);
      drawAfter(cell, t, sim, local);
      draw(img, cell, { px: x0 + 4, py: y0 + 4 });
      void at;
    }
  }
  text.push({ x: left + colW * 2 + 10, y: img.h - 8, text: 'Dashed: the exact aim line the projectile travels.', size: 11 });
  draw(img, await labels(img.w, img.h, text), { px: 0, py: 0 });
  await savePng(img, 'handoff.png');
}

async function idleAnimation() {
  const k = 1.5; const big = 5; const frames = [];
  const row = installedRow('idle'); const holds = row.frameDurationsMs;
  const text = await labels(560, 380, [{ x: 12, y: 18, text: 'Installed idle (blinks)', bold: true }, { x: 292, y: 18, text: 'Candidate idle (whole-body breath)', bold: true },
    { x: 12, y: 372, text: 'Left of each: gameplay size. Right: enlarged.', size: 11 }]);
  const total = IDLE.reduce((s, f) => s + f.ms, 0) * 3;
  for (let t = 0; t < total; t += 20) {
    const img = image(560, 380, BG);
    rectFill(img, 8, 26, 268, 330, PANEL); rectFill(img, 284, 26, 268, 330, PANEL);
    const i = clipAt(holds.map((ms) => ({ ms })), t, true);
    draw(img, installedSheet, { rect: installedRect('idle', i), px: 50, py: 330, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: installedArt.scale * k, smooth: true });
    draw(img, installedSheet, { rect: installedRect('idle', i), px: 170, py: 330, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: big * PER_ART, smooth: true });
    const c = clipAt(IDLE, t, true);
    draw(img, candidateSheet, { rect: candidateRect(CLIPS[0], c), px: 326, py: 330, ax: FEET_X, ay: SOLE_ROW, scale: SHEET_SCALE * k, smooth: true });
    drawArt(img, CLIPS[0].drawn[c], 440, 330, big);
    draw(img, text, { px: 0, py: 0 });
    frames.push(img);
  }
  saveGif(frames, 'idle.gif');
}

const clipOf = (key) => CLIPS.find((c) => c.key === key);

// Every movement clip, frame by frame, on one ground line.
async function movementSheet() {
  const K = 3; const colW = 250; const rowH = 250; const left = 120;
  const rows = CLIPS.filter((c) => !c.direction);
  const cols = Math.max(...rows.map((c) => c.drawn.length));
  const img = image(left + colW * cols + 10, rowH * rows.length + 10, BG); const text = [];
  for (const [r, clip] of rows.entries()) {
    const ground = rowH * r + rowH - 24;
    text.push({ x: 10, y: ground - 110, text: clip.key, bold: true },
      { x: 10, y: ground - 94, text: `${clip.frames[0].ms} ms a frame`, size: 11 });
    for (const [c, drawn] of clip.drawn.entries()) {
      const x0 = left + colW * c; const cx = x0 + colW / 2;
      rectFill(img, x0 + 3, ground - rowH + 30, colW - 6, rowH - 8, PANEL);
      rectFill(img, x0 + 3, ground, colW - 6, 1, GUIDE); rectFill(img, cx, ground - rowH + 30, 1, rowH - 8, [255, 255, 255, 36]);
      drawArt(img, drawn, cx, ground, K);
      text.push({ x: x0 + 8, y: ground + 15, text: clip.beats[c], size: 11 });
    }
  }
  draw(img, await labels(img.w, img.h, text), { px: 0, py: 0 });
  await savePng(img, 'movement-frames.png');
}

// Run cycle at full speed, installed beside candidate: gameplay size and enlarged.
async function runAnimation() {
  const run = clipOf('running'); if (!run) return;
  const k = 1.5; const big = 4; const frames = []; const row = installedRow('running');
  const text = await labels(640, 360, [{ x: 12, y: 18, text: 'Installed run', bold: true }, { x: 332, y: 18, text: 'Candidate run', bold: true }]);
  const total = run.frames.reduce((s, f) => s + f.ms, 0) * 3;
  for (let t = 0; t < total; t += 20) {
    const img = image(640, 360, BG);
    rectFill(img, 8, 26, 308, 320, PANEL); rectFill(img, 324, 26, 308, 320, PANEL);
    const i = Math.floor(t / (1000 / row.fps)) % row.frames.length;
    draw(img, installedSheet, { rect: installedRect('running', i), px: 60, py: 320, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: installedArt.scale * k, smooth: true });
    draw(img, installedSheet, { rect: installedRect('running', i), px: 200, py: 320, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_SOLE + 1, scale: big * PER_ART, smooth: true });
    const c = clipAt(run.frames, t, true);
    draw(img, candidateSheet, { rect: candidateRect(run, c), px: 376, py: 320, ax: FEET_X, ay: SOLE_ROW, scale: SHEET_SCALE * k, smooth: true });
    drawArt(img, run.drawn[c], 496, 320, big);
    draw(img, text, { px: 0, py: 0 });
    frames.push(img);
  }
  saveGif(frames, 'run.gif');
}

// A full jump with the game's own gravity. Both play the way the game plays
// them: the jump clip on a timer, then the fall clip once he stops rising.
async function jumpAnimation(file, k) {
  const rise = clipOf('jumping'); const fall = clipOf('falling'); if (!rise || !fall) return;
  const physics = require('../../../src/shared/physics/movementPhysics.json');
  const view = { w: Math.round(150 * k), h: Math.round(230 * k) }; const gap = 10; const top = 26;
  const text = await labels(view.w * 2 + gap * 3, view.h + top + gap, [{ x: gap + 4, y: 18, text: 'Installed', bold: true }, { x: gap * 2 + view.w + 4, y: 18, text: 'Candidate', bold: true }]);
  const frames = []; const step = 20; let y = 0; let vy = 0; let air = false; let airFor = 0; let fallFor = 0;
  const jumpRow = installedRow('jumping'); const fallRow = installedRow('falling');
  for (let t = -400; t < 1500; t += step) {
    if (t === 0) { air = true; vy = -physics.jumpSpeed; airFor = 0; fallFor = 0; }
    if (air) {
      vy += physics.gravity * (vy > physics.fallGravityMinSpeed ? physics.fallGravityFactor : 1) * (step / 1000);
      y += vy * (step / 1000); airFor += step; if (vy >= -20) fallFor += step;
      if (y >= 0) { y = 0; vy = 0; air = false; }
    }
    const img = image(text.w, text.h, BG);
    for (let p = 0; p < 2; p++) {
      const x0 = gap + p * (view.w + gap); const px = x0 + view.w / 2; const floor = top + view.h - 40 * k;
      rectFill(img, x0, top, view.w, view.h, PANEL); rectFill(img, x0, floor, view.w, 40 * k, FLOOR);
      const py = floor - footY(k) + y * k;
      if (p === 0) {
        const rect = !air ? installedRect('idle', 0) : vy < -20
          ? installedRect('jumping', Math.min(jumpRow.frames.length - 1, Math.floor(airFor / (1000 / jumpRow.fps))))
          : installedRect('falling', Math.min(fallRow.frames.length - 1, Math.floor(fallFor / (1000 / fallRow.fps))));
        draw(img, installedSheet, { rect, px, py, ax: INSTALLED_ORIGIN.x, ay: INSTALLED_ORIGIN.y, scale: installedArt.scale * k, smooth: true });
      } else {
        let clip = CLIPS[0]; let i = clipAt(IDLE, t + 400, true);
        if (air) {
          clip = vy < -20 ? rise : fall;
          i = Math.min(clip.drawn.length - 1, Math.floor((vy < -20 ? airFor : fallFor) / clip.frames[0].ms));
        }
        draw(img, candidateSheet, { rect: candidateRect(clip, i), px, py, ax: ORIGIN.x, ay: ORIGIN.y, scale: SHEET_SCALE * k, smooth: true });
      }
    }
    draw(img, text, { px: 0, py: 0 });
    frames.push(img);
  }
  saveGif(frames, file);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const size = await writeSheet();
  installedSheet = await load(path.join(INSTALLED, 'spritesheet.webp'));
  candidateSheet = await load(path.join(CANDIDATE, 'spritesheet.webp'));
  star = await load(path.join(GAME_ASSETS, 'shuriken.webp'));
  portrait = await load(path.join(GAME_ASSETS, 'body.webp'));
  console.log(`sheet ${size.w}x${size.h}, ${CLIPS.reduce((n, c) => n + c.drawn.length, 0)} frames`);
  console.log(`release at ${RELEASE_MS} ms; hands (world px from the sprite position): ${THROW.directions.map((d) => `${d.name} [${d.hand}]`).join('  ')}`);
  await idleComparison();
  await throwStrip();
  await handoff();
  await idleAnimation();
  await throwAnimation('throw-game-size.gif', 1.5);
  await throwAnimation('throw-enlarged.gif', 3);
  await movementSheet();
  await runAnimation();
  await jumpAnimation('jump-game-size.gif', 1.5);
  await jumpAnimation('jump-enlarged.gif', 3);
  console.log(`wrote ${path.relative(ROOT, OUT)}`);
  if (process.argv.includes('--install')) {
    for (const file of ['spritesheet.webp', 'animations.json', 'animation-settings.json']) fs.copyFileSync(path.join(CANDIDATE, file), path.join(GAME_ASSETS, file));
    const character = JSON.parse(fs.readFileSync(CHARACTER_JSON, 'utf8'));
    character.presentation = { ...character.presentation, ...PRESENTATION }; character.rig = RIG;
    fs.writeFileSync(CHARACTER_JSON, `${JSON.stringify(character, null, 2)}\n`);
    console.log(`installed into ${path.relative(ROOT, GAME_ASSETS)} and ${path.relative(ROOT, CHARACTER_JSON)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
