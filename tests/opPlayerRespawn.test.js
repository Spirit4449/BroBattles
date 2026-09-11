const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function loadOpPlayer() {
  const exports = {};
  const code = babel.transformSync(
    fs.readFileSync(require.resolve('../src/players/RemotePlayer.js'), 'utf8'),
    {
      babelrc: false,
      configFile: false,
      presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
    },
  ).code;
  const noop = () => {};
  const modules = {
    '../characters': {
      getTextureKey: noop,
      resolveAnimKey: () => 'idle',
      getStats: noop,
      getEffectsClass: () => null,
    },
    '../effects': new Proxy({}, { get: () => noop }),
    '../gameScene/healthBarRenderer': {
      drawHealthBar: noop,
      resetHealthBarAnimation: noop,
    },
    '../gameScene/superBarRenderer': {
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
  const OpPlayer = loadOpPlayer();
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

  assert.equal(timerRemoved, true);
  assert.equal(wrapper._deathPresentationActive, false);
  assert.equal(wrapper._corpseRemoved, false);
  assert.equal(wrapper.opponent.visible, true);
});
