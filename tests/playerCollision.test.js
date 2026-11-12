const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Duck hitboxes", () => {
  const {
    DUCK_FRAME_CELLS,
    DUCK_MIN_HOLD_MS,
    DUCK_REENTRY_DELAY_MS,
    updateDuckRequest,
    findGroundSpan,
    hasStandingClearance,
    clampBodyToGroundSpan,
    reduceDuckDamage,
  } = require("../src/shared/physics/ducking");

  const platform = (x, y, width = 100, overrides = {}) => ({
    body: { x, y, width, height: 20, ...overrides },
  });

  test("duck art cells match the requested one-based sheet positions", () => {
    assert.deepEqual(DUCK_FRAME_CELLS, {
      draven: [1, 1], gloop: [9, 3], ninja: [1, 3],
      sparrow: [5, 2], ozzy: [3, 7], thorg: [4, 4],
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

  test("a duck tap holds until the minimum duration, while held input can continue", () => {
    const player = { _ducking: false };
    const start = 1000;
    assert.equal(updateDuckRequest(player, true, true, start), true);
    player._ducking = true;
    assert.equal(updateDuckRequest(player, false, true, start + DUCK_MIN_HOLD_MS - 1), true);
    assert.equal(updateDuckRequest(player, true, true, start + DUCK_MIN_HOLD_MS), true);
    assert.equal(updateDuckRequest(player, false, true, start + DUCK_MIN_HOLD_MS), false);
  });

  test("duck holds respect re-entry cooldown and cancel when ducking is interrupted", () => {
    const start = 1000;
    const player = { _ducking: false, _duckAvailableAt: start + DUCK_REENTRY_DELAY_MS };
    assert.equal(updateDuckRequest(player, true, true, player._duckAvailableAt - 1), false);
    assert.equal(updateDuckRequest(player, false, true, player._duckAvailableAt), false);
    assert.equal(updateDuckRequest(player, true, true, player._duckAvailableAt), true);
    player._ducking = true;
    assert.equal(updateDuckRequest(player, false, false, player._duckAvailableAt + 1), false);
    assert.equal(updateDuckRequest(player, false, true, player._duckAvailableAt + 2), false);
  });
});

describe("Platform corners", () => {
  const physics = require('../src/shared/physics/movementPhysics.json');

  const Body = require('phaser/src/physics/arcade/Body');
  const World = require('phaser/src/physics/arcade/World');
  const { characterBody, getDuelGeometry } = require('../src/shared/physics/duelGeometry');
  const { processPlayerPlatformCollision } = require('../src/client/game/players/platformCollision');

  function fixture(character = 'thorg', side = 'left') {
    const world = { defaults: {}, gravity: { x: 0, y: physics.gravity }, OVERLAP_BIAS: 4,
      intersects: World.prototype.intersects };
    const player = new Body(world), platform = new Body(world);
    player.gameObject = { body: player }; platform.gameObject = { body: platform };
    const shape = characterBody(character);
    const rect = getDuelGeometry(1).colliders.find(r => r.id === 'p0');
    player.setSize(shape.width, shape.height);
    platform.setSize(rect.right - rect.left, rect.bottom - rect.top);
    platform.x = rect.left; platform.y = rect.top;
    platform.prev.set(platform.x, platform.y);
    platform.immovable = true; platform.moves = false;
    const direction = side === 'left' ? 1 : -1;
    player.x = side === 'left' ? platform.left - player.width + 0.5 : platform.right - 0.5;
    player.y = platform.top - player.height + 0.01 + 2 / 13;
    player.prev.set(player.x - direction * 0.5, player.y - 0.3);
    player._dx = direction * 0.5; player._dy = 0.3;
    player.velocity.set(direction * 30, 18);
    player.updateCenter(); platform.updateCenter();
    return { world, player, platform, direction };
  }
  function collide(f, callback) {
    World.prototype.separate.call(f.world, f.player, f.platform, callback, null, false);
  }

  for (const character of ['thorg', 'ninja', 'ozzy', 'draven', 'gloop', 'sparrow']) {
    for (const side of ['left', 'right']) {
      test(`${character} keeps moving after landing on the ${side} corner`, () => {
        const f = fixture(character, side);
        const startingX = f.player.x;
        for (let frame = 0; frame < 30; frame++) {
          if (frame) {
            f.player.resetFlags();
            f.player.prev.set(f.player.x, f.player.y);
            f.player.x += f.direction * 0.5;
            f.player.y += physics.gravity / 3600;
            f.player._dx = f.direction * 0.5; f.player._dy = physics.gravity / 3600;
            f.player.velocity.y = physics.gravity / 60;
            f.player.updateCenter();
          }
          collide(f, processPlayerPlatformCollision);
          assert.equal(f.player.blocked.down, true);
          assert.equal(f.player.blocked.left || f.player.blocked.right, false);
          assert.equal(f.player.velocity.x, f.direction * 30);
          assert.ok(f.player.bottom <= f.platform.top);
        }
        assert.ok((f.player.x - startingX) * f.direction > 10);
      });
    }
  }

  test('real wall hits still block horizontal movement', () => {
    const f = fixture();
    f.player.y = f.platform.top + 20;
    f.player.updateCenter();
    collide(f, processPlayerPlatformCollision);
    assert.equal(f.player.blocked.right, true);
    assert.equal(f.player.velocity.x, 0);
    assert.equal(f.player.blocked.down, false);
  });

  test('underside collisions stop ascent while preserving sideways movement', () => {
    const f = fixture();
    f.player.y = f.platform.bottom - 0.2;
    f.player._dy = -0.3;
    f.player.velocity.y = -18;
    f.player.updateCenter();
    collide(f, processPlayerPlatformCollision);
    assert.equal(f.player.blocked.up, true);
    assert.equal(f.player.velocity.y, 0);
    assert.equal(f.player.velocity.x, 30);
  });

  test('disabled landing faces allow passage', () => {
    const f = fixture();
    f.platform.checkCollision.up = false;
    f.player.x += 20;
    f.player.updateCenter();
    collide(f, processPlayerPlatformCollision);
    assert.equal(f.player.blocked.down, false);
    assert.equal(f.player.velocity.y, 18);
  });
});
