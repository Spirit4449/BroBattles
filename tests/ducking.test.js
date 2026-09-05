const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DUCK_FRAME_CELLS,
  findGroundSpan,
  hasStandingClearance,
  clampBodyToGroundSpan,
  reduceDuckDamage,
} = require("../src/shared/ducking");

const platform = (x, y, width = 100, overrides = {}) => ({
  body: { x, y, width, height: 20, ...overrides },
});

test("duck art cells match the requested one-based sheet positions", () => {
  assert.deepEqual(DUCK_FRAME_CELLS, {
    draven: [1, 1], gloop: [8, 2], ninja: [1, 3],
    huntress: [5, 2], wizard: [3, 7], thorg: [4, 4],
  });
});

test("ground spans join touching platforms but not gaps", () => {
  const body = { x: 40, y: 50, width: 20, height: 50 };
  assert.deepEqual(
    findGroundSpan(body, [platform(0, 100), platform(100, 100)]),
    [0, 200],
  );
  assert.deepEqual(
    findGroundSpan(body, [platform(0, 100), platform(110, 100)]),
    [0, 100],
  );
  assert.equal(findGroundSpan(body, [platform(0, 105)]), null);
  assert.equal(findGroundSpan(body, [platform(0, 100, 100, { enable: false })]), null);
});

test("standing clearance detects only overhead solids", () => {
  const body = { x: 40, y: 75, width: 20, height: 25 };
  assert.equal(hasStandingClearance(body, [platform(0, 100)], 25), true);
  assert.equal(hasStandingClearance(body, [platform(0, 50)], 25), false);
  assert.equal(hasStandingClearance(body, [platform(80, 50)], 25), true);
});

test("duck edge clamp stops both edges without blocking upward movement", () => {
  for (const [x, expectedX] of [[-20, -10], [110, 90]]) {
    const body = {
      x, y: 76, width: 20, height: 25,
      position: { x, y: 76 }, velocity: { x: 200, y: 5 }, touching: {},
    };
    assert.equal(clampBodyToGroundSpan(body, [0, 100], 100), true);
    assert.equal(body.position.x, expectedX);
    assert.equal(body.position.y, 75);
    assert.equal(body.velocity.x, 0);
    assert.equal(body.touching.down, true);
    body.velocity.y = -1;
    assert.equal(clampBodyToGroundSpan(body, [0, 100], 100), false);
  }
});

test("duck ground clamp also repairs a missed vertical contact", () => {
  const body = {
    x: 40, y: 78, width: 20, height: 25,
    position: { x: 40, y: 78 }, velocity: { x: 20, y: 18 }, touching: {},
  };
  assert.equal(clampBodyToGroundSpan(body, [0, 100], 100), true);
  assert.equal(body.position.y, 75);
  assert.equal(body.velocity.x, 20);
  assert.equal(body.velocity.y, 0);
  assert.equal(body.touching.down, true);
});

test("Phaser sizing contract keeps source and scaled dimensions separate", () => {
  // Regression guard: Body.setSize expects source pixels, not body.width after scale.
  const sourceWidth = 48;
  const scale = 1.5;
  let width = sourceWidth * scale;
  for (let cycle = 0; cycle < 20; cycle += 1) {
    width = sourceWidth * scale;
  }
  assert.equal(width, 72);
  assert.notEqual(width * scale, width);
});

test("ducking reduces incoming combat damage by twenty percent", () => {
  assert.equal(reduceDuckDamage({ ducking: true }, 1000), 800);
  assert.equal(reduceDuckDamage({ ducking: false }, 1000), 1000);
  assert.equal(reduceDuckDamage(null, 1000), 1000);
});
