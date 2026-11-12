#!/usr/bin/env node
// Packs the code-drawn Sparrow animations into a game spritesheet that uses the
// `presentation.hiResArt` path (see src/client/game/characters/shared/spritePresentation.js).
// Animations not yet drawn in code are carried over from the legacy sheet (kept in
// ./legacy, the pre-code public/assets/sparrow sheet), resized so they keep
// exactly their old size and position against the hitbox.
//   node scripts/art/sparrow-pixel/sheet.cjs            -> output/sparrow-pixel/sheet/
//   node scripts/art/sparrow-pixel/sheet.cjs --install  also copies the sheet and atlas
//                                                         into public/assets/sparrow/
// sparrow.json's `presentation.hiResArt` must match HI_RES_ART (hiResArt.json).
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE } = require('./parts.cjs');
const { getCharacterStats } = require('../../../src/shared/characters/characterStats');
const { getResolvedCharacterBodyConfig } = require('../../../src/shared/characters/characterTuning');
const { characterFrames, duckFrameCells } = require('../../../src/shared/characters');

const ROOT = path.resolve(__dirname, '../../..');
const LEGACY_DIR = path.join(__dirname, 'legacy');
const INSTALL_DIR = path.join(ROOT, 'public/assets/sparrow');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel/sheet');

// Code animations, by frame-name prefix in animations.json.
const ANIMATIONS = { idle: require('./idle.cjs').FRAMES, ...require('./jump.cjs').FRAMES, attack: require('./attack.cjs').FRAMES, run: require('./run.cjs').FRAMES, die: require('./die.cjs').FRAMES, ...require('./duck-slide.cjs').FRAMES };
// Code-only animations with no legacy cell (the angled shots), packed in rows
// added below the legacy grid.
const EXTRA = Object.fromEntries(Object.entries(require('./attack.cjs').SETS).filter(([prefix]) => prefix !== 'attack'));

// Square cell, centred on the hitbox: wide enough for the legacy dying pose, which
// lies 78px out from the body centre once resized.
const CELL = 160;
const GROUND_Y = CELL - 4; // cell row the feet stand on
const ART_GROUND = 61; // the same row on the 64px canvas (the boots sink 3px below it)
const ART_AT = [(CELL - SIZE) / 2, GROUND_Y - ART_GROUND];
const ART_SCALE = 0.96; // world px per source px: same on-screen height as the legacy art
const HI_RES_ART = { sourceSize: CELL, scale: ART_SCALE, groundY: GROUND_Y, duckFrame: 'duck00' };

// Legacy frames are 100px cells drawn at spriteScale. Their hitbox bottom-centre
// lands on the new cell's ground point, so nothing moves relative to the body.
const LEGACY = characterFrames.sparrow;
const legacyScale = getCharacterStats('sparrow').spriteScale;
const body = getResolvedCharacterBodyConfig('sparrow');
// Hitbox bottom-centre in legacy frame px, as spritePresentation positions it.
const legacyBodyCenterX = ((LEGACY.w - body.widthShrink) * legacyScale * (1 - legacyScale)) / 2 + body.offsetXFromHalf * legacyScale;
const LEGACY_ANCHOR = [LEGACY.w / 2 + legacyBodyCenterX / legacyScale, body.offsetY + LEGACY.h - body.heightShrink];
const LEGACY_RESIZE = legacyScale / ART_SCALE;

async function legacyCell(sheet, frame) {
  const size = Math.round(LEGACY.w * LEGACY_RESIZE);
  const cell = await sheet.clone().extract({ left: frame.x, top: frame.y, width: frame.w, height: frame.h })
    .resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  const left = Math.round(CELL / 2 - LEGACY_ANCHOR[0] * LEGACY_RESIZE);
  const top = Math.round(HI_RES_ART.groundY - LEGACY_ANCHOR[1] * LEGACY_RESIZE);
  // Composite onto an oversized canvas, then crop the cell, so overhang is clipped.
  const pad = size;
  return sharp({ create: { width: CELL + pad * 2, height: CELL + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: cell, left: left + pad, top: top + pad }]).png().toBuffer()
    .then((b) => sharp(b).extract({ left: pad, top: pad, width: CELL, height: CELL }).png().toBuffer());
}

// Frames may be drawn on a canvas larger than SIZE with the rest art centred
// (renderPose's `size`); line that centred rest art up with ART_AT.
function codeCell(pixels) {
  const side = Math.sqrt(pixels.length / 4);
  const margin = (side - SIZE) / 2;
  return sharp({ create: { width: CELL, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: pixels, raw: { width: side, height: side, channels: 4 }, left: ART_AT[0] - margin, top: ART_AT[1] - margin }])
    .png().toBuffer();
}

async function main() {
  const atlas = JSON.parse(fs.readFileSync(path.join(LEGACY_DIR, 'animations.json'), 'utf8'));
  const sheet = sharp(path.join(LEGACY_DIR, 'spritesheet.webp'));
  const legacyFrames = [...atlas.frames];
  const [duckCol, duckRow] = duckFrameCells.sparrow;
  legacyFrames.push({ filename: 'duck00', frame: { x: (duckCol - 1) * LEGACY.w, y: (duckRow - 1) * LEGACY.h, w: LEGACY.w, h: LEGACY.h } });

  const cols = atlas.meta.size.w / LEGACY.w;
  const rows = atlas.meta.size.h / LEGACY.h;
  const tiles = []; const frames = []; const fromCode = [];
  for (const legacy of legacyFrames) {
    const col = legacy.frame.x / LEGACY.w; const row = legacy.frame.y / LEGACY.h;
    const [, anim, index] = legacy.filename.match(/^([a-z]+?)(\d+)$/) || [];
    const drawn = ANIMATIONS[anim]?.[Number(index)];
    if (drawn) fromCode.push(legacy.filename);
    tiles.push({ input: drawn ? await codeCell(drawn) : await legacyCell(sheet, legacy.frame), left: col * CELL, top: row * CELL });
    frames.push({ ...legacy, frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
  }

  const extra = Object.entries(EXTRA).flatMap(([prefix, set]) => set.map((px, i) => [`${prefix}${String(i).padStart(2, '0')}`, px]));
  for (const [n, [filename, px]] of extra.entries()) {
    const col = n % cols; const row = rows + Math.floor(n / cols);
    tiles.push({ input: await codeCell(px), left: col * CELL, top: row * CELL });
    frames.push({ filename, rotated: false, trimmed: false, frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL },
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
    fromCode.push(filename);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const size = { w: cols * CELL, h: (rows + Math.ceil(extra.length / cols)) * CELL };
  await sharp({ create: { width: size.w, height: size.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'spritesheet.webp'));
  fs.writeFileSync(path.join(OUT_DIR, 'animations.json'), JSON.stringify({ frames, meta: { ...atlas.meta, size } }));
  fs.writeFileSync(path.join(OUT_DIR, 'hiResArt.json'), `${JSON.stringify(HI_RES_ART, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}: ${size.w}x${size.h}, ${frames.length} frames (${fromCode.length} from code: ${fromCode.join(' ')})`);
  if (process.argv.includes('--install')) {
    for (const file of ['spritesheet.webp', 'animations.json']) fs.copyFileSync(path.join(OUT_DIR, file), path.join(INSTALL_DIR, file));
    console.log(`installed spritesheet.webp and animations.json into ${path.relative(ROOT, INSTALL_DIR)}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { CELL, HI_RES_ART };
