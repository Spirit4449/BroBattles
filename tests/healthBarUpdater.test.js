const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

function load(file) {
  const exports = {};
  const code = babel.transformSync(fs.readFileSync(require.resolve(file), 'utf8'), {
    babelrc: false, configFile: false,
    presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
  }).code;
  vm.runInNewContext(code, { exports, require: () => ({}), performance: { now: () => 10000 } });
  return exports;
}
const { updateHealthBars } = load('../src/gameScene/healthBarUpdater.js');
const OpPlayer = load('../src/opPlayer.js').default;

test('countdown refreshes teammate and opponent name/bar anchors throughout descent and landing', () => {
  function player() {
    const wrapper = Object.create(OpPlayer.prototype);
    wrapper.opponent = { x: 100, body: { y: 20 }, _spawnIntroPending: true };
    wrapper._hudAnchorX = 500;
    wrapper._hudAnchorY = -300;
    wrapper.opPlayerName = { setPosition(x, y) { this.x = x; this.y = y; } };
    wrapper.updateHealthBar = function () {
      this.barAnchor = { x: this._hudAnchorX, y: this._hudAnchorY };
      this.draws = (this.draws || 0) + 1;
    };
    return wrapper;
  }
  const enemy = player(), ally = player();
  for (let frame = 0; frame < 120; frame++) {
    for (const wrapper of [enemy, ally]) {
      wrapper.opponent.x = 100 + Math.min(frame, 100) * 0.2;
      wrapper.opponent.body.y = 20 + Math.min(frame, 100) * 2;
    }
    updateHealthBars({ opponentPlayers: { enemy }, teamPlayers: { ally }, syncPositions: true });
    for (const wrapper of [enemy, ally]) {
      assert.equal(wrapper.barAnchor.x, Math.round(wrapper.opponent.x));
      assert.equal(wrapper.barAnchor.y, Math.round(wrapper.opponent.body.y));
      assert.equal(wrapper.opPlayerName.x, wrapper.barAnchor.x);
      assert.equal(wrapper.opPlayerName.y, wrapper.barAnchor.y - 42);
    }
  }
  assert.equal(enemy.draws, 120);
  assert.equal(ally.draws, 120);
});

test('live redraw does not apply interpolation smoothing twice; legacy wrappers still work', () => {
  let positions = 0, draws = 0;
  const wrapper = { updateUIPosition: () => positions++, updateHealthBar: () => draws++ };
  updateHealthBars({ opponentPlayers: { wrapper }, teamPlayers: { wrapper } });
  assert.equal(positions, 0);
  assert.equal(draws, 1);
  updateHealthBars({ teamPlayers: { legacy: { updateHealthBar: () => draws++ } }, syncPositions: true });
  assert.equal(draws, 2);
});
