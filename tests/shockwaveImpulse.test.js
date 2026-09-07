const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveShockwaveImpulse } = require('../src/shared/shockwaveImpulse');
const { applyImpulse, stepBody } = require('../src/server/core/bots/physics');

test('floor, wall, ceiling and corner contacts redirect blocked blast force', () => {
  const ground = resolveShockwaveImpulse(1500, 800, { down: true });
  assert.ok(ground.x === 1500 && ground.y <= -900);
  const wall = resolveShockwaveImpulse(1500, -600, { right: true });
  assert.equal(wall.x, 0);
  assert.ok(wall.y < -1500);
  const ceiling = resolveShockwaveImpulse(200, -1500, { up: true });
  assert.ok(ceiling.x > 1500 && ceiling.y === 0);
  const corner = resolveShockwaveImpulse(1500, 600, { right: true, down: true });
  assert.ok(corner.x === 0 && corner.y < -1500);
  assert.deepEqual(resolveShockwaveImpulse(700, 900), { x: 700, y: 900 });
});

test('grounded bot leaves the floor and preserves blast through opposing movement and jump input', () => {
  const player = { x: 500, y: 200, char_class: 'ninja', grounded: true, _jumpLaunch: { vy: -10 } };
  applyImpulse(player, { cause: 'shockwave', radial: true, amountX: 1800, amountY: 600 }, 1000);
  assert.equal(player._jumpLaunch, null);
  assert.ok(player.vy < -1000);
  stepBody(player, { direction: -1, jumpPressed: true }, {
    colliders: [], world: { x: 0, y: 0, width: 5000, height: 5000 },
  }, 16, 1016);
  assert.equal(player.vx, 1800);
  assert.ok(player.y < 200);
});

test('local shockwave handler lifts grounded players and removes speed caps immediately', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const babel = require('@babel/core');
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(require.resolve('../src/players/localSocketEvents'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: name => name.includes('shockwaveImpulse')
    ? require('../src/shared/shockwaveImpulse') : {}, window: {} });
  const handlers = {};
  const player = {
    body: { blocked: { down: true }, touching: {} }, _jumpLaunch: {},
    setVelocityX(x) { this.vx = x; }, setVelocityY(y) { this.vy = y; },
    setMaxVelocity(x, y) { this.cap = { x, y }; },
    setAccelerationX(x) { this.accel = x; }, setDragX(x) { this.drag = x; },
  };
  exports.bindLocalSocketEvents({
    socket: { on: (event, fn) => { handlers[event] = fn; } },
    getPlayer: () => player, getDead: () => false,
  });
  handlers['player:knockback']({ cause: 'shockwave', radial: true, amountX: 2400, amountY: 700 });
  assert.equal(player.vx, 2400);
  assert.ok(player.vy < -1400);
  assert.ok(player.cap.x >= player.vx && player.cap.y >= Math.abs(player.vy));
  assert.equal(player._jumpLaunch, null);
  assert.equal(player.accel, 0);
  assert.equal(player.drag, 0);
  assert.ok(player._shockwaveUntil > Date.now());
});
