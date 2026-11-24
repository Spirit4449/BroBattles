#!/usr/bin/env node
// Ozzy run: 8 frames at 18 fps, the legacy run (legacy/, running00-07) frame
// for frame. Each frame's feet, staff hand, free hand and body height were
// read off the legacy art on the art grid (grid.cjs) and the limbs are solved
// onto them, so the whole body moves as the original does: a bounding stride
// with the lead knee driving up and the back leg stretched far behind, the
// staff held out ahead on a straight arm and bobbing with the body, the free
// hand pumping from his hip up to reach ahead at chest height. The head stays
// level and looks ahead; the torso leans into the run.
//   node scripts/art/ozzy-pixel/run.cjs   -> output/ozzy-pixel/rig/run/
const { figure, render, writePreview, translate, reach, JOINTS } = require('./pose.cjs');

const FPS = 18;
// Per legacy frame (art px): lead ankle, trailing ankle (with toe angle when
// off the ground), staff hand, free hand, and how high the body rides.
const LEGACY = [
  { front: [32, 61], back: [17, 56], backToe: 50, staff: [41, 28], free: [41, 43], up: 0 }, // lead foot down, back heel kicked up
  { front: [33, 54], back: [7, 58], backToe: 20, staff: [42, 24], free: [43, 39], up: 2 }, // airborne: knee up, back leg stretched out
  { front: [38, 61], back: [9, 57], backToe: 25, staff: [45, 27], free: [47, 34], up: 2 }, // lead foot lands ahead, free hand reaches
  { front: [36, 61], back: [11, 56], backToe: 35, staff: [44, 28], free: [45, 38], up: 1 }, // weight on it, back leg coming through
  { front: [32, 61], back: [16, 56], backToe: 50, staff: [42, 28], free: [41, 43], up: 0 },
  { front: [34, 54], back: [7, 59], backToe: 20, staff: [41, 23], free: [43, 39], up: 2 },
  { front: [42, 59], back: [8, 57], backToe: 25, staff: [42, 25], free: [47, 34], up: 2 }, // lead heel reaching ahead
  { front: [39, 61], back: [10, 56], backToe: 35, staff: [42, 26], free: [44, 39], up: 1 },
];
const SHIFT = -5; // px the figure sits back so its hips land on the legacy hips
const LEAN = 24;
// The body rides this much higher than standing, so the planted leg straightens
// into a tall stride instead of a crouch (the action legs are longer than the
// rest pose's).
const LIFT = 3;

function runPose(i) {
  const f = LEGACY[i];
  const up = f.up + LIFT;
  const local = ([x, y]) => [x - SHIFT, y + up];
  const planted = (p) => p[1] >= 60.5;
  const [thigh] = reach([JOINTS.hip[0] - 2, JOINTS.hip[1]], local(f.back));
  return figure({
    root: translate(SHIFT, -up),
    lean: LEAN, head: 16, headShift: [1, 0],
    arms: {
      near: { hand: f.staff, shoulder: [31, 33] },
      far: { hand: f.free, shoulder: [33, 34] },
    },
    staffIn: 'near', staffAt: 33,
    book: 'satchel',
    // As in the legacy run the near (bright) leg is the trailing one, stretched
    // out behind in front of everything; the far leg leads.
    legs: {
      back: { ankle: local(f.front), foot: planted(f.front) ? 0 : 15 },
      front: { ankle: local(f.back), foot: planted(f.back) ? 0 : f.backToe },
      backHip: [1, 0], frontHip: [-2, 0],
    },
    // Short coat panels so both legs read: the back one trails, the front one
    // follows the trailing thigh.
    coat: { back: -10 + 3 * f.up, front: Math.max(-10, Math.min(35, thigh * 0.4)), backScale: 0.75, frontScale: 0.7 },
  });
}

const FRAMES = LEGACY.map((_, i) => render(runPose(i), { patch: false }));

if (require.main === module) writePreview('run', FRAMES, FPS).catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, runPose };
