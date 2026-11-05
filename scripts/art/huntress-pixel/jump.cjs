#!/usr/bin/env node
// Huntress jump and fall: two separate animations, each a held pose (2 frames,
// played once at 14 fps and held on the last; see characters/huntress/anim.js).
//   jump: a forward dive. She leans into the bow side, the back arm reaches
//         straight back, the bow tips up in front and both legs trail behind with
//         the toes pointed; frame 01 stretches a little further.
//   fall: a winged hover. Upright, the back arm held straight out, the tunic hem
//         flared out like wings, legs dangling in an A (far leg straight and
//         angled back, near knee forward with the shin hanging), hair blown up;
//         frame 01 is the flutter.
// Angles are degrees, positive = clockwise on screen; renderPose rebuilds the
// outline afterwards.
//   node scripts/art/huntress-pixel/jump.cjs   -> output/huntress-pixel/jump/
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { JOINTS, PARTS } = require('./parts.cjs');
const { renderPose, mul, translate, rotateAbout, apply } = require('./render.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_DIR = path.join(ROOT, 'output/huntress-pixel/jump');
const PREVIEW_SCALE = 5;
// Mid-air poses reach past the 64px rest canvas, so they render on a bigger one
// with the rest art centred (CANVAS - SIZE) / 2 px in from each edge.
const CANVAS = 96;

// Legs use the front-leg template (thigh + boot; the far leg is the same art one
// shade darker, see parts.cjs) so both can fold at the knee. Each leg is
// [thigh angle from vertical, + = forward; knee bend, how far the shin folds back].
const NEAR_HIP = [36, 41];
const FAR_HIP = [32, 41];

// The shin folds back at most ~85 deg; past that the template boot crumples
// into the thigh.
// Each leg is [thigh angle, knee bend, toe point].
const POSES = {
  jump: [
    { lift: 0, lean: 6, backArm: [10, 4], frontArm: -8, bow: 22, hair: -5,
      near: [2, 30, 55], far: [-28, 6, 50], skirt: { back: 0.35, front: 0, rise: 3 } },
    { lift: 0, lean: 7, backArm: [13, 5], frontArm: -10, bow: 23, hair: -7,
      near: [-2, 32, 60], far: [-31, 5, 55], skirt: { back: 0.45, front: 0, rise: 3.5 } },
  ],
  fall: [
    { lift: 0, lean: 0, backArm: [28, 4], frontArm: -30, bow: 58, hair: 10,
      near: [62, 80, 45], far: [-6, 28, 55], skirt: { back: 1.1, front: 0.45, rise: 4 } },
    { lift: -1, lean: 0, backArm: [33, 6], frontArm: -31, bow: 60, hair: 13,
      near: [66, 84, 50], far: [-8, 32, 60], skirt: { back: 1.4, front: 0.55, rise: 5 } },
  ],
};

// The tunic hem flares out from the hips: each skirt row is widened about the
// hip line in proportion to how far down the skirt it is (more on the back side,
// which catches the air), and the hem lifted `rise` px.
const SKIRT_TOP = PARTS.skirt.at[1];
const SKIRT_SPAN = PARTS.skirt.rows.length - 1;
function flare(bodyInverse, { back, front, rise }) {
  const cx = JOINTS.hip[0];
  return (x, y) => {
    const [rx, ry] = apply(bodyInverse, [x, y]);
    const t = Math.min(1, Math.max(0, (ry - SKIRT_TOP) / SKIRT_SPAN));
    const widen = 1 + (rx < cx ? back : front) * t;
    return [cx + (rx - cx) / widen, ry + rise * t];
  };
}

const angleOf = (from, to) => (Math.atan2(to[0] - from[0], to[1] - from[1]) * 180) / Math.PI;
const REST_THIGH = angleOf(JOINTS.frontHip, JOINTS.frontKnee);
const REST_SHIN = angleOf(JOINTS.frontKnee, JOINTS.frontAnkle);

// Rotations that turn the template's thigh and shin to absolute angles, hung
// from `hip`. Screen rotation is clockwise-positive, which swings a limb backward.
function legChain(hip, [thigh, bend, toe = 0]) {
  const thighM = mul(translate(hip[0] - JOINTS.frontHip[0], hip[1] - JOINTS.frontHip[1]),
    rotateAbout(JOINTS.frontHip, REST_THIGH - thigh));
  const shinM = mul(thighM, rotateAbout(JOINTS.frontKnee, (REST_SHIN - (thigh - bend)) - (REST_THIGH - thigh)));
  return { thigh: { m: thighM }, boot: { warp: ankle(shinM, toe) }, tucked: bend > KNEE_TUCK };
}

// The boot is one piece (shin + foot) whose toe points forward like a standing
// foot. Mid-air the toe should point: `toe` degrees turns the foot about the
// ankle, clockwise = toe down. Each output pixel is read from the foot if the
// turned foot covers it, otherwise from the shin.
const BOOT = PARTS.frontBoot;
const FOOT_TOP = JOINTS.frontAnkle[1] - 1;
const bootHas = ([x, y]) => (BOOT.rows[Math.floor(y) - BOOT.at[1]]?.[Math.floor(x) - BOOT.at[0]] ?? '.') !== '.';
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}
function ankle(shinM, toe) {
  const toShin = invert(shinM);
  const toFoot = invert(mul(shinM, rotateAbout(JOINTS.frontAnkle, toe)));
  return (x, y) => {
    const foot = apply(toFoot, [x, y]);
    if (foot[1] >= FOOT_TOP && bootHas(foot)) return foot;
    const shin = apply(toShin, [x, y]);
    return shin[1] < FOOT_TOP ? shin : [-1e3, -1e3];
  };
}

// On a deeply bent knee the shin's top overlaps the thigh, and the thigh must
// cover it. Parts draw in a fixed order (boot over thigh), so a tucked near boot
// is rendered on its own and laid under the finished figure.
const KNEE_TUCK = 40;

function airPose(p) {
  const body = mul(translate(0, p.lift), rotateAbout(JOINTS.hip, p.lean));
  const bodyInverse = mul(rotateAbout(JOINTS.hip, -p.lean), translate(0, -p.lift));
  // The head rides the lean without rotating so the face stays crisp.
  const carried = (joint) => {
    const [x, y] = apply(body, joint);
    return translate(x - joint[0], y - joint[1]);
  };
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, p.backArm[0]));
  const backFore = mul(backUpper, rotateAbout(JOINTS.backElbow, p.backArm[1]));
  const frontArm = mul(body, rotateAbout(JOINTS.frontShoulder, p.frontArm));
  const bow = mul(frontArm, rotateAbout(JOINTS.grip, p.bow));
  const near = legChain(apply(body, NEAR_HIP), p.near);
  const far = legChain(apply(body, FAR_HIP), p.far);
  return {
    backLeg: { hidden: true },
    farKnee: far.thigh, farThigh: far.thigh, farBoot: far.boot,
    nearKnee: near.thigh, frontThigh: near.thigh, frontBoot: near.boot, nearTucked: near.tucked,
    torso: { m: body },
    skirt: { warp: flare(bodyInverse, p.skirt) },
    quiver: { m: body },
    head: { m: carried(JOINTS.neck) },
    hairBack: { m: mul(carried(JOINTS.neck), rotateAbout(JOINTS.hairRoot, p.hair)) },
    backUpper: { m: backUpper },
    backFore: { m: backFore },
    backHand: { m: backFore },
    frontArm: { m: frontArm },
    bow: { m: bow },
    bowHand: { m: bow },
  };
}

// In the air she holds the bow by its grip with the lower limb swung behind her
// body and legs, out of sight (as in the original jump and fall), so only the
// limb above the grip is drawn.
function upperBow(m) {
  const back = invert(m);
  return (x, y) => {
    const r = apply(back, [x, y]);
    return r[1] <= JOINTS.grip[1] ? r : [-1e3, -1e3];
  };
}
const { PARTS: ALL_PARTS } = require('./parts.cjs');
function renderAir(pose) {
  const { nearTucked, ...parts } = pose;
  const front = renderPose({ ...parts, bow: { warp: upperBow(parts.bow.m) }, ...(nearTucked && { frontBoot: { hidden: true } }) }, { size: CANVAS });
  if (!nearTucked) return front;
  const only = Object.fromEntries(Object.keys(ALL_PARTS).map((name) => [name, { hidden: true }]));
  const boot = renderPose({ ...only, frontBoot: parts.frontBoot }, { size: CANVAS, patch: false });
  for (let i = 0; i < front.length; i += 4) if (!front[i + 3] && boot[i + 3]) boot.copy(front, i, i, i + 4);
  return front;
}

const FRAMES = Object.fromEntries(Object.entries(POSES).map(([name, poses]) => [name, poses.map((p) => renderAir(airPose(p)))]));
const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const all = Object.entries(FRAMES).flatMap(([name, frames]) => frames.map((px, i) => [`${name}${String(i).padStart(2, '0')}`, px]));
  for (const [name, px] of all) await raw(px, CANVAS).png().toFile(path.join(OUT_DIR, `${name}.png`));
  const big = CANVAS * PREVIEW_SCALE;
  const tiles = await Promise.all(all.map(async ([, px], i) => ({
    input: await raw(px, CANVAS).resize(big, big, { kernel: 'nearest' }).png().toBuffer(), left: i * big, top: 0,
  })));
  await sharp({ create: { width: big * all.length, height: big, channels: 4, background: '#ffffff' } })
    .composite(tiles).png().toFile(path.join(OUT_DIR, 'jump-fall-strip.png'));
  console.log(`wrote ${all.map(([n]) => n).join(' ')} and jump-fall-strip.png to ${path.relative(ROOT, OUT_DIR)}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { CANVAS, FRAMES, POSES, airPose };
