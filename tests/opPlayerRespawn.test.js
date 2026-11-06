const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function loadOpPlayer(onRespawn = () => {}) {
  const exports = {};
  const code = babel.transformSync(
    fs.readFileSync(require.resolve('../src/client/game/players/RemotePlayer.js'), 'utf8'),
    {
      babelrc: false,
      configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    },
  ).code;
  const noop = () => {};
  const modules = {
    '../scene/respawnEffect': { spawnRespawnEffect: onRespawn },
    '../characters': {
      getTextureKey: noop,
      resolveAnimKey: () => 'idle',
      getStats: noop,
      getEffectsClass: () => null,
    },
    '../scene/effects': new Proxy({}, { get: () => noop }),
    '../scene/healthBarRenderer': {
      drawHealthBar: noop,
      resetHealthBarAnimation: noop,
    },
    '../scene/superBarRenderer': {
      drawSuperChargeBar: noop,
      resetSuperBarAnimation: noop,
    },
  };
  vm.runInNewContext(code, {
    exports,
    require: (id) => modules[id] || {},
    performance: { now: () => 10000 },
  });
  return exports.default;
}

test('a pending corpse-removal callback cannot hide a respawned opponent', () => {
  let respawnEffects = 0;
  const OpPlayer = loadOpPlayer(() => { respawnEffects++; });
  const wrapper = Object.create(OpPlayer.prototype);
  let corpseCallback;
  let timerRemoved = false;
  wrapper.scene = {
    time: {
      delayedCall(_delay, callback) {
        corpseCallback = callback;
        return { remove: () => { timerRemoved = true; } };
      },
    },
    sound: { play() {} },
  };
  wrapper.character = 'ninja';
  wrapper.skinId = '';
  wrapper.opMaxHealth = 100;
  wrapper.effects = null;
  wrapper.resizeBodyForDuck = () => {};
  wrapper.hideWorldUi = () => {};
  wrapper.setPresenceState = () => {};
  wrapper.updateUIPosition = () => {};
  wrapper.opponent = {
    active: true,
    visible: true,
    body: { enable: true, reset() {} },
    anims: { play() {} },
    setVelocity() {},
    setAlpha() {},
    setVisible(visible) { this.visible = visible; },
  };

  wrapper.startDeathPresentation();
  wrapper.handleRespawn({ x: 10, y: 20, health: 100 });
  corpseCallback();

  assert.equal(respawnEffects, 1);
  assert.equal(timerRemoved, true);
  assert.equal(wrapper._deathPresentationActive, false);
  assert.equal(wrapper._corpseRemoved, false);
  assert.equal(wrapper.opponent.visible, true);
});

test('a respawn leaves physics no stale previous body position to apply', () => {
  const OpPlayer = loadOpPlayer();
  const wrapper = Object.create(OpPlayer.prototype);
  wrapper.scene = { time: { delayedCall: () => ({ remove() {} }) }, sound: { play() {} } };
  wrapper.character = 'draven';
  wrapper.skinId = '';
  wrapper.opMaxHealth = 100;
  wrapper.effects = null;
  wrapper.setPresenceState = () => {};
  wrapper.updateUIPosition = () => {};
  const vector = (x, y) => ({ x, y, copy(v) { this.x = v.x; this.y = v.y; return this; } });
  const sprite = { x: 0, y: 0, flipX: false, active: true, visible: false, anims: { play() {} }, setVelocity() {}, setAlpha() {},
    setVisible(visible) { this.visible = visible; } };
  // Like Phaser's Arcade body: reset() records the sprite's top-left, and
  // updateFromGameObject() places the collider at its offset.
  sprite.body = { enable: false, position: vector(0, 0), prev: vector(0, 0), prevFrame: vector(0, 0), offset: vector(0, 0),
    sourceWidth: 70, sourceHeight: 106, width: 70,
    setSize(w, h) { this.sourceWidth = this.width = w; this.sourceHeight = h; },
    setOffset(x, y) { this.offset.x = x; this.offset.y = y; },
    reset(x, y) { sprite.x = x; sprite.y = y; this.position.x = x; this.position.y = y; this.prev.copy(this.position); this.prevFrame.copy(this.position); },
    updateFromGameObject() { this.position.x = sprite.x + this.offset.x; this.position.y = sprite.y + this.offset.y; } };
  wrapper.opponent = sprite;
  wrapper.opFrame = { realWidth: 300, realHeight: 300 };
  wrapper.bodyConfig = { widthShrink: 230, heightShrink: 194, offsetXFromHalf: 0, offsetY: 111 };

  wrapper.handleRespawn({ x: 500, y: 200, health: 100, afterSnapshot: { epoch: 'e', seq: 9 } });

  // Arcade's postUpdate moves the sprite by position - prevFrame.
  assert.deepEqual([sprite.body.position.x - sprite.body.prevFrame.x, sprite.body.position.y - sprite.body.prevFrame.y], [0, 0]);
  assert.deepEqual([sprite.x, sprite.y], [500, 200]);
  assert.deepEqual({ ...wrapper._lifeEvent }, { epoch: 'e', afterSeq: 9, dead: false });

  wrapper.startDeathPresentation({ x: 520, y: 200, afterSnapshot: { epoch: 'e', seq: 40 } });
  assert.deepEqual({ ...wrapper._lifeEvent }, { epoch: 'e', afterSeq: 40, dead: true });
});
