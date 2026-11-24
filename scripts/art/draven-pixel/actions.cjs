#!/usr/bin/env node
// Draven's action animations, posed after the legacy atlas
// (scripts/art/draven-pixel/legacy/) on the shared skeleton (pose.cjs `figure`),
// with the staff's smoke flame and effects painted by smoke.cjs. Rates are the
// ones characters/draven/anim.js plays them at.
//   jump (2): timed frames, the hem hanging free and rounded.
//   fall (4, looping slowly): the hem flutters and the hand and staff bob with it.
//   sliding (2): the wall slide: compact, robe gathered, staff over his
//     shoulder, flame blown up and back.
//   hit (hit00, hit01, hit03): he bows under the blow and straightens, the
//     flame whipping one way then the other.
//   special (8, looping during Inferno): floating with the staff raised
//     overhead, robe rippling, flame tall and the crystal and shards circling.
//   dying (7): the magic bursts into red and white shards, the staff falls
//     forward to the ground, and he topples flat onto his face.
//   duck (duck00): a deep crouch with the whole staff laid on the ground.
//   dashright / dashdiagonal / dashup / dashdowndiagonal / dashdown (3 each,
//     over the 160 ms dash; left is the same art flipped): stretched
//     along the dash with the robe and flame streaming behind and speed lines.
//   node scripts/art/draven-pixel/actions.cjs [name...]   -> output/draven-pixel/rig/<name>/
const { figure, writePreview, SWAPS, JOINTS, mul, translate, rotateAbout, scaleAbout } = require('./pose.cjs');
const { drawFrame, flame, burst, specks, speedLines } = require('./smoke.cjs');

const behindFlame = (opts) => ({ behind: (L, P) => flame(L, P.head, opts) });

// Jump and fall are two timed frames each, after the legacy atlas; the hem
// hangs free in the air, rounded and trailing, instead of standing flat.
// The hand holds the staff at the same spot as in the idle (no slide). The
// hood is never rotated (only carried), so the face stays crisp; the
// flame licks up and back, clear of the hood.
const jump = [0, 1].map((i) => drawFrame(figure({
  lean: 4 - 2 * i, hood: 0,
  backArm: 50 + 15 * i, backHand: 0, frontArm: -12 - 6 * i, staffAt: 6 - 6 * i,
  robe: { len: 0.92 - 0.04 * i, spread: 1.04 + 0.08 * i, curve: 0.22 + 0.12 * i },
  crystal: [0, 1 + i], shardLeft: [-1, 2 + i], shardRight: [-1, 2 + i],
}), { behind: (L, P) => flame(L, P.head, { dir: [-0.35, -1], t: i * 0.5, size: 1.1, wisps: 2, reach: 1.1 + 0.2 * i }) }));
// The fall loops slowly: the hem flutters, its sides lifting and settling a
// pixel, and both hands, the staff and the flame rise and settle with it.
const FALL_WAVE = [0, 1, 0, -1];
const HELD = ['backArm', 'backHand', 'frontArm', 'grip', 'staff', 'magic', 'crystal', 'shardLeft', 'shardRight'];
const fall = FALL_WAVE.map((w, i) => {
  const pose = figure({
    lean: 8, hood: 0,
    backArm: 90, backHand: 0, frontArm: -38, staffAt: 8,
    robe: { len: 0.83, spread: 1.3, shift: -2, curve: 0.6 + 0.07 * w, tilt: -0.25, wave: (d) => w * 0.8 * d * d },
    crystal: [0, -1], shardLeft: [-1, -2], shardRight: [1, -2],
  });
  for (const part of HELD) if (pose[part].m) pose[part] = { ...pose[part], m: mul(translate(0, -w), pose[part].m) };
  pose.$ = { ...pose.$, head: [pose.$.head[0], pose.$.head[1] - w], grip: [pose.$.grip[0], pose.$.grip[1] - w] };
  return drawFrame(pose, { behind: (L, P) => flame(L, P.head, { dir: [0, -1], t: i / FALL_WAVE.length, size: 1.1, wisps: 2, reach: 1.3 }) });
});
const air = {
  jump,
  fall,
  sliding: [0, 1].map((i) => drawFrame(figure({
    lean: -4, hood: -6,
    backArm: 20 + 4 * i, backHand: 10, frontArm: -60, staffAt: -66, slide: 12,
    robe: { len: 0.9, spread: 1.04, shift: -1, curve: 0.2 },
    crystal: [-2, -2], shardLeft: [-3, -3], shardRight: [-2, -4 + i],
  }), behindFlame({ dir: [-0.75, -0.65], t: i * 0.5, size: 1.05, wisps: 2 }))),
};

// hit03 is the third frame (there is no hit02 in the atlas).
const hitFrame = (lean, hood, dx, dir, t) => drawFrame(figure({
  root: translate(dx, 0), lean, hood, backArm: 10, backHand: 8, frontArm: 2, staffAt: -4 - dx,
  swap: lean > 4 ? SWAPS.hot : undefined, robe: { shift: -dx },
}), behindFlame({ dir, t, size: 1.15, wisps: 1 }));
const hit = [hitFrame(8, 14, -1, [0.9, -0.6], 0.1), hitFrame(-3, -2, 0, [-0.8, -0.7], 0.45), null, hitFrame(0, 2, 0, [-0.35, -1], 0.75)];

// ---------- special ----------
// Inferno (looping while the game lifts him into the air): he floats with the
// staff raised high overhead, the robe hanging free and rippling, the flame
// burning tall on the staff head, and the crystal and shards circling it. The
// game supplies the lift and the bob, so the art only drifts a pixel.
const SPECIAL_FRAMES = 8;
const special = Array.from({ length: SPECIAL_FRAMES }, (_, i) => {
  const t = i / SPECIAL_FRAMES;
  const s = (lag) => Math.sin(2 * Math.PI * (t - lag));
  const c = (lag) => Math.cos(2 * Math.PI * (t - lag));
  const orbit = (r, lag) => [Math.round(r * c(lag)), Math.round(r * 0.6 * s(lag))];
  return drawFrame(figure({
    root: translate(0, Math.round(-s(0))), lean: -5, hood: -7,
    backArm: 98, backHand: 20, frontArm: -68, staff: 56, slide: 4,
    robe: { len: 0.88, spread: 1.16, curve: 0.5, wave: (d) => d * d * 1.2 * Math.sin(2 * Math.PI * (t - d * 0.8)) },
    swap: i % 2 ? SWAPS.flare : SWAPS.hot, glow: i % 4 === 1 ? { M: 'b', E: 'O' } : undefined,
    magic: [0, 0], crystal: orbit(2, 0), shardLeft: orbit(4, 0.33), shardRight: orbit(4, 0.66),
  }), { behind: (L, P) => flame(L, P.head, { dir: [0, -1], t, size: 1.45, wisps: 3 }) });
});

// ---------- dying ----------
const FRONT_EDGE = [36, 63]; // he topples over the front of his hem
// Tip the whole body forward over the hem by `deg`, squashing it flat as it lands.
const topple = (deg, flat, drop) => mul(translate(0, drop), mul(scaleAbout(FRONT_EDGE, 1, flat), rotateAbout(FRONT_EDGE, deg)));
const gone = { magic: null, crystal: null, shardLeft: null, shardRight: null, swap: SWAPS.dark };
const dyingPose = (extra) => figure({ backArm: 6, frontArm: 4, ...extra });
// The dropped staff lies level on the ground, `dx` px forward of where it fell.
function onGround(extra, dx) {
  const level = dyingPose({ ...extra, staffAt: 90 });
  return dyingPose({ ...extra, staffAt: 90, staffShift: [dx, JOINTS.ground - 1.5 - level.$.grip[1]] });
}
const dying = [
  drawFrame(dyingPose({ lean: -4, hood: -6, staffAt: -2, ...gone, swap: SWAPS.flare }), { front: (L, P) => burst(L, P.head, 0) }),
  drawFrame(dyingPose({ lean: -2, hood: -4, staffAt: 2, ...gone }), { front: (L, P) => burst(L, P.head, 1) }),
  drawFrame(dyingPose({ lean: 4, hood: 10, frontArm: 20, staffAt: 34, staffShift: [4, 3], ...gone, robe: { len: 0.95 } }), {
    front: (L, P) => specks(L, [P.head[0] - 10, P.head[1] - 12], 9, 26, 16, 21),
  }),
  drawFrame(onGround({ lean: 6, hood: 14, frontArm: 30, ...gone, robe: { len: 0.9, spread: 1.08 } }, 14), {
    front: (L, P) => specks(L, [P.neck[0] - 4, P.neck[1] - 34], 7, 24, 14, 22),
  }),
  drawFrame(onGround({ root: topple(32, 1, 0), lean: 4, hood: 10, frontArm: 30, ...gone }, 10), {
    front: (L, P) => specks(L, [P.neck[0] - 6, P.neck[1] - 30], 5, 20, 10, 23),
  }),
  drawFrame(onGround({ root: topple(68, 0.8, 0), lean: 4, hood: 6, frontArm: 20, ...gone }, 6), {
    front: (L, P) => specks(L, [P.neck[0], P.neck[1] - 26], 3, 16, 8, 24),
  }),
  drawFrame(onGround({ root: topple(88, 0.55, 0), lean: 2, hood: 4, frontArm: 10, ...gone }, 4)),
];

// ---------- duck ----------
// A deep crouch: he sinks right down onto his knees, the robe pooling round
// him, hunched far forward with the whole staff laid down along the ground in
// front of him, his hand resting on it.
const DUCK_DROP = 14;
function duckPose(staffShift = [0, 0]) {
  return figure({
    root: translate(0, DUCK_DROP), lean: 30, hood: 16,
    backArm: -4, backHand: 8, frontArm: 60, staffAt: 90, staffShift,
    robe: { len: (JOINTS.ground - JOINTS.hemTop - DUCK_DROP) / (JOINTS.ground - JOINTS.hemTop), spread: 1.45 },
    crystal: [0, 0], shardLeft: [-1, 1], shardRight: [0, 1],
  });
}
// Lay the staff level on the ground: drop it until its shaft rests on the
// bottom row.
const duckLevel = duckPose();
const duck = [drawFrame(duckPose([4, JOINTS.ground - 1.5 - duckLevel.$.grip[1]]),
  behindFlame({ dir: [0.3, -1], t: 0.3, size: 0.95, wisps: 2 }))];

// ---------- dashes ----------
// Three frames over the dash: launch, full stretch, ease. `dir` is the dash
// direction on screen; the robe, flame and speed lines stream the other way.
function dashSet({ root, lean, hood, frontArm, staffAt, backArm, robe, dir, slide = 0 }) {
  return [0.7, 1, 0.85].map((k, i) => drawFrame(figure({
    root: root(k), slide, lean: lean * k, hood: hood * k, frontArm: frontArm * k, staffAt: staffAt * k,
    backArm: backArm * k, backHand: 20 * k, robe: robe(k), swap: i === 1 ? SWAPS.flare : SWAPS.hot,
    glow: i === 1 ? { M: 'b', E: 'O' } : undefined,
    crystal: [-dir[0] * 3 * k, -dir[1] * 3 * k], shardLeft: [-dir[0] * 5 * k, -dir[1] * 5 * k], shardRight: [-dir[0] * 4 * k, -dir[1] * 4 * k + 1],
  }), {
    behind: (L, P) => {
      flame(L, P.head, { dir: [-dir[0], -dir[1] - 0.2], t: i / 3, size: 1, wisps: 2, reach: 1 + 0.4 * k });
      speedLines(L, [P.waist[0] - dir[0] * 10, P.waist[1] - dir[1] * 10 - 6], dir, 3, 10 + 10 * k, 7);
    },
  }));
}
const dashes = {
  dashright: dashSet({
    root: (k) => translate(2 * k, -2 * k), lean: 42, hood: 24, frontArm: 30, staffAt: -84, backArm: 70, slide: 12,
    robe: (k) => ({ len: 1 - 0.12 * k, spread: 1 + 0.15 * k, shift: -10 * k, wave: (d) => -3 * d * k }), dir: [1, 0],
  }),
  dashdiagonal: dashSet({
    root: (k) => translate(2 * k, -3 * k), lean: 26, hood: 14, frontArm: -30, staffAt: 48, backArm: 95,
    robe: (k) => ({ len: 1 - 0.05 * k, spread: 1 - 0.12 * k, shift: -7 * k }), dir: [0.7, -0.7],
  }),
  dashup: dashSet({
    root: (k) => translate(0, -3 * k), lean: 2, hood: -4, frontArm: -70, staffAt: 4, backArm: 140,
    robe: (k) => ({ len: 1 + 0.08 * k, spread: 1 - 0.25 * k, shift: -2 * k, wave: (d) => Math.sin(d * 6) * k }), dir: [0, -1],
  }),
  // Diving forward and down: pitched over, staff driven ahead and down, the
  // robe and flame streaming up behind.
  dashdowndiagonal: dashSet({
    root: (k) => translate(2 * k, 2 * k), lean: 50, hood: 26, frontArm: 20, staffAt: 130, backArm: 120, slide: 6,
    robe: (k) => ({ len: 1 - 0.18 * k, spread: 1 - 0.1 * k, shift: -9 * k, curve: 0.4 * k, wave: (d) => -2 * d * k }), dir: [0.7, 0.7],
  }),
  // Straight down: upright and plunging, staff pointed down beneath him, the
  // robe flaring up round him.
  dashdown: dashSet({
    root: (k) => translate(0, 3 * k), lean: 4, hood: 8, frontArm: 30, staffAt: 172, backArm: 105, slide: 4,
    robe: (k) => ({ len: 1 - 0.22 * k, spread: 1 + 0.4 * k, curve: 0.9 * k }), dir: [0, 1],
  }),
};

const FRAMES = { ...air, hit, special, dying, duck, ...dashes };
const FPS = { jump: 15, fall: 5, sliding: 6, hit: 12, special: 12, dying: 10, duck: 1, dashright: 18.75, dashdiagonal: 18.75, dashup: 18.75, dashdowndiagonal: 18.75, dashdown: 18.75 };

async function main() {
  const only = process.argv.slice(2);
  for (const [name, frames] of Object.entries(FRAMES)) {
    if (only.length && !only.includes(name)) continue;
    await writePreview(name, frames.filter(Boolean), FPS[name], { scale: 4 });
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });

module.exports = { FPS, FRAMES };
