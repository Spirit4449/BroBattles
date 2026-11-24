// Ozzy's posing rig (puppet.cjs through the shared pixel rig) and the preview
// writer every animation script uses.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, PALETTE, PARTS, JOINTS } = require('./puppet.cjs');
const { createRig, mul, translate, rotateAbout, apply, IDENTITY } = require('../pixel-rig/rig.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_ROOT = path.join(ROOT, 'output/ozzy-pixel/rig');
const { compose, renderPose, composeChars, RGB } = createRig({ SIZE, PALETTE, PARTS, outline: { B: '1' }, newOutline: 'B' });

// Animations render on a canvas wider than the 64px rest art so leans, the
// raised staff and effects never clip; the rest art sits centred on it.
const CANVAS = 112;
// Frames carry their pose's attach points (`$`, rest-art coords) for the rig.
const render = (pose, opts = {}) => Object.assign(renderPose(pose, { size: CANVAS, ...opts }), { $: pose.$ });

// A translation that moves `joint` the way `m` moves it, without rotating the
// part: the face and the fist ride along while staying crisp.
function carried(m, joint) {
  const [x, y] = apply(m, joint);
  return translate(x - joint[0], y - joint[1]);
}
const moveTo = (joint, [x, y]) => translate(x - joint[0], y - joint[1]);
const scaleAbout = ([px, py], sx, sy) => [sx, 0, 0, sy, px - sx * px, py - sy * py];

// The standard Ozzy skeleton from a handful of angles (degrees, clockwise =
// toward where he faces) and offsets:
//   root     matrix for the whole figure (jumps, falls, collapses)
//   hips     [dx, dy] shift of everything above the ankles (weight shifts)
//   drop     px the upper body sinks (breathing); lean: upper body about the waist; head tips by `head` on top of it
//            (0 keeps the face unrotated, only carried)
//   near     staff arm about its shoulder; far: open-palm arm about its shoulder
//   staffIn  'near' (the fist, as at rest), 'far' (the fist moves to the far
//            palm) or a point [x, y] (the staff lies loose, `staffAt` about its foot)
//   staffAt  the staff's angle on screen (0 upright, + leaning forward);
//            slide moves it through the hand toward its head (px)
//   book     [dx, dy] off its rest place (floating), 'satchel' (shut at his
//            hip) or null (gone)
//   legs     'rest' or { front: [thigh, shin], back: [thigh, shin] }: the
//            template legs, thigh about the hip and shin about the knee
//   coat     { back, front } degrees the coat panels swing (+ forward)
//   swap     recolours ({ X: 'd' } flares the crystal)
// The returned pose carries `$`: staff head, grip, palm, neck and waist in
// rest-art coordinates, where effects attach.
function figure({
  root = IDENTITY, hips = [0, 0], drop = 0, lean = 0, head = 0, headShift = [0, 0], near = 0, far = 0, staffIn = 'near', staffAt = 0, slide = 0,
  book = [0, 0], bookTurn = 0, grab = false, satchelAt = [-3, 1], legs = 'rest', arms, coat = {}, swap, fistTurn = 0,
} = {}) {
  // `hips` moves everything above the ankles (planted feet stay put).
  const hipRoot = mul(root, translate(hips[0], hips[1]));
  const body = mul(hipRoot, mul(translate(0, drop), rotateAbout(JOINTS.waist, lean)));
  const nearM = mul(body, rotateAbout(JOINTS.nearShoulder, near));
  const farM = mul(body, rotateAbout(JOINTS.farShoulder, far));
  let palm = apply(farM, JOINTS.palm);
  let wrist = apply(nearM, JOINTS.nearWrist);
  // Template arms: [upper, fore] in degrees forward of hanging straight down.
  const armParts = {};
  if (arms) {
    const arm = (side, spec, shoulder) => {
      if (!Array.isArray(spec)) shoulder = spec.shoulder || shoulder;
      const [upper, fore] = Array.isArray(spec) ? spec : armReach(apply(body, shoulder), spec.hand, spec.bend || 1);
      const up = mul(mul(body, moveTo(JOINTS.armShoulder, shoulder)), rotateAbout(JOINTS.armShoulder, -upper));
      const lo = mul(up, rotateAbout(JOINTS.armElbow, -fore));
      armParts[`${side}Upper`] = { m: up, swap };
      armParts[`${side}Fore`] = { m: lo, swap };
      armParts[`${side}Hand`] = { m: carried(lo, JOINTS.armWrist), swap };
      return apply(lo, JOINTS.armWrist);
    };
    wrist = arm('near', arms.near, [24.5, 31]);
    palm = arm('far', arms.far, [37.5, 35]);
  }
  // The head rides the body on whole pixels, so a tilted face resamples the
  // same way every frame instead of shimmering.
  const neckAt = apply(body, JOINTS.neck);
  const headCarry = translate(Math.round(neckAt[0] - JOINTS.neck[0]), Math.round(neckAt[1] - JOINTS.neck[1]));
  const headM = mul(translate(...headShift), head ? mul(headCarry, rotateAbout(JOINTS.neck, head)) : headCarry);

  // Staff: rotate about the grip (or its foot when dropped), then place the grip in the hand.
  const ax = JOINTS.staffHead[0] - JOINTS.grip[0]; const ay = JOINTS.staffHead[1] - JOINTS.grip[1];
  const al = Math.hypot(ax, ay);
  const along = translate((ax / al) * slide, (ay / al) * slide);
  let staffM; let fist = null;
  if (Array.isArray(staffIn)) {
    staffM = mul(moveTo(JOINTS.staffFoot, apply(root, staffIn)), rotateAbout(JOINTS.staffFoot, staffAt + rootDeg(root)));
    // grab: the fist stays on the loose staff at its grip (the arm is posed to meet it).
    if (grab) fist = { m: carried(staffM, JOINTS.grip) };
  } else {
    const hand = staffIn === 'far' ? palm : wrist;
    staffM = mul(moveTo(JOINTS.grip, hand), mul(rotateAbout(JOINTS.grip, staffAt + rootDeg(root)), along));
    fist = { m: mul(moveTo(JOINTS.nearWrist, hand), rotateAbout(JOINTS.nearWrist, fistTurn)) };
    if (arms) armParts[`${staffIn}Hand`] = { hidden: true };
  }

  const pose = {
    torso: { m: body, swap },
    head: { m: headM, swap },
    nearArm: arms ? { hidden: true } : { m: nearM, swap },
    farArm: arms ? { hidden: true } : { m: farM, swap },
    ...armParts,
    staff: { m: staffM, swap },
    fist: fist || { hidden: true },
  };
  if (book === 'satchel') {
    pose.book = { hidden: true };
    pose.satchel = { m: mul(carried(body, [28, 39]), translate(...satchelAt)) };
  } else if (book) {
    pose.book = { m: mul(mul(root, translate(Math.round(book[0]), Math.round(book[1]))), rotateAbout(JOINTS.book, bookTurn)), swap };
  } else pose.book = { hidden: true };

  if (legs === 'rest') {
    for (const p of ['legL', 'bootL', 'legR', 'bootR']) pose[p] = { m: root };
  } else {
    for (const p of ['legL', 'bootL', 'legR', 'bootR']) pose[p] = { hidden: true };
    // spec: [thigh, shin] angles or { ankle, knee }; `foot` is the foot's angle
    // on screen (0 = sole flat, + = toe down), so planted feet stay level.
    const leg = (spec, shift = [0, 0]) => {
      const [thighDeg, shinDeg] = Array.isArray(spec) ? spec : reach([JOINTS.hip[0] + shift[0], JOINTS.hip[1] + shift[1]], spec.ankle, spec.knee);
      const thigh = mul(mul(root, translate(...shift)), rotateAbout(JOINTS.hip, thighDeg));
      const shin = mul(thigh, rotateAbout(JOINTS.knee, shinDeg));
      const footDeg = (Array.isArray(spec) ? 0 : spec.foot || 0) + rootDeg(root);
      const foot = mul(moveTo(ANKLE, apply(shin, ANKLE)), rotateAbout(ANKLE, footDeg));
      return [thigh, shin, foot];
    };
    const hipAt = (h) => [h[0] + hips[0], h[1] + hips[1]];
    const [ft, fs_, ff] = leg(legs.front, hipAt(legs.frontHip || [0, 0]));
    const [bt, bs, bf] = leg(legs.back, hipAt(legs.backHip || [-2, 0]));
    Object.assign(pose, { thigh: { m: ft }, shin: { m: fs_ }, foot: { m: ff }, farThigh: { m: bt }, farShin: { m: bs }, farFoot: { m: bf } });
  }
  const { back = 0, front = 0, backScale, frontScale } = coat;
  pose.coatBack = { m: mul(lean ? mul(hipRoot, rotateAbout(JOINTS.waist, lean * 0.3)) : hipRoot, mul(rotateAbout(JOINTS.coatBackTop, back), backScale ? scaleAbout(JOINTS.coatBackTop, 1, backScale) : IDENTITY)) };
  pose.coatFront = { m: mul(lean ? mul(hipRoot, rotateAbout(JOINTS.waist, lean * 0.3)) : hipRoot, mul(rotateAbout(JOINTS.coatFrontTop, front), frontScale ? scaleAbout(JOINTS.coatFrontTop, 1, frontScale) : IDENTITY)) };
  pose.$ = { head: apply(staffM, JOINTS.staffHead), grip: apply(staffM, JOINTS.grip), palm, wrist, neck: apply(body, JOINTS.neck), waist: apply(root, JOINTS.waist) };
  return pose;
}
// Two-bone IK for the template leg: thigh and shin angles (relative to the rest
// template) that put the ankle on `ankle`, knee bent forward (knee: -1 bends it
// back, for a kneel). Unreachable targets straighten the leg toward them.
const ANKLE = [36, 65];
const deg = (v) => (Math.atan2(v[1], v[0]) * 180) / Math.PI;
function reach(hip, ankle, knee = 1) {
  const L1 = Math.hypot(JOINTS.knee[0] - JOINTS.hip[0], JOINTS.knee[1] - JOINTS.hip[1]);
  const L2 = Math.hypot(ANKLE[0] - JOINTS.knee[0], ANKLE[1] - JOINTS.knee[1]);
  const v = [ankle[0] - hip[0], ankle[1] - hip[1]];
  const d = Math.min(L1 + L2 - 0.01, Math.max(Math.abs(L1 - L2) + 0.01, Math.hypot(...v)));
  const a = (Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) * 180) / Math.PI;
  const thighDir = deg(v) - knee * a;
  const kx = hip[0] + L1 * Math.cos((thighDir * Math.PI) / 180); const ky = hip[1] + L1 * Math.sin((thighDir * Math.PI) / 180);
  const shinDir = deg([ankle[0] - kx, ankle[1] - ky]);
  const thighRot = thighDir - deg([JOINTS.knee[0] - JOINTS.hip[0], JOINTS.knee[1] - JOINTS.hip[1]]);
  const shinRot = shinDir - deg([ANKLE[0] - JOINTS.knee[0], ANKLE[1] - JOINTS.knee[1]]) - thighRot;
  return [thighRot, shinRot];
}

// Two-bone IK for a template arm: [upper, fore] degrees forward of hanging
// down that put the wrist on `hand` (canvas coords, shoulder already placed).
// bend 1 drops the elbow below the shoulder-hand line, -1 lifts it.
function armReach(shoulder, hand, bend = 1) {
  const L1 = JOINTS.armElbow[1] - JOINTS.armShoulder[1];
  const L2 = JOINTS.armWrist[1] - JOINTS.armElbow[1];
  const v = [hand[0] - shoulder[0], hand[1] - shoulder[1]];
  const d = Math.min(L1 + L2 - 0.01, Math.max(Math.abs(L1 - L2) + 0.01, Math.hypot(...v)));
  const a = (Math.acos((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d)) * 180) / Math.PI;
  const upperDir = deg(v) + bend * a;
  const ex = shoulder[0] + L1 * Math.cos((upperDir * Math.PI) / 180); const ey = shoulder[1] + L1 * Math.sin((upperDir * Math.PI) / 180);
  const foreDir = deg([hand[0] - ex, hand[1] - ey]);
  return [90 - upperDir, -(foreDir - upperDir)];
}

function rootDeg(root) { return (Math.atan2(root[1], root[0]) * 180) / Math.PI; }

const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

// Writes frames, a strip, a 6x preview GIF and a 3x contact sheet to
// output/ozzy-pixel/rig/<name>/. Frames are square RGBA of any side.
async function writePreview(name, frames, fps, { scale = 6 } = {}) {
  const dir = path.join(OUT_ROOT, name);
  const side = Math.sqrt(frames[0].length / 4);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const big = [];
  for (const [i, px] of frames.entries()) {
    await raw(px, side).png().toFile(path.join(dir, `${name}${String(i).padStart(2, '0')}.png`));
    const b = path.join(dir, `big${String(i).padStart(2, '0')}.png`);
    await raw(px, side).resize(side * scale, side * scale, { kernel: 'nearest' }).flatten({ background: '#8c8c96' }).png().toFile(b);
    big.push(b);
  }
  const sheetScale = 3; const cols = Math.min(frames.length, 4);
  await sharp({ create: { width: side * sheetScale * cols, height: side * sheetScale * Math.ceil(frames.length / cols), channels: 4, background: '#8c8c96' } })
    .composite(await Promise.all(frames.map(async (px, i) => ({
      input: await raw(px, side).resize(side * sheetScale, side * sheetScale, { kernel: 'nearest' }).png().toBuffer(),
      left: (i % cols) * side * sheetScale, top: Math.floor(i / cols) * side * sheetScale }))))
    .png().toFile(path.join(dir, `${name}-sheet.png`));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'big%02d.png'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(dir, `${name}.gif`)]);
  for (const b of big) fs.rmSync(b);
  console.log(`wrote ${frames.length} ${name} frames to ${path.relative(ROOT, dir)}`);
}

module.exports = { reach, armReach, ANKLE, SIZE, CANVAS, JOINTS, PALETTE, RGB, compose, render, composeChars, carried, moveTo, writePreview, figure, mul, translate, rotateAbout, scaleAbout, apply, IDENTITY };
