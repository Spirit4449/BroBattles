const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function loadOpPlayer() {
  const exports = {};
  const code = babel.transformSync(
    fs.readFileSync(require.resolve('../src/client/game/players/RemotePlayer.js'), 'utf8'),
    { babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]] },
  ).code;
  vm.runInNewContext(code, { exports, require: () => new Proxy({}, { get: () => () => {} }), performance: { now: () => 0 } });
  return exports.default;
}

function displayObject() {
  return {
    active: true, visible: false, alpha: 1,
    setVisible(v) { this.visible = v; return this; },
    setAlpha(a) { this.alpha = a; return this; },
  };
}

function remoteFighter() {
  const wrapper = Object.create(loadOpPlayer().prototype);
  Object.assign(wrapper, {
    opponent: displayObject(),
    opPlayerName: displayObject(),
    opHealthBar: displayObject(),
    _spawnPresented: true,
    _loadingGhost: false,
    _powerupStatusIcons: [],
  });
  return wrapper;
}

test('before FIGHT an unloaded fighter is a faded ghost, then solid once loaded', () => {
  const fighter = remoteFighter();
  fighter.setPresenceState(true, false);
  assert.equal(fighter.opponent.visible, false, 'hidden without the pregame ghost');

  fighter.setLoadingGhost(true);
  assert.equal(fighter.opponent.visible, true);
  assert.ok(fighter.opponent.alpha < 1, 'drawn faded');
  assert.equal(fighter.opPlayerName.visible, true, 'name shows who is loading');
  assert.equal(fighter.opHealthBar.visible, false, 'no combat UI on a ghost');

  fighter.setPresenceState(true, true);
  assert.equal(fighter.opponent.visible, true);
  assert.equal(fighter.opponent.alpha, 1);
  assert.equal(fighter.opHealthBar.visible, true);
});

test('once live, an unloaded fighter stays hidden', () => {
  const fighter = remoteFighter();
  fighter.setLoadingGhost(true);
  fighter.setPresenceState(true, false);
  fighter.setLoadingGhost(false);
  assert.equal(fighter.opponent.visible, false);
});
