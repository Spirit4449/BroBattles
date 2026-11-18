// A fresh clock isolates state across VM-based presentation fixtures.
const { loadClientModule } = require('./clientModule');

module.exports = function loadServerClock({ performance, setTimeout = () => 0, clearTimeout = () => {},
  setInterval = () => 0, clearInterval = () => {}, flags = {} } = {}) {
  return loadClientModule('src/client/game/match/serverClock.js', {
    performance, setTimeout, clearTimeout, setInterval, clearInterval,
  }, { require: name => (name.includes('sparrowReplication') ? require('../../src/shared/characters/sparrowReplication')
    : name.includes('netFlags') ? { readNetFlags: () => ({ ...flags }) } : null) });
};
