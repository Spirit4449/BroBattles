// Loads a fresh copy of the client's shared shot prediction for vm-based
// renderer harnesses, bound to that harness's match clock.
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const code = babel.transformSync(fs.readFileSync(require.resolve('../../src/client/game/characters/shared/shotPrediction.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;

module.exports = function loadShotPrediction({ serverClock, performance: clock = performance }) {
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    performance: clock,
    require: name => name.includes('shotContact') ? require('../../src/shared/combat/shotContact')
      : name.includes('attackDelivery') ? require('../../src/shared/combat/attackDelivery')
      : name.includes('serverClock') ? serverClock
        : name.includes('renderLayers') ? { RENDER_LAYERS: { ATTACKS: 10 } } : null,
  });
  return exports;
};
