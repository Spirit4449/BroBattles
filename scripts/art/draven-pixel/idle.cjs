#!/usr/bin/env node
// Draven idle: 8 frames at 6 fps. He bobs gently as one piece, body, arms,
// hood, staff and all, rising two pixels and settling while the robe's hem
// stays on the ground; the hood and the floating crystal follow a frame late.
// Every move is a whole pixel, so nothing is resampled. The flame on the staff
// head churns: its top bulges side to side and puffs of smoke break off and
// drift up.
//   node scripts/art/draven-pixel/idle.cjs   -> output/draven-pixel/rig/idle/
const { JOINTS, writePreview, translate, apply, IDENTITY } = require('./pose.cjs');
const { drawFrame, flame } = require('./smoke.cjs');

const FPS = 6;
const FRAME_COUNT = 8;
// The bob, in px up: a smooth rise and fall over the loop.
const BOB = [0, 1, 2, 2, 2, 1, 0, 0];
const lift = (i) => BOB[(FRAME_COUNT + i) % FRAME_COUNT];

function idlePose(frame) {
  const up = lift(frame);
  const body = translate(0, -up);
  const late = translate(0, -lift(frame - 1));
  // The robe's top rows ride up with him; below, it stretches to the hem,
  // which stays on the ground.
  const top = JOINTS.hemTop; const span = JOINTS.ground - top;
  const robe = (x, y) => [x, y < top - up ? y + up : top + Math.round(((y - top + up) * span) / (span + up))];
  return {
    $: { head: apply(body, JOINTS.staffHead), grip: apply(body, JOINTS.grip), neck: apply(body, JOINTS.neck), waist: JOINTS.waist },
    robe: { warp: robe },
    torso: { m: body },
    hood: { m: late },
    backArm: { m: body },
    backHand: { m: body },
    staff: { m: body },
    frontArm: { m: body },
    grip: { m: body },
    magic: { m: body },
    crystal: { m: late },
    shardLeft: { m: translate(0, -lift(frame - 2)) },
    shardRight: { m: translate(0, -lift(frame - 3)) },
  };
}

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => drawFrame(idlePose(i), {
  patch: true,
  behind: (L, P) => flame(L, [P.head[0] - 1, P.head[1] - 2], { dir: [0, -1], t: i / FRAME_COUNT, size: 1.3, wisps: 3, lively: 1 }),
}));

if (require.main === module) writePreview('idle', FRAMES, FPS).catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, idlePose };
