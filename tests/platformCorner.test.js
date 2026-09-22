const test = require('node:test');
const assert = require('node:assert/strict');
const Body = require('phaser/src/physics/arcade/Body');
const World = require('phaser/src/physics/arcade/World');
const { characterBody, getDuelGeometry } = require('../src/shared/duelGeometry');
const { processPlayerPlatformCollision } = require('../src/players/platformCollision');

function fixture(character = 'thorg', side = 'left') {
  const world = { defaults: {}, gravity: { x: 0, y: 825 }, OVERLAP_BIAS: 4,
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

test('unmodified Arcade reproduces the recorded Thorg corner stall', () => {
  const f = fixture();
  collide(f);
  assert.equal(f.player.blocked.down, true);
  assert.equal(f.player.blocked.right, true);
  assert.equal(f.player.velocity.x, 0);
  assert.ok(f.player.bottom > f.platform.top);
  assert.ok(f.player.bottom - f.platform.top < 1e-10);
});

for (const character of ['thorg', 'ninja', 'wizard', 'draven', 'gloop', 'huntress']) {
  for (const side of ['left', 'right']) {
    test(`${character} keeps moving after landing on the ${side} corner`, () => {
      const f = fixture(character, side);
      const startingX = f.player.x;
      for (let frame = 0; frame < 30; frame++) {
        if (frame) {
          f.player.resetFlags();
          f.player.prev.set(f.player.x, f.player.y);
          f.player.x += f.direction * 0.5;
          f.player.y += 825 / 3600;
          f.player._dx = f.direction * 0.5; f.player._dy = 825 / 3600;
          f.player.velocity.y = 825 / 60;
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
