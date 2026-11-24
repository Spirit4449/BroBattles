#!/usr/bin/env node
// Packs the code-drawn Ozzy animations (idle, run, attack, actions) into the
// game spritesheet, read through `presentation.hiResArt`
// (src/client/game/characters/shared/spritePresentation.js), and measures the
// rig points (staff tip per frame, orb, chest) off the posed frames.
//   node scripts/art/ozzy-pixel/sheet.cjs            -> output/ozzy-pixel/sheet/
//   node scripts/art/ozzy-pixel/sheet.cjs --install  also copies the sheet and atlas
//                                                     into public/assets/ozzy/
// ozzy.json's `presentation.hiResArt` and `rig` must match hiResArt.json / rig.json.
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE } = require('./pose.cjs');
const { getCharacterStats } = require('../../../src/shared/characters/characterStats');

const ROOT = path.resolve(__dirname, '../../..');
const INSTALL_DIR = path.join(ROOT, 'public/assets/ozzy');
const OUT_DIR = path.join(ROOT, 'output/ozzy-pixel/sheet');

// Atlas frame-name prefix -> frames. Rates live in characters/ozzy/anim.js.
const ANIMATIONS = {
  idle: require('./idle.cjs').FRAMES,
  running: require('./run.cjs').FRAMES,
  attack: require('./attack.cjs').FRAMES,
  ...require('./actions.cjs').FRAMES,
};

// One art px is 1.52 legacy px drawn at the legacy spriteScale: the figure
// keeps the legacy on-screen height.
const LEGACY_PER_ART = 1.52;
const LEGACY_SCALE = getCharacterStats('ozzy').spriteScale;
const SCALE = Number((LEGACY_PER_ART * LEGACY_SCALE).toFixed(4));
const CELL = 128;
const GROUND_Y = 104; // cell row the soles stand on (art row 63's bottom edge)
const FEET_X = 26; // art column over the legacy stand point (legacy rig feet x 103)
const ART_AT = [16, GROUND_Y - SIZE]; // rest-art origin in the cell
const COLS = 8;
const HI_RES_ART = { sourceSize: CELL, scale: SCALE, groundY: GROUND_Y, requiresFrame: 'duck00', duckFrame: 'duck00' };
const FEET = [ART_AT[0] + FEET_X, GROUND_Y];

const cellPoint = ([x, y]) => [Math.round(x + ART_AT[0]), Math.round(y + ART_AT[1])];
// The fireball leaves the staff tip as drawn on the attack frame showing at
// its release (ozzyThrowReleaseFrame: anim.js times the throw to the cast).
const { ozzyThrowReleaseFrame } = require('../../../src/shared/characters/ozzyCharge');

async function main() {
  const tiles = []; const frames = []; let clipped = 0;
  let n = 0;
  for (const [anim, list] of Object.entries(ANIMATIONS)) {
    for (const [i, px] of list.entries()) {
      const side = Math.sqrt(px.length / 4); const margin = (side - SIZE) / 2;
      const left = ART_AT[0] - margin; const top = ART_AT[1] - margin;
      // Count art the cell would cut off.
      for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
        const cx = x + left; const cy = y + top;
        if (px[(y * side + x) * 4 + 3] && (cx < 0 || cy < 0 || cx >= CELL || cy >= CELL)) clipped++;
      }
      const pad = side;
      const big = await sharp({ create: { width: CELL + pad * 2, height: CELL + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: px, raw: { width: side, height: side, channels: 4 }, left: left + pad, top: top + pad }]).png().toBuffer();
      const cell = await sharp(big).extract({ left: pad, top: pad, width: CELL, height: CELL }).png().toBuffer();
      const col = n % COLS; const row = Math.floor(n / COLS); n++;
      tiles.push({ input: cell, left: col * CELL, top: row * CELL });
      const filename = `${anim}${String(i).padStart(2, '0')}`;
      frames.push({ filename, frame: { x: col * CELL, y: row * CELL, w: CELL, h: CELL }, rotated: false, trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL }, sourceSize: { w: CELL, h: CELL } });
    }
  }
  if (clipped) console.warn(`warning: ${clipped} art pixels fall outside the ${CELL}px cell`);

  const tip = (anim) => ANIMATIONS[anim].map((px) => cellPoint(px.$.head));
  const special = ANIMATIONS.special;
  const RIG = {
    frame: [CELL, CELL],
    feet: FEET,
    points: {
      chest: cellPoint([31, 38]),
      fireballMuzzle: { pivot: tip('attack')[ozzyThrowReleaseFrame(ANIMATIONS.attack.length)], reach: 0 },
      // The violet orb on the planted staff (actions.cjs special08-09).
      orb: cellPoint([special[8].$.head[0] + 1, special[8].$.head[1] - 12]),
      staffTip: { default: cellPoint(ANIMATIONS.idle[0].$.head), attack: tip('attack'), special: tip('special') },
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const size = { w: COLS * CELL, h: Math.ceil(n / COLS) * CELL };
  await sharp({ create: { width: size.w, height: size.h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ lossless: true }).toFile(path.join(OUT_DIR, 'spritesheet.webp'));
  fs.writeFileSync(path.join(OUT_DIR, 'animations.json'), `${JSON.stringify({ frames, meta: { image: 'spritesheet.webp', size, scale: 1 } }, null, 1)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'hiResArt.json'), `${JSON.stringify(HI_RES_ART, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT_DIR, 'rig.json'), `${JSON.stringify(RIG, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT_DIR)}: ${size.w}x${size.h}, ${frames.length} frames\nhiResArt ${JSON.stringify(HI_RES_ART)}\nrig ${JSON.stringify(RIG)}`);
  if (process.argv.includes('--install')) {
    for (const file of ['spritesheet.webp', 'animations.json']) fs.copyFileSync(path.join(OUT_DIR, file), path.join(INSTALL_DIR, file));
    console.log(`installed spritesheet.webp and animations.json into ${path.relative(ROOT, INSTALL_DIR)}`);
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { CELL, HI_RES_ART };
