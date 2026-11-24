#!/usr/bin/env node
// Draven run: 8 frames at 18 fps. He walks briskly like a sorcerer: the hem
// stays flat on the ground and only the body above it bobs, a single pixel
// on each step, carrying the hood, arms, staff and flame with it. The upper
// body rocks slightly, the staff sways ahead of him, the back arm swings and
// the robe sways at the hem. The flame streams back off the staff head and
// curls up behind him, puffs of smoke breaking off and drifting away.
//   node scripts/art/draven-pixel/run.cjs   -> output/draven-pixel/rig/run/
const { figure, lift, writePreview } = require('./pose.cjs');
const { drawFrame, flame } = require('./smoke.cjs');

const FPS = 18;
const FRAME_COUNT = 8;
const LEAN = 10; // degrees the upper body leans into the glide

// Whole-pixel lift above the hem per frame, once on each step.
const BOB = [0, 1, 1, 0, 0, 1, 1, 0];

function runPose(i) {
  const t = i / FRAME_COUNT;
  const stride = Math.sin(2 * Math.PI * t);
  const step = Math.sin(4 * Math.PI * t);
  return lift(figure({
    lean: LEAN + 1.5 * step, hood: 4 - 1.5 * step,
    backArm: -20 + 12 * stride, backHand: -8 + 5 * stride,
    frontArm: 16 - 3 * stride, staffAt: 14 + 5 * stride, slide: 3,
    robe: { spread: 1.08, swing: -1 + 1.5 * stride, wave: (d) => d * d * 0.8 * Math.sin(2 * Math.PI * (t * 2 - d)) },
    crystal: [-1, BOB[(i + 7) % 8] - BOB[i]], shardLeft: [-2, 1 + BOB[(i + 6) % 8] - BOB[i]], shardRight: [-2, 1 + BOB[(i + 7) % 8] - BOB[i]],
  }), BOB[i]);
}

const FRAMES = Array.from({ length: FRAME_COUNT }, (_, i) => drawFrame(runPose(i), {
  behind: (L, P) => flame(L, P.head, { dir: [-1, -0.5], t: i / FRAME_COUNT, size: 1.15, wisps: 3, reach: 1.6, curl: 1 }),
}));

if (require.main === module) writePreview('run', FRAMES, FPS, { scale: 4 }).catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, runPose };
