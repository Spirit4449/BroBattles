#!/usr/bin/env node
// Packs the code-drawn Draven animations (idle.cjs, run.cjs, attack.cjs, actions.cjs) into
// the game spritesheet, read through `presentation.hiResArt`
// (src/client/game/characters/shared/spritePresentation.js). Frame names and
// order follow the legacy atlas (scripts/art/draven-pixel/legacy/).
//   node scripts/art/draven-pixel/sheet.cjs            -> output/draven-pixel/sheet/
//   node scripts/art/draven-pixel/sheet.cjs --install  also copies the sheet and atlas
//                                                        into public/assets/draven/
// draven.json's `presentation.hiResArt` and `rig` must match hiResArt.json / rig.json.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { CANVAS, SIZE, JOINTS } = require('./pose.cjs');
const { getCharacterStats } = require('../../../src/shared/characters/characterStats');
const { characterFrames } = require('../../../src/shared/characters');

const ROOT = path.resolve(__dirname, '../../..');
const LEGACY_ATLAS = path.join(__dirname, 'legacy/animations.json');
const INSTALL_DIR = path.join(ROOT, 'public/assets/draven');
const OUT_DIR = path.join(ROOT, 'output/draven-pixel/sheet');

const ANIMATIONS = { idle: require('./idle.cjs').FRAMES, run: require('./run.cjs').FRAMES, attack: require('./attack.cjs').FRAMES, ...require('./actions.cjs').FRAMES };

// The cell keeps the legacy frame's world size (250px at spriteScale 1.2), so
// anything sized from the sprite's display size (the Inferno overlay) is unchanged.
// At that scale one art pixel is ~1.45 world px, the legacy figure's height.
const LEGACY = characterFrames.draven;
const WORLD = LEGACY.w * getCharacterStats('draven').spriteScale;
const CELL = 207;
const GROUND_Y = 150; // cell row the hem stands on
const FEET_X = 24.5; // robe centre column on the 64px art
const MARGIN = (CANVAS - SIZE) / 2; // rest art offset inside a standard animation canvas
const ART_AT = [Math.round(CELL / 2 - MARGIN - FEET_X), GROUND_Y - MARGIN - JOINTS.ground];
const HI_RES_ART = { sourceSize: CELL, scale: Number((WORLD / CELL).toFixed(4)), groundY: GROUND_Y, requiresFrame: 'duck00', duckFrame: 'duck00' };
// Rest-art points land in the cell at ART_AT + MARGIN (see codeCell).
const toCell = ([x, y]) => [ART_AT[0] + MARGIN + Math.round(x), ART_AT[1] + MARGIN + Math.round(y)];
const RIG = {
  frame: [CELL, CELL],
  feet: [ART_AT[0] + MARGIN + FEET_X, GROUND_Y],
  // Where the staff head is on every frame: the staff's smoke trail and the
  // Inferno ignite come from here.
  points: { staffTip: { default: toCell(JOINTS.staffHead), ...Object.fromEntries(Object.entries(ANIMATIONS)
    .map(([anim, set]) => [anim, set.map((px) => px?.staffHead && toCell(px.staffHead))])
    .filter(([, heads]) => heads.length && heads.every(Boolean))) } },
};

const blank = () => sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
// Frames are square canvases with the rest art centred: CANVAS for most, wider
// for the attack's effects. Line each one's rest art up with ART_AT + MARGIN.
function codeCell(pixels) {
  const side = Math.sqrt(pixels.length / 4);
  const shift = (side - CANVAS) / 2;
  const left = ART_AT[0] - shift; const top = ART_AT[1] - shift;
  if (left < 0 || top < 0 || left + side > CELL || top + side > CELL) throw new Error(`a ${side}px frame does not fit the ${CELL}px cell`);
  return blank().composite([{ input: pixels, raw: { width: side, height: side, channels: 4 }, left, top }]).png().toBuffer();
}

async function main() {
  const legacy = JSON.parse(fs.readFileSync(LEGACY_ATLAS, 'utf8'));
  const cols = legacy.meta.size.w / LEGACY.w;
  const rows = legacy.meta.size.h / LEGACY.h;
  const tiles = []; const frames = []; const missing = [];
  for (const f of legacy.frames) {
    const [, anim, index] = f.filename.match(/^([a-z]+?)(\d+)$/);
    const px = ANIMATIONS[anim]?.[Number(index)];
    if (!px) { missing.push(f.filename); continue; }
    const col = f.frame.x / LEGACY.w; const row = f.frame.y / LEGACY.h;
    tiles.push({ input: await codeCell(px), left: col * CELL, top: row * CELL });
    frames.push({ ...f, frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
  }
  if (missing.length) throw new Error(`no code frame for ${missing.join(' ')}`);

  // Code frames the legacy atlas never had (a second wall-slide frame, the
  // crouch, the directional dashes) go in rows added below its grid.
  const named = new Set(legacy.frames.map((f) => f.filename));
  const extra = Object.entries(ANIMATIONS).flatMap(([anim, set]) => set.map((px, i) => [`${anim}${String(i).padStart(2, '0')}`, px]))
    .filter(([name, px]) => px && !named.has(name));
  for (const [n, [filename, px]] of extra.entries()) {
    const col = n % cols; const row = rows + Math.floor(n / cols);
    tiles.push({ input: await codeCell(px), left: col * CELL, top: row * CELL });
    frames.push({ filename, rotated: false, trimmed: false, frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const size = { w: cols * CELL, h: (rows + Math.ceil(extra.length / cols)) * CELL };
  await sharp({ create: { width: size.w, height: size.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'spritesheet.webp'));
  fs.writeFileSync(path.join(OUT_DIR, 'animations.json'), JSON.stringify({ frames, meta: { ...legacy.meta, image: 'spritesheet.webp', size } }));
  fs.writeFileSync(path.join(OUT_DIR, 'hiResArt.json'), `${JSON.stringify(HI_RES_ART, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'rig.json'), `${JSON.stringify(RIG, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}: ${size.w}x${size.h}, ${frames.length} frames; hiResArt ${JSON.stringify(HI_RES_ART)} rig ${JSON.stringify(RIG)}`);
  if (process.argv.includes('--install')) {
    for (const file of ['spritesheet.webp', 'animations.json']) fs.copyFileSync(path.join(OUT_DIR, file), path.join(INSTALL_DIR, file));
    console.log(`installed spritesheet.webp and animations.json into ${path.relative(ROOT, INSTALL_DIR)}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { CELL, HI_RES_ART, RIG };
