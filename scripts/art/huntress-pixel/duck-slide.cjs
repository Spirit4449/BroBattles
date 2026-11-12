#!/usr/bin/env node
// Huntress crouch and wall slide: one held frame each (duck00, slide00 in
// animations.json), replacing the resized legacy drawings.
//   duck:  a low archer's crouch. Hips dropped to the duck hitbox, knees bent
//          over planted feet, the tunic draped over the thighs, the bow tipped
//          forward so it stays inside the crouched silhouette.
//   slide: pressed against the wall she faces (the hitbox's front edge), the
//          near boot braced on it, the free hand reaching up the wall, the far
//          leg hanging, the bow swung down and back off the wall, hair and hem
//          blown up by the slide.
// Angles are degrees, positive = clockwise on screen.
//   node scripts/art/huntress-pixel/duck-slide.cjs   -> output/huntress-pixel/duck-slide/
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { JOINTS, PARTS } = require('./parts.cjs');
const { renderPose, mul, translate, rotateAbout, apply } = require('./render.cjs');
const { reach, GROUND, SOLE_FROM_ANKLE } = require('./legs.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/huntress-pixel/duck-slide');
const CANVAS = 96; // room past the 64px rest canvas for the reaching hand and swung bow
const PREVIEW_SCALE = 5;
const PLANTED = GROUND - SOLE_FROM_ANKLE[1]; // ankle height of a foot standing on the ground
const NEAR_HIP = [36, 41];
const FAR_HIP = [32, 41];

const carried = (body, joint) => {
  const [x, y] = apply(body, joint);
  return translate(Math.round(x - joint[0]), Math.round(y - joint[1]));
};

// The tunic hem, gathered: rows below the hip are squashed toward it by
// `squash` and spread sideways by `spread`, read back through the body pose.
const SKIRT_TOP = PARTS.skirt.at[1];
function gather(bodyInverse, { squash, spread, lift = 0 }) {
  const cx = JOINTS.hip[0];
  return (x, y) => {
    const [rx, ry] = apply(bodyInverse, [x, y]);
    if (ry < SKIRT_TOP) return [rx, ry];
    const t = Math.min(1, (ry - SKIRT_TOP) / 6); // the waistband stays put; the hem gathers
    const k = 1 + (squash - 1) * t; const w = 1 + (spread - 1) * t;
    return [cx + (rx - cx) / w, SKIRT_TOP + (ry - SKIRT_TOP) * k - lift * t];
  };
}
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

const DUCK = { drop: 11, lean: 8, shift: 1, near: [45, PLANTED], far: [26, PLANTED],
  frontArm: -6, bow: 34, backArm: [-18, -30], skirt: { squash: 1.9, spread: 1.15 } };

function duckPose(p = DUCK) {
  const body = mul(translate(p.shift, p.drop), rotateAbout(JOINTS.hip, p.lean));
  const near = reach(apply(body, NEAR_HIP), p.near);
  const far = reach(apply(body, FAR_HIP), p.far);
  const frontArm = mul(body, rotateAbout(JOINTS.frontShoulder, p.frontArm));
  const bow = mul(frontArm, rotateAbout(JOINTS.grip, p.bow));
  // The free hand rests forward on the near knee.
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, p.backArm[0]));
  const backFore = mul(backUpper, rotateAbout(JOINTS.backElbow, p.backArm[1]));
  return {
    backLeg: { hidden: true },
    farKnee: { m: far.thighM }, farThigh: { m: far.thighM }, farBoot: { m: far.bootM },
    nearKnee: { m: near.thighM }, frontThigh: { m: near.thighM }, frontBoot: { m: near.bootM },
    torso: { m: body },
    skirt: { warp: gather(invert(body), p.skirt) },
    quiver: { m: body },
    head: { m: carried(body, JOINTS.neck) }, hairBack: { m: carried(body, JOINTS.neck) },
    backUpper: { m: backUpper }, backFore: { m: backFore }, backHand: { m: backFore },
    frontArm: { m: frontArm }, bow: { m: bow }, bowHand: { m: bow },
  };
}

const SLIDE = { shift: 1, lift: -4, lean: 7, near: [44, 55], far: [22, 55],
  frontArm: 110, bow: -118, backArm: [-170, -8], hair: -22, skirt: { squash: 1.2, spread: 1.2, lift: 3 } };

function slidePose(p = SLIDE) {
  const body = mul(translate(p.shift, p.lift), rotateAbout(JOINTS.hip, p.lean));
  const near = reach(apply(body, NEAR_HIP), p.near);
  const far = reach(apply(body, FAR_HIP), p.far);
  const frontArm = mul(body, rotateAbout(JOINTS.frontShoulder, p.frontArm));
  const bow = mul(frontArm, rotateAbout(JOINTS.grip, p.bow));
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, p.backArm[0]));
  const backFore = mul(backUpper, rotateAbout(JOINTS.backElbow, p.backArm[1]));
  const head = carried(body, JOINTS.neck);
  return {
    backLeg: { hidden: true },
    farKnee: { m: far.thighM }, farThigh: { m: far.thighM }, farBoot: { m: far.bootM },
    nearKnee: { m: near.thighM }, frontThigh: { m: near.thighM }, frontBoot: { m: near.bootM },
    torso: { m: body },
    skirt: { warp: gather(invert(body), p.skirt) },
    quiver: { m: body },
    head: { m: head }, hairBack: { m: mul(head, rotateAbout(JOINTS.hairRoot, p.hair)) },
    // The far arm reaches forward and up, its hand on the wall.
    backUpper: { m: backUpper }, backFore: { m: backFore }, backHand: { m: backFore },
    // The bow hangs at her side, behind her, clear of the wall.
    frontArm: { m: frontArm }, bow: { hidden: true }, droppedBow: { m: bow }, bowHand: { m: bow },
  };
}

// Limbs travel far from their rest places, so rest-pose gap filling is off.
const FRAMES = {
  duck: [renderPose(duckPose(), { size: CANVAS, patch: false })],
  slide: [renderPose(slidePose(), { size: CANVAS, patch: false })],
};
const raw = (data) => sharp(data, { raw: { width: CANVAS, height: CANVAS, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = Object.entries(FRAMES).flatMap(([name, frames]) => frames.map((px, i) => [`${name}${String(i).padStart(2, '0')}`, px]));
  const big = CANVAS * PREVIEW_SCALE;
  const tiles = [];
  for (const [i, [name, px]] of all.entries()) {
    await raw(px).png().toFile(path.join(OUT_DIR, `${name}.png`));
    tiles.push({ input: await raw(px).resize(big, big, { kernel: 'nearest' }).png().toBuffer(), left: i * big, top: 0 });
  }
  await sharp({ create: { width: big * all.length, height: big, channels: 4, background: '#ffffff' } })
    .composite(tiles).png().toFile(path.join(OUT_DIR, 'duck-slide-strip.png'));
  console.log(`wrote ${all.map(([n]) => n).join(' ')} and duck-slide-strip.png to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { CANVAS, FRAMES, DUCK, SLIDE, duckPose, slidePose };
