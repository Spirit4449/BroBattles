// Draven's posing rig (puppet.cjs through the shared pixel rig) and the preview
// writer every animation script uses.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const sharp = require('../../../spritesheet-generator/node_modules/sharp');
const { SIZE, PALETTE, PARTS, JOINTS } = require('./puppet.cjs');
const { createRig, mul, translate, rotateAbout, apply, IDENTITY } = require('../pixel-rig/rig.cjs');

const ROOT = path.resolve(__dirname, '../../..');
const OUT_ROOT = path.join(ROOT, 'output/draven-pixel/rig');
const { compose, renderPose } = createRig({ SIZE, PALETTE, PARTS, outline: { A: '1' }, newOutline: 'A' });

// Animations render on a canvas wider than the 64px rest art so leans and the
// raised staff never clip; the rest art sits centred on it.
const CANVAS = 96;
const render = (pose, opts = {}) => renderPose(pose, { size: CANVAS, ...opts });

// A translation that moves `joint` the way `m` moves it, without rotating the
// part: faces and crystals ride along while staying crisp.
function carried(m, joint) {
  const [x, y] = apply(m, joint);
  return translate(x - joint[0], y - joint[1]);
}

const D2R = Math.PI / 180;
const invertM = (m) => {
  const det = m[0] * m[3] - m[1] * m[2];
  const [a, b, c, d] = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
};

// The standard Draven skeleton from a handful of angles (degrees, clockwise =
// toward where he faces) and offsets, for the action poses:
//   root    matrix applied to the whole figure (jumps, falls, collapses)
//   lean    upper body about the waist; hood tips by `hood` on top of it
//   backArm / backHand, frontArm, staff (about the grip), or staffAt: the
//           staff's angle on screen (0 upright, + forward); slide moves the
//           staff through the hand toward its head (px, + = more staff above
//           the hand); staffShift [dx, dy] drops it: the staff and hand move
//           off the arm together
//   robe    { len (<1 lifts the hem), spread (hem width factor), shift (px at
//           the hem, curving in), swing (px at the hem, straight: the robe
//           swings like a pendulum from the waist), wave (d => extra px), cx,
//           curve (rounds the hem), tilt (slants it, + = front lower) }
//   magic / crystal / shardLeft / shardRight  [dx, dy] off the staff head, or
//           null to hide; swap recolours the magic (and `glow` the crystal/shards)
// The returned pose carries `$`: the staff head, grip, neck and waist in rest-art
// coordinates, where effects attach. Unknown keys are ignored by the renderer.
function figure({
  root = IDENTITY, lean = 0, hood = 0, backArm = 0, backHand = 0, frontArm = 0, staff: staffRel = 0, staffAt,
  robe = {}, staffShift = [0, 0], slide = 0, magic = [0, 0], crystal = [0, 0], shardLeft = [0, 0], shardRight = [0, 0], swap, glow,
} = {}) {
  const rootDeg = (Math.atan2(root[1], root[0]) * 180) / Math.PI;
  const staff = staffAt === undefined ? staffRel : staffAt - rootDeg - lean - frontArm;
  const body = mul(root, rotateAbout(JOINTS.waist, lean));
  const backUpper = mul(body, rotateAbout(JOINTS.backShoulder, backArm));
  const front = mul(body, rotateAbout(JOINTS.frontShoulder, frontArm));
  const held = mul(translate(...staffShift), mul(front, rotateAbout(JOINTS.grip, staff)));
  // Sliding the staff along its own axis: its rest direction is grip -> head.
  const [ax, ay] = [JOINTS.staffHead[0] - JOINTS.grip[0], JOINTS.staffHead[1] - JOINTS.grip[1]];
  const al = Math.hypot(ax, ay);
  const staffM = slide ? mul(held, translate((ax / al) * slide, (ay / al) * slide)) : held;
  const head = carried(staffM, JOINTS.staffHead);
  const at = (off) => (off ? { m: mul(translate(Math.round(off[0]), Math.round(off[1])), head), swap: glow } : { hidden: true });
  const { len = 1, spread = 1, shift = 0, swing = 0, wave, cx = 26, curve = 0, tilt = 0 } = robe;
  const top = JOINTS.hemTop; const span = JOINTS.ground - top;
  const unroot = invertM(root);
  const robeWarp = (ox, oy) => {
    const [x, y] = apply(unroot, [ox, oy]);
    if (y < top) return [x, y];
    // curve > 0 rounds the hem (sides lifted), tilt > 0 drops its front edge:
    // the robe hanging free in the air instead of standing on the ground.
    const o = (x - cx) / 14;
    const sy = top + (y - top) / (len * Math.max(0.3, 1 + tilt * o - curve * o * o));
    const d = Math.max(0, Math.min(1, (sy - top) / span));
    const sp = 1 + (spread - 1) * d * d;
    return [cx + (x - shift * d * d - swing * d - (wave ? wave(d) : 0) - cx) / sp, sy];
  };
  return {
    robe: { warp: robeWarp },
    torso: { m: body },
    hood: { m: mul(carried(body, JOINTS.neck), rotateAbout(JOINTS.neck, hood)) },
    backArm: { m: backUpper },
    backHand: { m: mul(backUpper, rotateAbout(JOINTS.backWrist, backHand)) },
    staff: { m: staffM },
    frontArm: { m: front },
    grip: { m: held },
    magic: magic ? { m: mul(translate(Math.round(magic[0]), Math.round(magic[1])), head), swap } : { hidden: true },
    crystal: at(crystal),
    shardLeft: at(shardLeft),
    shardRight: at(shardRight),
    $: { head: apply(staffM, JOINTS.staffHead), grip: apply(front, JOINTS.grip), neck: apply(body, JOINTS.neck), waist: apply(root, JOINTS.waist) },
  };
}

// Ember / magic recolours shared by the actions.
const SWAPS = {
  flare: { R: 'Z', E: 'O', M: 'b', C: 'M' }, // magic flares bright
  hot: { R: 'Z', Z: 'R' },
  dim: { R: 'G', b: 'O', O: 'M', M: 'E' }, // dying light
  dark: { R: 'B', Z: 'J', Y: 'J', b: 'M', O: 'E', M: 'C', E: 'C' },
};

const raw = (data, width, height = width) => sharp(data, { raw: { width, height, channels: 4 } });

// Writes frames, a strip, a 6x preview GIF and a 6x contact sheet to
// output/draven-pixel/rig/<name>/. Frames are square RGBA of any side.
async function writePreview(name, frames, fps, { scale = 6 } = {}) {
  const dir = path.join(OUT_ROOT, name);
  const side = Math.sqrt(frames[0].length / 4); // CANVAS, or wider for effects
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const big = [];
  for (const [i, px] of frames.entries()) {
    const file = path.join(dir, `${name}${String(i).padStart(2, '0')}.png`);
    await raw(px, side).png().toFile(file);
    const b = path.join(dir, `big${String(i).padStart(2, '0')}.png`);
    await raw(px, side).resize(side * scale, side * scale, { kernel: 'nearest' }).flatten({ background: '#8c8c96' }).png().toFile(b);
    big.push(b);
  }
  await sharp({ create: { width: side * frames.length, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames.map((px, i) => ({ input: px, raw: { width: side, height: side, channels: 4 }, left: i * side, top: 0 })))
    .png().toFile(path.join(dir, `${name}-strip.png`));
  const sheetScale = 3;
  await sharp({ create: { width: side * sheetScale * Math.min(frames.length, 6), height: side * sheetScale * Math.ceil(frames.length / 6), channels: 4, background: '#8c8c96' } })
    .composite(await Promise.all(frames.map(async (px, i) => ({
      input: await raw(px, side).resize(side * sheetScale, side * sheetScale, { kernel: 'nearest' }).png().toBuffer(),
      left: (i % 6) * side * sheetScale, top: Math.floor(i / 6) * side * sheetScale }))))
    .png().toFile(path.join(dir, `${name}-sheet.png`));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, 'big%02d.png'),
    '-vf', 'split[a][b];[a]palettegen=reserve_transparent=0[p];[b][p]paletteuse=dither=none', '-loop', '0', path.join(dir, `${name}.gif`)]);
  for (const b of big) fs.rmSync(b);
  console.log(`wrote ${frames.length} ${name} frames to ${path.relative(ROOT, dir)}`);
}

// Lift everything above the hem by `up` whole pixels while the hem stays on
// the ground: the robe's top rows ride up and the rest stretches to the hem.
function lift(pose, up) {
  if (!up) return pose;
  const out = {};
  const top = JOINTS.hemTop; const span = JOINTS.ground - top;
  for (const [k, v] of Object.entries(pose)) {
    if (k === '$') out.$ = Object.fromEntries(Object.entries(v).map(([n, [x, y]]) => [n, n === 'waist' ? [x, y] : [x, y - up]]));
    else if (k === 'robe') {
      const warp = v.warp;
      out.robe = { ...v, warp: (x, y) => warp(x, y < top - up ? y + up : top + ((y - top + up) * span) / (span + up)) };
    } else out[k] = v.m ? { ...v, m: mul(translate(0, -up), v.m) } : v;
  }
  return out;
}

// Scale about a point (squashing a fallen body flat against the ground).
const scaleAbout = ([px, py], sx, sy) => [sx, 0, 0, sy, px - sx * px, py - sy * py];

module.exports = { SIZE, CANVAS, JOINTS, compose, render, carried, writePreview, figure, lift, SWAPS, D2R, mul, translate, rotateAbout, scaleAbout, apply, IDENTITY };
