#!/usr/bin/env node
// Huntress run: 8 frames at 18 fps, matching the run row in animations.json.
// The legacy run's poses, foot for foot: each frame's foot positions are read off
// the legacy frames and the legs (the front-leg template; the trailing one shaded
// darker) are solved onto them. Body, head and bow ride one bounce; the skirt,
// hair, quiver and free arm swing with each bound.
//   node scripts/art/huntress-pixel/run.cjs   -> output/huntress-pixel/run/
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, JOINTS } = require('./parts.cjs');
const { renderPose, mul, translate, rotateAbout, apply } = require('./render.cjs');
const { reach, GROUND, SOLE_FROM_ANKLE } = require('./legs.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/huntress-pixel/run');
const FPS = 18;
const PREVIEW_SCALE = 6;
const FRAME_COUNT = 8;

// The legacy run (legacy/spritesheet.webp, run00-07) is a 4-pose
// bound drawn twice: the front leg always leads, the back leg always trails.
// Per frame, in legacy cell px: where each foot is, and the head and bow tops.
// `planted` feet give the sole; the others give the ankle in the air.
const LEGACY = [
  { front: [28, 36], back: [11, 44], plant: 'back', head: 13, bow: 9 }, // front knee up, back toe pushing off
  { front: [35, 42], back: [12, 32], plant: 'front', head: 14, bow: 10 }, // front lands ahead, back heel kicks up
  { front: [33, 44], back: [16, 33], plant: 'front', head: 15, bow: 10 }, // planted, lowest point
  { front: [25, 44], back: [20, 34], plant: 'front', head: 14, bow: 8 }, // foot under the hips, back leg tucks
  { front: [28, 36], back: [14, 44], plant: 'back', head: 13, bow: 6 },
  { front: [36, 42], back: [11, 32], plant: 'front', head: 14, bow: 8 },
  { front: [31, 44], back: [16, 33], plant: 'front', head: 15, bow: 9 },
  { front: [25, 44], back: [20, 33], plant: 'front', head: 14, bow: 9 },
];
const LEGACY_HIP = { front: [28, 27], back: [23, 28] }; // in the head-13 frames; they ride the head bob
const LEGACY_PX = 1.5625; // legacy px -> canvas px (sheet.cjs LEGACY_RESIZE)
// Legacy legs are a little longer than this art's, so foot offsets from the hip
// are scaled down to keep the same leg angles without stretching the legs.
const LEG_SCALE = 0.85;
const LEAN = 5; // degrees the torso tips forward
const NEAR_HIP = [34, 41]; // the leading (front) leg
const FAR_HIP = [31, 41]; // the trailing (back) leg

// A legacy foot as an ankle offset from the hip, in canvas px.
function footOffset(frame, which) {
  const pose = LEGACY[frame];
  const hip = [LEGACY_HIP[which][0], LEGACY_HIP[which][1] + pose.head - 13];
  const k = LEGACY_PX * LEG_SCALE;
  const [x, y] = [(pose[which][0] - hip[0]) * k, (pose[which][1] - hip[1]) * k];
  return pose.plant === which ? [x - SOLE_FROM_ANKLE[0], y - SOLE_FROM_ANKLE[1]] : [x, y];
}
const legFor = (frame, which, dy) => {
  const hip = which === 'front' ? NEAR_HIP : FAR_HIP;
  const at = [hip[0], hip[1] + dy];
  const [ox, oy] = footOffset(frame, which);
  // A planted foot is pinned to the ground at its legacy spot.
  const y = LEGACY[frame].plant === which ? GROUND - SOLE_FROM_ANKLE[1] : at[1] + oy;
  return reach(at, [at[0] + ox, y]);
};
// Body height follows the legacy head bob: highest as the back toe pushes off,
// lowest as the front foot takes the weight.
const BODY_BASE = 1; // px below the idle stance at mid-bounce
const BODY_DY = LEGACY.map((pose) => BODY_BASE + Math.round((pose.head - 14) * LEGACY_PX * LEG_SCALE));

function runPose(frame) {
  const t = frame / FRAME_COUNT;
  const step = (lag) => Math.sin(4 * Math.PI * (t - lag)); // once per bound
  const dy = BODY_DY[frame];
  const near = legFor(frame, 'front', dy);
  const far = legFor(frame, 'back', dy);

  // Body, head, bow arm and bow all ride the same bounce, so the bow bobs in step.
  const body = mul(translate(0, dy), rotateAbout(JOINTS.hip, LEAN));
  const [neckX, neckY] = apply(body, JOINTS.neck);
  const head = translate(Math.round(neckX - JOINTS.neck[0]), Math.round(neckY - JOINTS.neck[1]));
  // The free back arm pumps once per bound, back as the front foot lands.
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, 16 * step(0.05)));
  const backFore = mul(backUpper, rotateAbout(JOINTS.backElbow, 12 * step(0.15)));

  return {
    backLeg: { hidden: true },
    farKnee: { m: far.thighM }, farThigh: { m: far.thighM }, farBoot: { m: far.bootM },
    torso: { m: body },
    skirt: { m: mul(body, rotateAbout(JOINTS.hip, 8 + 4 * step(0.15))) }, // trails and flaps
    nearKnee: { m: near.thighM }, frontThigh: { m: near.thighM }, frontBoot: { m: near.bootM },
    quiver: { m: mul(body, rotateAbout(JOINTS.quiverStrap, 4 * step(0.15))) },
    head: { m: head },
    hairBack: { m: mul(head, rotateAbout(JOINTS.hairRoot, 6 * step(0.2))) },
    backUpper: { m: backUpper },
    backFore: { m: backFore },
    backHand: { m: backFore },
    frontArm: { m: body },
    bow: { m: body },
    bowHand: { m: body },
  };
}

// Legs travel far from their rest places, so rest-pose gap filling is off.
const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => renderPose(runPose(i), { patch: false }));
const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = [];
  for (const [i, px] of FRAMES.entries()) {
    const name = `run${String(i).padStart(2, '0')}.png`;
    await raw(px, SIZE).png().toFile(path.join(OUT_DIR, name));
    await raw(px, SIZE).resize(SIZE * PREVIEW_SCALE, SIZE * PREVIEW_SCALE, { kernel: 'nearest' })
      .flatten({ background: '#ffffff' }).png().toFile(path.join(OUT_DIR, `big-${name}`));
    names.push(name);
  }
  await sharp({ create: { width: SIZE * FRAMES.length, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(names.map((name, i) => ({ input: path.join(OUT_DIR, name), left: i * SIZE, top: 0 })))
    .png().toFile(path.join(OUT_DIR, 'run-strip.png'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(OUT_DIR, 'big-run%02d.png'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(OUT_DIR, 'run-preview.gif')]);
  for (const name of names) fs.rmSync(path.join(OUT_DIR, `big-${name}`));
  console.log(`wrote ${FRAMES.length} frames, run-strip.png and run-preview.gif to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, runPose };
