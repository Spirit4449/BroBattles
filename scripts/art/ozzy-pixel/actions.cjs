#!/usr/bin/env node
// Ozzy's action animations, posed after the legacy atlas (legacy/) on the
// shared skeleton (pose.cjs `figure`), with effects painted by fx.cjs.
// Positions were read off the legacy frames on the art grid (grid.cjs).
//   jump (4, take-off to apex): upright, staff swung back low in the staff
//     hand, free hand down at his side; the legs push off then fold, knees
//     forward and boots trailing.
//   falling (4, looping): staff thrust up overhead, free hand raised, legs in
//     the jump's tuck, the whole body bobbing gently in place.
//   sing (1, the wall slide): staff held low and level ahead in both hands,
//     legs straight down.
//   special (10): he lifts the staff across his chest and hoists it overhead
//     in both hands while the crystal glints (charge), swings it forward and
//     down, plants it upright ahead with a white swing arc, and a violet orb
//     grows on its head; anim.js loops its last two frames through the cast.
//   dying (7): the crystal shatters into cyan shards and he loses the book,
//     the staff tips and falls as he staggers, then he drops to his knees and
//     slumps with the staff and loose pages on the ground.
//   duck (duck00, hiResArt.duckFrame): a deep crouch, staff held low and level.
//   dashright / dashdiagonal / dashup (3 each over the 160 ms dash; left is
//     the same art flipped): stretched along the dash, coat and legs
//     streaming behind, speed lines trailing.
//   node scripts/art/ozzy-pixel/actions.cjs [name...]  -> output/ozzy-pixel/rig/<name>/
const { figure, writePreview, translate } = require('./pose.cjs');
const { drawFrame, orb, arc, sparks, page, wisp, speedLines } = require('./fx.cjs');

const RATES = { jump: 8, falling: 6, sing: 20, special: 10, dying: 10, duck: 1, dashright: 18.75, dashdiagonal: 18.75, dashup: 18.75 };

// ---------- air ----------
// The jump is scrubbed by vertical speed in the game (anim.js bbMotion, like
// Draven's), so it runs one way only, take-off to the top of the arc. The fall
// loops a gentle bob in place. Each holds its own staff and arm pose from the
// legacy art and moves only a little within it.
const lerp = (a, b, u) => a + (b - a) * u;
const ease = (u) => (1 - Math.cos(Math.PI * u)) / 2;

// Legacy jump: upright, the staff swung back low in the staff hand with its
// crystal up behind him, the free hand hanging forward. Off the ground the
// legs push down straight, then fold up, knees forward and boots trailing
// toes-down behind, the body tipped slightly forward and the coat flaring.
// Legs stay under or behind the hips (x 35) in both. The jump pushes off and
// folds the boots back; the fall starts from exactly that tuck (so the switch
// at the top of the arc only changes the arms and staff) and lets the legs
// hang down to meet the ground.
const TUCK = { front: { ankle: [29, 57], foot: 55 }, back: { ankle: [22, 58], foot: 45 }, backHip: [-3, 0] };
const legsBetween = (a, b, u) => ({
  front: { ankle: [lerp(a.front.ankle[0], b.front.ankle[0], u), lerp(a.front.ankle[1], b.front.ankle[1], u)], foot: lerp(a.front.foot, b.front.foot, u) },
  back: { ankle: [lerp(a.back.ankle[0], b.back.ankle[0], u), lerp(a.back.ankle[1], b.back.ankle[1], u)], foot: lerp(a.back.foot, b.back.foot, u) },
  backHip: [-3, 0],
});
const PUSH = { front: { ankle: [33, 62], foot: 25 }, back: { ankle: [27, 63], foot: 30 } };
const HANG = { front: { ankle: [32, 61], foot: 15 }, back: { ankle: [26, 62], foot: 15 } };
const jumpLegs = (u) => legsBetween(PUSH, TUCK, u);
const fallLegs = (u) => legsBetween(TUCK, HANG, u);
const JUMP_FRAMES = 4;
const jump = Array.from({ length: JUMP_FRAMES }, (_, i) => {
  const u = ease(i / (JUMP_FRAMES - 1));
  return drawFrame(figure({
    root: translate(1, Math.round(lerp(-3, -5, u))), lean: Math.round(lerp(4, 2, u)), head: 0,
    arms: { near: { hand: [lerp(12, 10, u), lerp(35, 33, u)], shoulder: [26, 32] }, far: { hand: [41, lerp(39, 37, u)], shoulder: [35, 35] } },
    staffAt: lerp(-22, -28, u), book: 'satchel',
    legs: jumpLegs(u),
    coat: { back: lerp(8, 22, u), front: lerp(-4, -10, u) },
  }));
});
// Legacy fall: the staff thrust up overhead, the free hand raised, legs in
// the jump's tuck. A slow loop that bobs in place as one body: the figure,
// staff, hands and boots rise and sink a pixel together and the coat stirs.
const FALL_FRAMES = 4;
const FALL_BOB = [0, -1, 0, 1]; // px, up is negative
const falling = Array.from({ length: FALL_FRAMES }, (_, i) => {
  const dy = FALL_BOB[i];
  const legs = legsBetween(TUCK, HANG, 0.3);
  return drawFrame(figure({
    root: translate(1, -3 + dy), lean: 3, head: 0,
    arms: { near: { hand: [17, 9 + dy], shoulder: [26, 30], bend: -1 }, far: { hand: [43, 18 + dy], shoulder: [35, 32], bend: -1 } },
    staffAt: 18, slide: 8, book: 'satchel',
    // Boots trail the body by a pixel, so the legs flex a touch with the bob.
    legs: { ...legs, front: { ...legs.front, ankle: [legs.front.ankle[0], legs.front.ankle[1] - dy * 0.5] }, back: { ...legs.back, ankle: [legs.back.ankle[0], legs.back.ankle[1] - dy * 0.5] } },
    coat: { back: 28 + 2 * (i % 2), front: -12 },
  }));
});
const sing = [drawFrame(figure({
  lean: -4, head: -3,
  arms: { near: { hand: [37, 38], shoulder: [28, 33] }, far: { hand: [39, 33], shoulder: [34, 34] } },
  staffAt: 62, book: 'satchel',
  legs: { front: { ankle: [38, 61] }, back: { ankle: [30, 61] } },
  coat: { back: 6, front: -4 },
}))];

// ---------- special ----------
const LUNGE = { root: translate(14, 2), lean: 24, head: 10, book: 'satchel', satchelAt: [-8, -2],
  legs: { front: { ankle: [40, 59] }, back: { ankle: [10, 59] }, backHip: [-4, 0] }, coat: { back: 45, front: -10, backScale: 0.85 } };
const planted = (extra = {}) => figure({ ...LUNGE,
  arms: { near: { hand: [60, 33], shoulder: [30, 33] }, far: { hand: [60, 36], shoulder: [33, 34] } },
  staffAt: 0, slide: 7, ...extra });
const hoist = (i) => figure({
  drop: 3, head: -14, lean: -3,
  arms: { near: { hand: [21, 8], shoulder: [27, 31], bend: -1 }, far: { hand: [31, 9], shoulder: [33, 31], bend: -1 } },
  staffAt: -58 + 2 * i, slide: 24, book: 'satchel', swap: i === 1 ? { X: 'd' } : undefined,
  legs: 'rest', coat: { back: 4, front: -4 },
});
// Swinging down from overhead to the plant: halfway forward, staff upright.
const swing = figure({
  root: translate(7, 1), lean: 12, head: 4, book: 'satchel', satchelAt: [-5, -1],
  arms: { near: { hand: [46, 22], shoulder: [30, 32] }, far: { hand: [47, 26], shoulder: [33, 33] } },
  staffAt: -12, slide: 12,
  legs: { front: { ankle: [38, 59] }, back: { ankle: [20, 59] }, backHip: [-3, 0] }, coat: { back: 25, front: -8 },
});
// Lifting from the stance: the staff comes up across his chest.
const lift = figure({
  drop: 1, head: -6,
  arms: { near: { hand: [24, 22], shoulder: [26, 31] }, far: { hand: [32, 25], shoulder: [33, 32], bend: -1 } },
  staffAt: -28, slide: 12, book: 'satchel',
  legs: 'rest', coat: { back: 4, front: -4 },
});
const big = 128;
const special = [
  drawFrame(lift, { size: big }),
  drawFrame(hoist(0), { size: big, front: (L, P) => sparks(L, P.head, 4, 4, 1, ['c', 'p']) }),
  drawFrame(hoist(1), { size: big, front: (L, P) => sparks(L, P.head, 6, 5, 11, ['c', 'w', 'p']) }),
  drawFrame(hoist(2), { size: big, front: (L, P) => { sparks(L, P.head, 6, 4, 21, ['c', 'p']); wisp(L, P.head, 0.3, 0.6); } }),
  // The arc trails behind the crystal, ending on it.
  drawFrame(swing, { size: big, behind: (L, P) => arc(L, [P.head[0] - 7, P.head[1] + 19], 20, -165, -72, 4) }),
  drawFrame(planted(), { size: big, behind: (L, P) => arc(L, [P.head[0] - 26, P.head[1] + 4], 27, -95, -8, 5) }),
  drawFrame(planted({ swap: { X: 'd' } }), { size: big, front: (L, P) => orb(L, [P.head[0] + 1, P.head[1] - 4], 6, 0, { swirl: false }) }),
  drawFrame(planted({ swap: { X: 'd' } }), { size: big, front: (L, P) => orb(L, [P.head[0] + 1, P.head[1] - 8], 11, 0) }),
  drawFrame(planted({ swap: { X: 'd' } }), { size: big, front: (L, P) => orb(L, [P.head[0] + 1, P.head[1] - 12], 16, 0.1) }),
  drawFrame(planted({ swap: { X: 'd' } }), { size: big, front: (L, P) => orb(L, [P.head[0] + 1, P.head[1] - 12], 16, 0.35) }),
];

// ---------- dying ----------
const KNEEL = (sag, extra = {}) => figure({
  root: translate(3, 10 + sag), lean: 6 + 3 * sag, head: 8 + 4 * sag, headShift: [0, sag],
  arms: { near: { hand: [33, 56 + sag] }, far: { hand: [42, 56 + sag], shoulder: [35, 34] } },
  staffIn: [22, 53], staffAt: 90, book: null,
  legs: { front: { ankle: [27, 51], knee: 1 }, back: { ankle: [24, 51] }, backHip: [-3, 0] },
  coat: { back: 50, front: -60, backScale: 0.7, frontScale: 0.65 }, ...extra,
});
const groundJunk = (L) => { page(L, [44, 61], 0.2); page(L, [52, 62], 0); page(L, [60, 61], 0.4); };
const dying = [
  drawFrame(figure({ far: -25, head: -4, book: [1, -6], bookTurn: -10, swap: undefined }), {
    front: (L, P) => { sparks(L, P.head, 12, 6, 3, ['c', 'C', 'c']); page(L, [42, 13], 0.1); page(L, [47, 11], 0.5); },
  }),
  drawFrame(figure({ far: 25, head: -8, lean: -3, staffIn: [16, 63], staffAt: 11, grab: true, near: 8, book: [5, 1], bookTurn: 35 }), {
    front: (L, P) => { sparks(L, [P.head[0] - 4, P.head[1] - 6], 10, 8, 5, ['c', 'C'], 4); page(L, [30, 10], 0.6, 1); page(L, [20, 20], 0.3); },
  }),
  drawFrame(figure({ drop: 2, far: 45, head: 10, lean: 8, staffIn: [14, 63], staffAt: 31, grab: true, near: 25, book: [10, 14], bookTurn: 120 }), {
    front: (L, P) => { sparks(L, [P.head[0] - 8, P.head[1] - 14], 8, 10, 9, ['c', 'C'], 6); page(L, [18, 23], 0.8, -1); page(L, [52, 39], 0.2); },
  }),
  drawFrame(KNEEL(0, { lean: 14, head: 14 }), { front: (L) => { groundJunk(L); sparks(L, [14, 10], 4, 8, 13, ['c', 'C']); } }),
  drawFrame(KNEEL(1), { front: groundJunk }),
  drawFrame(KNEEL(1, { staffAt: 87 }), { front: groundJunk }),
  drawFrame(KNEEL(1), { front: groundJunk }),
];

// ---------- duck ----------
// The crouch (hiResArt.duckFrame), low enough for the ducking hitbox: knees
// folded deep under the upright body and the staff held low and level ahead
// with its crystal forward.
const duck = [drawFrame(figure({
  // Nothing rotates (body, head, coat), so the art keeps its exact pixels; the
  // whole figure sinks onto folded legs.
  root: translate(0, 14), lean: 0, head: 0,
  arms: { near: { hand: [40, 54], shoulder: [29, 33] }, far: { hand: [44, 55], shoulder: [34, 34] } },
  staffAt: 80, slide: 6, book: 'satchel',
  legs: { front: { ankle: [43, 47] }, back: { ankle: [29, 47], foot: 10 }, backHip: [-4, 0] },
  coat: {},
}))];

// ---------- dashes ----------
// Three frames over the 160 ms dash (launch, full stretch, ease), each body
// stretched along the dash with the coat and legs streaming behind and speed
// lines trailing. `dir` points along the dash (screen coords).
function dashSet({ root, lean, head = 0, arms, staffAt, slide = 0, legs, coat, dir }) {
  return [0.6, 1, 0.8].map((k, i) => drawFrame(figure({
    root: root(k), lean: lean * k, head, arms, staffAt, slide, book: 'satchel', legs: legs(k), coat: coat(k),
    swap: i === 1 ? { X: 'd' } : undefined,
  }), { behind: (L, P) => speedLines(L, P.waist, dir, 5 + 4 * k, 14 + 6 * k, i) }));
}
const dashes = {
  // Horizontal: pitched forward hard, staff thrust out ahead, legs trailing.
  dashright: dashSet({
    root: (k) => translate(2 * k, -2), lean: 40, head: 24, dir: [1, 0],
    arms: { near: { hand: [50, 36] }, far: { hand: [40, 44] } }, staffAt: 82, slide: 8,
    legs: (k) => ({ front: { ankle: [30 - 4 * k, 58], foot: 30 }, back: { ankle: [20 - 6 * k, 56], foot: 40 }, backHip: [-3, 0] }),
    coat: (k) => ({ back: 30 + 25 * k, front: 10 + 20 * k, backScale: 0.9 }),
  }),
  // Up and forward: stretched along the diagonal, staff leading up ahead.
  dashdiagonal: dashSet({
    root: (k) => translate(k, -3 - 2 * k), lean: 24, head: 14, dir: [0.7, -0.7],
    arms: { near: { hand: [46, 24], bend: -1 }, far: { hand: [40, 40] } }, staffAt: 45, slide: 8,
    legs: (k) => ({ front: { ankle: [33 - 2 * k, 61], foot: 35 }, back: { ankle: [24 - 3 * k, 60], foot: 45 }, backHip: [-3, 0] }),
    coat: (k) => ({ back: 25 + 20 * k, front: -5 + 10 * k, backScale: 0.9 }),
  }),
  // Straight up: tall and narrow, staff raised overhead, legs hanging together.
  dashup: dashSet({
    root: (k) => translate(0, -3 - 2 * k), lean: -2, head: -6, dir: [0, -1],
    arms: { near: { hand: [27, 12], shoulder: [26, 30], bend: -1 }, far: { hand: [40, 22], shoulder: [35, 32], bend: -1 } }, staffAt: 4, slide: 4,
    legs: (k) => ({ front: { ankle: [36, 62 + k], foot: 30 }, back: { ankle: [32, 62 + k], foot: 30 }, backHip: [-2, 0] }),
    coat: (k) => ({ back: -4 - 6 * k, front: 4 + 6 * k, backScale: 1 + 0.08 * k, frontScale: 1 + 0.08 * k }),
  }),
};

const FRAMES = { jump, falling, sing, special, dying, duck, ...dashes };

if (require.main === module) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(FRAMES);
  (async () => { for (const n of names) await writePreview(n, FRAMES[n], RATES[n]); })().catch((e) => { console.error(e); process.exitCode = 1; });
}

module.exports = { FRAMES, RATES };
