#!/usr/bin/env node
// Ozzy attack: 7 frames timed to the cast (shared/characters/ozzyCharge.js
// ozzyThrowFrameMs): five wind-up frames fill the cast delay, the blast shows
// at the release and the follow-through ends as the turn lock lifts. After
// the legacy attack: feet planted, he sinks into a stance with
// the staff held across him, its crystal ahead and high, winding the free hand
// back past his face (violet sparks at the crystal), then leans in and drives
// the palm forward: a white orb gathers in it, bursts into a white blast, and the
// spent magic curls away as violet smoke while he rises back up. Effects are painted by fx.cjs on a
// 128px canvas so the blast fits ahead of him.
//   node scripts/art/ozzy-pixel/attack.cjs   -> output/ozzy-pixel/rig/attack/
const { figure, writePreview, translate } = require('./pose.cjs');
const { drawFrame, orb, wisp, sparks, blast, smoke } = require('./fx.cjs');

const FPS = 18;
const SIZE = 128;
// Per frame (art px): the free (casting) hand, the upper body's lean, and
// how far the body has sunk into the stance (sink 0 = standing tall, 1 = full
// crouch). He sinks down over the wind-up, casts from the stance and rises
// back up at the end; the feet stay planted the whole time.
const BEATS = [
  { far: [47, 27], lean: 5, sink: 0.4 },
  { far: [44, 24], lean: 3, sink: 0.8 }, // winds back as he sinks
  { far: [42, 23], lean: 3, sink: 1 },
  { far: [55, 27], lean: 12, sink: 1 }, // leans into the push, orb gathering
  { far: [58, 27], lean: 15, sink: 1 }, // orb full
  { far: [58, 27], lean: 15, sink: 1 }, // the release: the blast
  { far: [54, 29], lean: 9, sink: 0.4 }, // rising back up through the smoke
];
const SINK = [3, 3]; // px forward and down at the full crouch
const FEET = { front: [45, 61], back: [26, 61] }; // planted ankles (rest-art px)

function attackPose(i) {
  const b = BEATS[i];
  const dx = Math.round(SINK[0] * b.sink); const dy = Math.round(SINK[1] * b.sink);
  const local = ([x, y]) => [x - dx, y - dy];
  return figure({
    root: translate(dx, dy), lean: b.lean, head: Math.round(b.lean * 0.4),
    arms: { near: { hand: [40 + dx, 37 + dy], shoulder: [29, 33] }, far: { hand: [b.far[0], b.far[1] + dy], shoulder: [34, 33], bend: -1 } },
    staffAt: 34 + (b.lean - 6) * 0.5, slide: 9, book: 'satchel', satchelAt: [-6, 0],
    legs: { front: { ankle: local(FEET.front) }, back: { ankle: local(FEET.back) }, backHip: [-3, 0] },
    coat: { back: 18 - b.lean * 0.3, front: -6 - 4 * b.sink },
    swap: i >= 3 && i <= 5 ? { X: 'd' } : undefined,
  });
}

const glow = (t, size = 1) => (L, P) => wisp(L, [P.head[0], P.head[1] - 2], t, size * 0.75);
const FX = [
  { front: glow(0, 0.9) },
  { front: (L, P) => { glow(0.25, 1)(L, P); sparks(L, [P.palm[0] + 4, P.palm[1] + 3], 6, 4, 2); } },
  { front: (L, P) => { glow(0.5, 1.1)(L, P); sparks(L, [P.palm[0] + 2, P.palm[1]], 5, 3, 7, ['w', 'l']); } },
  { front: (L, P) => { glow(0.75, 1)(L, P); orb(L, [P.palm[0] + 5, P.palm[1] - 1], 3.5, 0, { swirl: false }); } },
  { front: (L, P) => { glow(0, 1)(L, P); orb(L, [P.palm[0] + 8, P.palm[1] - 1], 6.5, 0.2, { swirl: false }); } },
  { front: (L, P) => { glow(0.3, 1)(L, P); blast(L, [P.palm[0] + 2, P.palm[1] - 1], 26, 7, 4); } },
  { front: (L, P) => { glow(0.6, 0.8)(L, P); smoke(L, [P.palm[0] + 16, P.palm[1] - 2], 0.3, 11, 3); } },
];

const FRAMES = BEATS.map((_, i) => drawFrame(attackPose(i), { size: SIZE, ...FX[i] }));

if (require.main === module) writePreview('attack', FRAMES, FPS).catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES, SIZE, attackPose };
