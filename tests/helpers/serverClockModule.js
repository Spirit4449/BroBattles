// Loads a fresh, isolated copy of the client match clock for vm-based renderer
// harnesses, so clock state never leaks between tests.
const fs = require('node:fs');
const vm = require('node:vm');
const babel = require('@babel/core');

const code = babel.transformSync(fs.readFileSync(require.resolve('../../src/match/serverClock.js'), 'utf8'), {
  babelrc: false, configFile: false, presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
}).code;

module.exports = function loadServerClock({ performance, setTimeout = () => 0, clearTimeout = () => {},
  setInterval = () => 0, clearInterval = () => {} } = {}) {
  const exports = {};
  vm.runInNewContext(code, {
    exports,
    require: name => (name.includes('huntressReplication') ? require('../../src/shared/huntressReplication') : null),
    performance, setTimeout, clearTimeout, setInterval, clearInterval,
  });
  return exports;
};
