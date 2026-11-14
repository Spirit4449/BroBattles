#!/usr/bin/env node
// Sparrow directional dashes, drawn on the mid-air rig from jump.cjs. Three
// frames each, played once over the shared dash duration and held on the last
// (see characters/sparrow/anim.js). Left-facing dashes mirror this art.
// In every dash she holds the bow out aimed along the dash, as for a shot.
//   dashright:    a forward lunge pitched about 30 degrees, bow aimed level,
//                 the back arm and both legs trailing; also used for
//                 diagonal-down dashes, as for the other fighters.
//   dashdiagonal: a lighter pitch, bow aimed up 45 degrees, legs swept back.
//   dashup:       upright and stretched, bow raised overhead, legs straight and
//                 together with the toes pointed, hair dragged down.
// Each set: wind-up, full stretch, and a slightly relaxed held stretch.
//   node scripts/art/sparrow-pixel/dash.cjs   -> output/sparrow-pixel/dash/
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { CANVAS, airPose } = require('./jump.cjs');
const { renderPose, mul, translate } = require('./render.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel/dash');
const PREVIEW_SCALE = 5;

// Same fields as jump.cjs POSES: lean (+ = pitch forward), backArm [shoulder,
// elbow], frontArm, bow, hair, legs [thigh angle (+ = forward), knee bend, toe].
// `aim` is where the bow arm points, in degrees from level (negative = up).
// The arm turns with the body's lean, so it is counter-turned to hold the aim;
// the bow stays square to the arm as when she shoots.
const aimed = (p) => ({ ...p, frontArm: p.aim - p.lean, bow: p.bow || 0 });

const POSES = {
  dashright: [
    { lift: 0, lean: 20, aim: 4, backArm: [-25, 8], hair: -10,
      near: [-24, 34, 55], far: [-38, 16, 55], skirt: { back: 0.7, front: 0.1, rise: 2 } },
    { lift: 0, lean: 32, aim: 0, backArm: [-40, 4], hair: -18,
      near: [-42, 18, 65], far: [-56, 6, 65], skirt: { back: 1.1, front: 0.15, rise: 3 } },
    { lift: 0, lean: 30, aim: 0, backArm: [-36, 6], hair: -15,
      near: [-38, 24, 60], far: [-53, 10, 62], skirt: { back: 1.0, front: 0.15, rise: 3 } },
  ],
  dashdiagonal: [
    { lift: 0, lean: 8, aim: -30, backArm: [-30, 8], hair: -8,
      near: [-6, 36, 55], far: [-22, 18, 55], skirt: { back: 0.5, front: 0.15, rise: 2 } },
    { lift: -1, lean: 14, aim: -42, backArm: [-50, 4], hair: -15,
      near: [-18, 20, 65], far: [-32, 8, 65], skirt: { back: 0.8, front: 0.15, rise: 3 } },
    { lift: -1, lean: 12, aim: -40, backArm: [-45, 6], hair: -12,
      near: [-14, 26, 60], far: [-29, 11, 62], skirt: { back: 0.7, front: 0.15, rise: 3 } },
  ],
  dashup: [
    { lift: 0, lean: 3, aim: -84, reach: [5, -8], backArm: [-45, 8], hair: -8,
      near: [8, 30, 50], far: [-8, 14, 50], skirt: { back: 0.3, front: 0.2, rise: 1 } },
    { lift: -2, lean: 0, aim: -92, reach: [5, -9], backArm: [-70, 2], hair: -16,
      near: [3, 4, 70], far: [-4, 0, 70], skirt: { back: 0.1, front: 0.05, rise: 0 } },
    { lift: -1, lean: 1, aim: -90, reach: [5, -8], backArm: [-64, 4], hair: -13,
      near: [5, 10, 64], far: [-5, 4, 66], skirt: { back: 0.15, front: 0.1, rise: 0.5 } },
  ],
};

// Unlike the jump and fall, the whole bow is drawn: it is held out clear of her.
// `reach` [dx, dy] stretches the bow arm out along the aim, so a raised bow
// clears her head.
function renderDash(p) {
  const { nearTucked, ...parts } = airPose(aimed(p));
  if (p.reach) for (const name of ['frontArm', 'bow', 'bowHand']) parts[name] = { m: mul(translate(...p.reach), parts[name].m) };
  return renderPose(parts, { size: CANVAS });
}

const FRAMES = Object.fromEntries(Object.entries(POSES).map(([name, poses]) => [name, poses.map(renderDash)]));
const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const big = CANVAS * PREVIEW_SCALE;
  const rows = Object.entries(FRAMES);
  const tiles = [];
  for (const [r, [name, frames]] of rows.entries()) {
    for (const [i, px] of frames.entries()) {
      await raw(px, CANVAS).png().toFile(path.join(OUT_DIR, `${name}${String(i).padStart(2, '0')}.png`));
      tiles.push({ input: await raw(px, CANVAS).resize(big, big, { kernel: 'nearest' }).png().toBuffer(), left: i * big, top: r * big });
    }
  }
  await sharp({ create: { width: big * 3, height: big * rows.length, channels: 4, background: '#ffffff' } })
    .composite(tiles).png().toFile(path.join(OUT_DIR, 'dash-strip.png'));
  console.log(`wrote ${rows.map(([n]) => n).join(' ')} and dash-strip.png to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FRAMES, POSES };
