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

test('match healing uses the health power-up tick once even when health was already synced', () => {
  const exports = {};
  const noop = () => {};
  let now = 1000;
  const code = babel.transformSync(fs.readFileSync(require.resolve('../src/match/matchCoordinator.js'), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: () => ({
    spawnDamageImpact: noop,
    spawnDuckGuardImpact: noop,
    spawnDeathBurst: noop,
    spawnSpawnBurst: noop,
    triggerDamageScreenPulse: noop,
    triggerDamageCameraShake: noop,
    playSpriteAnimation: noop,
  }), window: {}, Date: { now: () => now } });

  const handlers = {};
  const sounds = [];
  const coordinator = exports.createMatchCoordinator({
    socket: { on: (name, fn) => { handlers[name] = fn; }, off: noop },
    getUsername: () => 'self',
    getGameScene: () => ({ sound: { play: (key, config) => sounds.push({ key, config }) } }),
    getPlayer: () => ({ x: 0, y: 0, height: 10 }),
    getCurrentCharacter: () => 'ninja',
    lastHealthByPlayer: { self: 900 },
    hud: {},
    getGameEnded: () => true,
    getIsLiveGame: () => true,
    powerupTickSounds: { health: { key: 'pu-tick-health', options: { volume: 0.2 } } },
    getMaxHealth: () => 1000,
    setMaxHealth: noop,
    getDead: () => false,
    setDead: noop,
    getWallSlideLoopPlaying: () => false,
    getWallSlideLoopSfx: () => null,
    spawnHealthMarker: noop,
    updateHealthBar: noop,
  });
  coordinator.register();

  handlers['health-update']({
    username: 'self',
    health: 900,
    maxHealth: 1000,
    cause: 'heal',
  });

  assert.equal(sounds.length, 1);
  assert.equal(sounds[0].key, 'pu-tick-health');
  assert.equal(sounds[0].config.volume, 0.2);
  handlers['powerup:tick']({ username: 'self', type: 'health' });
  assert.equal(sounds.length, 1, 'paired health update and power-up tick must not double-play');
  now += 1500;
  handlers['health-update']({ username: 'self', health: 1000, cause: 'heal' });
  assert.equal(sounds.length, 2, 'the next regeneration tick must play');
  now += 1500;
  handlers['powerup:tick']({ username: 'self', type: 'health' });
  handlers['health-update']({ username: 'self', health: 1000, cause: 'heal' });
  assert.equal(sounds.length, 3, 'reverse notification order must also play once');
});
