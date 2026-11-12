#!/usr/bin/env node
// Sparrow death: 10 frames at 10 fps, played once (the die row in animations.json).
// The legacy death's beats, frame for frame: hit, the bow slips forward out of her
// hand, she buckles onto both knees while the bow drops flat in front of her,
// sways, then tips forward around the front knee until she lies face down.
// The whole body tips as one piece; at the end it turns exactly 90°, which is
// lossless for pixel art, so the lying frames are the idle art itself.
//   node scripts/art/sparrow-pixel/die.cjs   -> output/sparrow-pixel/die/
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, JOINTS, PARTS } = require('./parts.cjs');
const { compose, renderPose, mul, translate, rotateAbout, apply } = require('./render.cjs');
const { legChain, lowestBootY, GROUND } = require('./legs.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/sparrow-pixel/die');
const FPS = 10;
const PREVIEW_SCALE = 4;
const CANVAS = 160; // the fallen bow and the lying body reach past the 64px art
const MARGIN = (CANVAS - SIZE) / 2;

const NEAR_HIP = [34, 41];
const FAR_HIP = [31, 41];
const BOW_FOOT = [49, 58]; // bottom tip of the bow: it pivots here as it falls

// One row per legacy frame. legs: null = idle stance, else [thigh, bend] for the
// near and far leg (degrees; bend folds the shin back). lean tips the upper body
// about the hips. tip turns the whole body forward about the front knee; the legs
// straighten out of the kneel as it goes, so at 90 she lies flat, toes down.
// arm / back rotate the bow arm and the free arm (+ = clockwise; both hang down
// at her sides when kneeling and lie along her body when she is down).
const KNEEL = [[0, 90], [-8, 98]];
const BEATS = [
  { legs: null, lean: 0, tip: 0, bow: 0, arm: 0, back: [0, 0] }, // standing
  { legs: null, lean: -6, tip: 0, bow: 20, arm: -14, back: [10, 6] }, // hit: jolts back, bow slips forward
  { legs: [[22, 75], [-18, 105]], lean: -2, tip: 0, bow: 55, arm: 18, back: [-20, -8] }, // buckling, bow falling
  { legs: KNEEL, lean: 0, tip: 0, bow: 90, arm: 40, back: [-45, -12] }, // on her knees, bow down
  { legs: KNEEL, lean: -3, tip: 0, bow: 90, arm: 44, back: [-50, -14] }, // sways back
  { legs: KNEEL, lean: 6, tip: 0, bow: 90, arm: 48, back: [-52, -14] }, // sags forward
  { legs: KNEEL, lean: 6, tip: 25, bow: 90, arm: 50, back: [-52, -12] }, // tipping
  { legs: KNEEL, lean: 4, tip: 60, bow: 90, arm: 58, back: [-56, -10] }, // falling
  { legs: KNEEL, lean: 0, tip: 90, bow: 90, arm: 65, back: [-60, -8] }, // face down
  { legs: KNEEL, lean: 0, tip: 90, bow: 90, arm: 65, back: [-62, -6] }, // settles
];

// Lowest pixel row (rest-canvas coords) that the listed parts cover in a pose,
// before renderPose adds the outline (which sits one row lower).
function lowestRow(pose, names) {
  const only = Object.fromEntries(Object.keys(PARTS).map((n) => [n, names.includes(n) ? pose[n] || {} : { hidden: true }]));
  const px = compose(only, CANVAS);
  for (let y = CANVAS - 1; y >= 0; y--) for (let x = 0; x < CANVAS; x++) if (px[(y * CANVAS + x) * 4 + 3]) return y - MARGIN;
  return null;
}

// Body height that puts the near boot on the ground for a kneeling leg pose.
function kneelDrop([nearThigh, nearBend]) {
  let lo = -5; let hi = 25;
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    const leg = legChain([NEAR_HIP[0], NEAR_HIP[1] + mid], nearThigh, nearThigh - nearBend);
    if (lowestBootY(leg.bootM) < GROUND) lo = mid; else hi = mid;
  }
  return Math.round(lo);
}

const UPPER = ['quiver', 'hairBack', 'backHand', 'backFore', 'backUpper', 'torso', 'skirt', 'head', 'frontArm', 'bowHand'];

const LEGS = ['backLeg', 'farKnee', 'farThigh', 'farBoot', 'nearKnee', 'frontThigh', 'frontBoot'];

function diePose(frame) {
  const beat = BEATS[frame];
  const pose = {};
  let drop = 0;
  let knee = null;
  if (beat.legs) {
    drop = kneelDrop(beat.legs[0]);
    knee = apply(legChain([NEAR_HIP[0], NEAR_HIP[1] + drop], ...KNEEL[0].map((v, i) => (i ? KNEEL[0][0] - v : v))).thighM, JOINTS.frontKnee);
    const straighten = 1 - beat.tip / 90;
    const [near, far] = [[NEAR_HIP, beat.legs[0]], [FAR_HIP, beat.legs[1]]]
      .map(([hip, [thigh, bend]]) => legChain([hip[0], hip[1] + drop], thigh * straighten, (thigh - bend) * straighten));
    Object.assign(pose, {
      backLeg: { hidden: true },
      farKnee: { m: far.thighM }, farThigh: { m: far.thighM }, farBoot: { m: far.bootM },
      nearKnee: { m: near.thighM }, frontThigh: { m: near.thighM }, frontBoot: { m: near.bootM },
    });
  }

  // Upper body: drop to the knees and lean about the hips.
  const body = mul(translate(0, drop), rotateAbout(JOINTS.hip, beat.lean));
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, beat.back[0]));
  const backFore = mul(backUpper, rotateAbout(JOINTS.backElbow, beat.back[1]));
  const frontArm = mul(body, rotateAbout(JOINTS.frontShoulder, beat.arm));
  Object.assign(pose, {
    torso: { m: body }, skirt: { m: body }, quiver: { m: body }, head: { m: body }, hairBack: { m: body },
    backUpper: { m: backUpper }, backFore: { m: backFore }, backHand: { m: backFore },
    frontArm: { m: frontArm }, bowHand: { m: frontArm },
  });

  // Falling: the whole body turns forward about the front knee as one piece, then
  // is set down so its lowest pixel rests on the ground.
  if (beat.tip) {
    const tipM = rotateAbout(knee, beat.tip);
    const all = [...UPPER, ...LEGS];
    for (const name of all) if (pose[name]?.m) pose[name] = { m: mul(tipM, pose[name].m) };
    const low = lowestRow(pose, all);
    const settle = translate(0, JOINTS.feet - 1 - low + (beat.settle || 0));
    for (const name of all) if (pose[name]?.m) pose[name] = { m: mul(settle, pose[name].m) };
  }

  // The bow tips forward about its bottom tip and comes to rest on the ground.
  let bow = rotateAbout(BOW_FOOT, beat.bow);
  if (beat.bow) {
    const low = lowestRow({ bow: { m: bow } }, ['bow']);
    bow = mul(translate(beat.bow >= 90 ? 4 : 0, JOINTS.feet - 1 - low), bow);
  }
  // Once it is down it lies under her.
  if (beat.bow >= 90) Object.assign(pose, { bow: { hidden: true }, droppedBow: { m: bow } });
  else pose.bow = { m: bow };
  return pose;
}

// The pose moves parts far from their rest places, so rest-pose gap filling is off.
// The rebuilt outline can add or trim a bottom row, so each finished frame is
// nudged until its lowest pixel sits on the idle's ground row.
function renderOnGround(pose) {
  for (let tries = 0; ; tries++) {
    const px = renderPose(pose, { patch: false, size: CANVAS });
    let low = -1;
    for (let i = 3; i < px.length; i += 4) if (px[i]) low = Math.floor((i - 3) / 4 / CANVAS);
    const off = JOINTS.feet + MARGIN - low;
    if (!off || tries === 3) return px;
    pose = Object.fromEntries(Object.entries(pose).map(([n, p]) => [n, p.m ? { m: mul(translate(0, off), p.m) } : p]));
  }
}
const FRAMES = BEATS.map((_, i) => renderOnGround(diePose(i)));
const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const names = [];
  for (const [i, px] of FRAMES.entries()) {
    const name = `die${String(i).padStart(2, '0')}.png`;
    await raw(px, CANVAS).png().toFile(path.join(OUT_DIR, name));
    await raw(px, CANVAS).resize(CANVAS * PREVIEW_SCALE, CANVAS * PREVIEW_SCALE, { kernel: 'nearest' })
      .flatten({ background: '#ffffff' }).png().toFile(path.join(OUT_DIR, `big-${name}`));
    names.push(name);
  }
  await sharp({ create: { width: CANVAS * FRAMES.length, height: CANVAS, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(names.map((name, i) => ({ input: path.join(OUT_DIR, name), left: i * CANVAS, top: 0 })))
    .png().toFile(path.join(OUT_DIR, 'die-strip.png'));
  // Hold the last frame so the preview reads as a one-shot, as in the game.
  const list = [...names.map((n) => `big-${n}`), ...Array(10).fill(`big-${names.at(-1)}`)];
  fs.writeFileSync(path.join(OUT_DIR, 'frames.txt'), list.map((n) => `file '${n}'\nduration ${1 / FPS}`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(OUT_DIR, 'frames.txt'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(OUT_DIR, 'die-preview.gif')]);
  for (const name of names) fs.rmSync(path.join(OUT_DIR, `big-${name}`));
  fs.rmSync(path.join(OUT_DIR, 'frames.txt'));
  console.log(`wrote ${FRAMES.length} frames, die-strip.png and die-preview.gif to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, diePose, CANVAS };
