#!/usr/bin/env node
// Draven attack: 8 frames at 16 fps, one flowing sweep. He swings the staff in
// a single arc from low behind him, up over his head and down ahead, and the
// smoke on its head drags a trail through the whole swing. The trail thickens
// and flings outward as the staff comes over, its leading end becomes the
// ghost's face, and it carries on past the staff into a fan of strands that
// sweeps through the splash hitbox (~80 art px ahead, ~75 tall) and breaks up.
//   0    wind-up: staff low behind him, the ball burning at his back
//   1-2  the staff rises behind him and over his head, the trail starting
//   3    the staff comes over and forward, the trail arcing over his head with
//        the red eyes at its leading end
//   4    the staff drives down ahead, the trail flung far out in front and down
//   5-6  the trail carries on into a fan of strands, then breaks into dashes
//   7    he holds the follow-through, staff pointed down ahead, only the ball
//        left on it
//   node scripts/art/draven-pixel/attack.cjs   -> output/draven-pixel/rig/attack/
const { figure, writePreview, SWAPS } = require('./pose.cjs');
const { drawFrame, flame, trail, sweep } = require('./smoke.cjs');

const FPS = 16;

// The swing, frame by frame: staff angle on screen, arm, lean and the back arm
// counter-swinging.
const SWING = [
  { staffAt: -100, frontArm: 30, lean: 12, backArm: -14, slide: 13 },
  { staffAt: -62, frontArm: -10, lean: 6, backArm: 0, slide: 10 },
  { staffAt: -14, frontArm: -58, lean: 2, backArm: 18, slide: 8 },
  { staffAt: 36, frontArm: -56, lean: 16, backArm: 32, slide: 6 },
  { staffAt: 104, frontArm: -10, lean: 30, backArm: 44, slide: 6 },
  { staffAt: 128, frontArm: 6, lean: 34, backArm: 46, slide: 6 },
  { staffAt: 132, frontArm: 8, lean: 34, backArm: 44, slide: 6 },
  { staffAt: 118, frontArm: 0, lean: 30, backArm: 36, slide: 6 },
];
const pose = (i) => {
  const { lean, ...rest } = SWING[i];
  return figure({
    ...rest, lean, hood: lean * 0.55, backHand: 10,
    robe: { shift: -lean * 0.15, spread: 1.05 + lean * 0.004, swing: -lean * 0.06 },
    swap: i === 3 || i === 4 ? SWAPS.flare : i === 2 ? SWAPS.hot : undefined,
    crystal: [0, 0], shardLeft: [-1, 0], shardRight: [1, 0],
  });
};
// Angle of the staff head about the shoulders, degrees from straight up.
const angleOf = (P) => (Math.atan2(P.head[0] - P.neck[0], -(P.head[1] - P.neck[1])) * 180) / Math.PI;
const ball = (t, size = 1.45) => (L, P) => {
  const a = (angleOf(P) * Math.PI) / 180;
  // The flame streams back against the swing.
  flame(L, P.head, { dir: [-Math.cos(a), -Math.sin(a)], t, size, wisps: 2 });
};
const swingTrail = (from, r1, width, eyes) => (L, P) => {
  const a = angleOf(P); const r = Math.hypot(P.head[0] - P.neck[0], P.head[1] - P.neck[1]);
  trail(L, P.neck, r, r1 || r, from, a, width, { eyes });
};

const FRAMES = [
  drawFrame(pose(0), { behind: ball(0) }),
  drawFrame(pose(1), { behind: (L, P) => { swingTrail(-150, 0, 2)(L, P); ball(0.2)(L, P); } }),
  drawFrame(pose(2), { behind: (L, P) => { swingTrail(-140, 0, 4)(L, P); ball(0.4)(L, P); } }),
  drawFrame(pose(3), {
    behind: ball(0.6, 1.5),
    front: (L, P) => { const a = angleOf(P); const r = Math.hypot(P.head[0] - P.neck[0], P.head[1] - P.neck[1]); trail(L, P.neck, r - 4, r + 28, -110, a + 40, 8, { eyes: true }); },
  }),
  drawFrame(pose(4), {
    behind: ball(0.8, 1.5),
    front: (L, P) => trail(L, P.neck, 26, 72, -50, 148, 11, { eyes: true }),
  }),
  drawFrame(pose(5), {
    behind: ball(0, 1.4),
    front: (L, P) => sweep(L, [P.neck[0] + 6, P.neck[1] + 6], 42, 26, 0, { a0: 5, a1: 180 }),
  }),
  drawFrame(pose(6), {
    behind: ball(0.2, 1.4),
    front: (L, P) => sweep(L, [P.neck[0] + 6, P.neck[1] + 6], 46, 26, 1, { a0: 5, a1: 180 }),
  }),
  drawFrame(pose(7), { behind: ball(0.4, 1.35) }),
];

if (require.main === module) writePreview('attack', FRAMES, FPS, { scale: 4 }).catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES };
