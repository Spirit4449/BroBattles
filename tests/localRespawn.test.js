const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

test('local respawn survives old death callbacks and refreshes the body before the HUD', () => {
  const exports = {};
  const noop = () => {};
  const order = [];
  const code = babel.transformSync(fs.readFileSync(require.resolve('../src/players/localSocketEvents.js'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: () => ({
    spawnDeathBurst: noop, spawnSpawnBurst: noop,
    playSpriteAnimation: () => order.push('animation'),
  }), window: {} });
  const handlers = {};
  const timers = [];
  let dead = false;
  const player = {
    visible: true, setVisible(v) { this.visible = v; },
    setVelocity: noop, setAcceleration: noop,
    body: { reset: noop, updateFromGameObject: () => order.push('body') },
  };
  const scene = { sound: { play: noop }, input: { keyboard: {} }, time: {
    delayedCall(ms, callback) {
      const timer = { ms, callback, removed: false, remove() { this.removed = true; } };
      timers.push(timer);
      return timer;
    },
  } };
  const dispose = exports.bindLocalSocketEvents({
    socket: { on: (name, fn) => { handlers[name] = fn; }, off: noop },
    getUsername: () => 'self', getScene: () => scene, getPlayer: () => player,
    getCurrentCharacter: () => 'ninja', getDead: () => dead,
    setDead: v => { dead = v; }, setMaxHealth: noop, setCurrentHealthValue: noop,
    getWallSlideLoopPlaying: () => false,
    updateHealthBar: () => order.push('hud'),
    removeLocalCorpse: () => player.setVisible(false),
  });
  const die = () => handlers['player:dead']({ username: 'self' });
  const respawn = () => handlers['player:respawn']({ username: 'self', x: 10, y: 20, health: 100 });
  die();
  order.length = 0;
  respawn();
  assert.deepEqual(order, ['animation', 'body', 'hud']);
  assert.equal(timers[0].removed, true);
  timers[0].callback();
  assert.equal(player.visible, true);
  assert.equal(dead, false);
  die();
  timers[0].callback();
  assert.equal(player.visible, true, 'an older death must not hide the next life');
  timers[1].callback();
  assert.equal(player.visible, false, 'a current death still removes its corpse');
  respawn();
  die();
  dispose();
  assert.equal(timers[2].removed, true);
  timers[2].callback();
  assert.equal(player.visible, true, 'disposed handlers cannot hide a sprite');
});
