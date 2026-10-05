const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const exported = {};
vm.runInNewContext(babel.transformSync(fs.readFileSync(require.resolve('../src/gameScene/pregameFlythrough.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code, { exports: exported, Math });
const { planFlythrough, sampleFlythrough, clampCenter, fitZoom, blendFraming, OPENING_HOLD } = exported;

const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
// Objects from the vm realm have a foreign prototype; compare fields.
const sameFraming = (a, b, message) =>
  assert.deepEqual({ x: a.x, y: a.y, zoom: a.zoom }, { x: b.x, y: b.y, zoom: b.zoom }, message);

const screens = {
  widescreen: { width: 2300, height: 1000 },
  smaller: { width: 2300, height: 1320 },
};

function shot(view, bounds, enemy, player) {
  const zoom = 1.6;
  const final = { ...clampCenter(bounds, view, zoom, player.x, player.y), zoom };
  const plan = planFlythrough({ bounds, view, enemy, final });
  const frames = Array.from({ length: 301 }, (_, i) => sampleFlythrough(plan, i / 300, { bounds, view }));
  return { plan, final, frames };
}

// One calm move: a still opening hold, no direction reversals, no jumps,
// never outside the bounds, landing exactly on the follow framing.
function assertCalmShot({ frames, final }, bounds, view) {
  const holdEnd = Math.floor(OPENING_HOLD * 300);
  for (let i = 1; i <= holdEnd; i++) sameFraming(frames[i], frames[0], `still during the opening hold (${i})`);
  sameFraming(frames.at(-1), final, 'ends exactly on the follow framing');
  for (const key of ['x', 'y', 'zoom']) {
    const deltas = frames.slice(1).map((f, i) => f[key] - frames[i][key]).filter(d => Math.abs(d) > 1e-9);
    assert.ok(deltas.every(d => Math.sign(d) === Math.sign(deltas[0])), `${key} never reverses direction`);
  }
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    assert.ok(b.zoom >= fitZoom(bounds, view) - 1e-9, 'never shows past the camera bounds');
    assert.ok(Math.abs(b.x - a.x) < view.width / a.zoom * 0.02, `x step ${i}`);
    assert.ok(Math.abs(b.y - a.y) < view.height / a.zoom * 0.02, `y step ${i}`);
    assert.ok(Math.abs(Math.log(b.zoom / a.zoom)) < 0.01, `zoom step ${i}`);
  }
}

for (const [screen, view] of Object.entries(screens)) {
  test(`${screen}: wide maps open wide on the enemy side and glide once to the player`, () => {
    const bounds = { x: 0, y: -340, width: 3600, height: 900 };
    const result = shot(view, bounds, { x: 3300, y: 100 }, { x: 300, y: 100 });
    const overview = fitZoom(bounds, view);
    assert.ok(close(result.frames[0].zoom, overview), 'opens on the widest in-bounds view');
    assert.ok(result.frames[0].x > result.frames.at(-1).x + view.width / overview / 2, 'opens on the enemy side');
    assertCalmShot(result, bounds, view);
  });

  test(`${screen}: duel-sized maps zoom in without sweeping side to side`, () => {
    const bounds = { x: 0, y: -40, width: 2300, height: 1000 };
    const result = shot(view, bounds, { x: 1900, y: 500 }, { x: 400, y: 500 });
    assertCalmShot(result, bounds, view);
  });

  test(`${screen}: enemies in the middle still mean a single move`, () => {
    const bounds = { x: 0, y: 0, width: 6000, height: 900 };
    assertCalmShot(shot(view, bounds, { x: 3000, y: 500 }, { x: 5500, y: 500 }), bounds, view);
  });
}

test('tall maps drift vertically from the enemies to the player', () => {
  const view = screens.widescreen;
  const bounds = { x: 0, y: 0, width: 2300, height: 4000 };
  const result = shot(view, bounds, { x: 1100, y: 300 }, { x: 1100, y: 3700 });
  assert.ok(result.frames[0].y < result.frames.at(-1).y, 'top (enemies) to bottom (player)');
  assertCalmShot(result, bounds, view);
});

test('unknown enemy spawns open on the side farthest from the player', () => {
  const view = screens.widescreen;
  const bounds = { x: 0, y: 0, width: 3600, height: 900 };
  const result = shot(view, bounds, null, { x: 3400, y: 400 });
  assert.ok(result.frames[0].x < bounds.width / 2);
});

test('a cut-short blend starts where the camera is and lands on the target', () => {
  const from = { x: 100, y: 50, zoom: 1 }, to = { x: 900, y: 300, zoom: 1.8 };
  sameFraming(blendFraming(from, to, 0), from);
  const end = blendFraming(from, to, 1);
  assert.ok(close(end.x, 900) && close(end.y, 300) && close(end.zoom, 1.8));
});
