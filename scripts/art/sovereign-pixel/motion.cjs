// Landmark order: head, shoulder, hip, lead hand, lead boot, trailing boot, cape hem.
// Positions were marked on the corresponding Sovereign key drawings.
const { rigFor, inBetween, pitched, stamp } = require('./rig.cjs');
const { rotateAbout, apply } = require('../pixel-rig/rig.cjs');

const { runFrames } = require('./run.cjs');

function anchors(prefix, frames) {
  return frames.map((points, i) => ({ name: prefix + String(i).padStart(2, '0'), points }));
}

const idle = anchors('idle', [
  [[42, 28], [34, 38], [41, 53], [54, 51], [49, 65], [30, 65], [17, 59]],
  [[43, 27], [34, 38], [42, 53], [54, 51], [49, 65], [30, 65], [19, 61]],
  [[43, 27], [34, 38], [42, 53], [54, 52], [49, 65], [30, 65], [19, 61]],
  [[43, 28], [34, 39], [42, 54], [55, 51], [49, 65], [30, 65], [19, 60]],
  [[43, 28], [34, 38], [42, 54], [54, 51], [49, 65], [30, 65], [19, 60]],
]);
const ascent = anchors('jumping', [
  [[46, 29], [38, 41], [40, 53], [55, 45], [39, 64], [34, 60], [14, 52]],
  [[46, 28], [37, 40], [39, 51], [61, 43], [29, 64], [37, 55], [11, 48]],
  [[49, 37], [35, 43], [40, 54], [47, 57], [27, 64], [36, 59], [13, 45]],
  [[47, 39], [38, 46], [38, 54], [47, 56], [44, 61], [34, 61], [18, 61]],
]);
const air = anchors('falling', [
  [[42, 30], [32, 43], [40, 53], [57, 42], [44, 64], [33, 62], [16, 28]],
  [[42, 30], [32, 43], [40, 53], [57, 42], [44, 64], [33, 62], [16, 27]],
  [[42, 30], [32, 43], [40, 53], [57, 42], [44, 64], [33, 62], [16, 25]],
  [[42, 30], [32, 43], [40, 53], [57, 42], [44, 64], [33, 62], [16, 29]],
]);
const recovery = { name: 'jumping08', points: [[53, 43], [40, 46], [39, 56],
  [58, 64], [57, 66], [21, 65], [11, 51]] };

const level = { key: '', prefix: 'throw', angle: 0 };
const AIMS = [
  { key: 'high', prefix: 'throwHigh', angle: -62 },
  { key: 'up', prefix: 'throwUp', angle: -32 },
  level,
  { key: 'down', prefix: 'throwDown', angle: 30 },
  { key: 'low', prefix: 'throwLow', angle: 57 },
];

const ARM_ROOT = [45, 43];
const RELEASE = [64, 35];
// The mask follows the inner seam of the outstretched sleeve. Hand and cuff
// rotate with it, while the head, chest chain, legs and cape stay on their keys.
const throwingArm = (x, y) => (x >= 48 && y < 46 && x + y >= 87) ? 'front' : 'body';
function armAngle(angle) {
  return rotateAbout(ARM_ROOT, angle);
}

function throwFrame(name, angle) {
  if (name === 'throw01' && angle) {
    return rigFor(name, throwingArm).renderPose({ front: { m: armAngle(angle) } }, { patch: false });
  }
  return rigFor(name, name === 'throw01' ? throwingArm : undefined).compose();
}

function cycle(keys, steps) {
  return keys.flatMap((key, i) => Array.from({ length: steps }, (_, j) =>
    inBetween(key, keys[(i + 1) % keys.length], j / steps)));
}

function strip(keys, steps) {
  return keys.flatMap((key, i) => i === keys.length - 1 ? [rigFor(key.name).compose()] :
    Array.from({ length: steps }, (_, j) => inBetween(key, keys[i + 1], j / steps)));
}

function jumpFrames() {
  const launch = rigFor(ascent[0].name).compose();
  const tuck = rigFor(ascent[3].name).compose();
  const fall = rigFor(air[0].name).compose();
  // Hold the push-off and the tuck. The middle of the roll moves in larger
  // steps, then the knees open and the animation hands off to the fall.
  return [launch, launch, rigFor(ascent[1].name).compose(), rigFor(ascent[2].name).compose(),
    tuck, tuck,
    ...[32, 87, 151, 218, 271, 306].map(deg =>
      pitched('jumping03', [40, 46], deg, [0, -3 * Math.sin(Math.PI * deg / 306)])),
    pitched('jumping00', [42, 48], -22, [0, -3]), fall, fall];
}

function duckFrame() {
  // Keep a slightly wider crouching crown while tightening its silhouette
  // around the band. The shoulders and gold boots remain at their old anchors.
  const crown = (x, y) => y < 49 + (x > 41 ? 1 : 0) ? 'front' : 'body';
  return rigFor('duck00', crown).renderPose({ front: { warp: (x, y) => [
    40 + (x - 40) / 0.91, y,
  ] } }, { patch: false });
}

function wallFrame() {
  const raisedArm = (x, y) => (x < 25 && y < 37) || (x < 23 && y < 42) ? 'back' : 'body';
  const body = rigFor('wall00', raisedArm).compose({ back: { hidden: true } });
  return stamp(body, 'wallPalm');
}

const clips = [];
function add(key, prefix, frames, duration, repeat = 0) {
  clips.push({ key, prefix, frames, frameRate: frames.length * 1000 / duration, repeat });
}

add('idle', 'idle', cycle(idle, 3), 1600, -1);
add('running', 'running', runFrames(), 400, -1);
add('jumping', 'jumping', jumpFrames(), 450);
add('falling', 'falling', cycle(air, 3), 900, -1);
add('landing', 'landing', strip([recovery, idle[0]], 4), 150);
add('sliding', 'wall', [wallFrame()], 150, -1);
add('ducking', 'duck', [duckFrame()], 150, -1);
add('dying', 'dying', ['dying00', 'dying01', 'dying02', 'dying03', 'dying04'].map(name => rigFor(name).compose()), 500);

const dashTotal = require('../../../src/shared/physics/movementPhysics.json').dashDurationMs;
const DASHES = [
  ['dashing', 'dash', 0], ['dashright', 'dashRight', 0], ['dashdiagonal', 'dashDiagonal', -39],
  ['dashup', 'dashUp', -70], ['dashdowndiagonal', 'dashDownDiagonal', 38], ['dashdown', 'dashDown', 67],
];
for (const [key, prefix, angle] of DASHES) {
  const frames = [
    pitched('jumping00', [40, 53], angle * 0.75, [-1, -2]),
    pitched('jumping02', [40, 51], angle, [1, -3]),
    pitched('running04', [43, 52], angle + 9, [1, -2]),
    pitched('running04', [43, 52], angle + 12, [0, -2]),
  ];
  add(key, prefix, frames, dashTotal);
}

const throwFrameMs = 67;
const throwSettings = { releaseMs: throwFrameMs, blendMs: 90, startScale: 0.5, hands: {} };
const { stats: { spriteScale } } = require('../../../src/shared/characters/ninja.json');
for (const { key, prefix, angle } of AIMS) {
  const clip = key ? 'throw-' + key : 'throw';
  const frames = ['throw00', 'throw01', 'throw02', 'throw03'].map(name => throwFrame(name, angle));
  // Release is the second frame. Convert fingertips from the original
  // 72px skin cell into world units from the sprite's centered origin.
  const hand = apply(armAngle(angle), RELEASE);
  throwSettings.hands[key || 'level'] = hand.map(v => Number(((v - 36) * spriteScale).toFixed(2)));
  add(clip, prefix, frames, throwFrameMs * frames.length);

  // A measured flurry in the same direction. Between releases he pulls
  // his hand back, then he resets to the crowned guard at the end.
  const flurry = [frames[0], frames[0]];
  for (let i = 0; i < 4; i++) {
    flurry.push(throwFrame('throw01', angle + (i % 2 ? -4 : 0)),
      throwFrame('throw01', angle + (i % 2 ? 5 : 9)), frames[3]);
  }
  flurry.push(frames[3], rigFor('idle00').compose());
  const specialKey = key ? 'special-' + key : 'special';
  add(specialKey, prefix.replace('throw', 'special'), flurry, 720);
}

module.exports = { clips, throwSettings };
