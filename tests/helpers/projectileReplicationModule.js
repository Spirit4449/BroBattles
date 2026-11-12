// Loads the client's shared projectile replication helpers for vm-based
// renderer harnesses, with the harness's globals (performance, window).
const { loadClientModule } = require('./clientModule');

module.exports = function loadProjectileReplication(globals = {}) {
  return loadClientModule(require.resolve('../../src/client/game/characters/shared/projectileReplication.js'), {
    ...globals,
    require: name => {
      if (name.includes('projectilePresentation')) return require('../../src/shared/projectilePresentation');
      throw new Error(`projectileReplication has no harness binding for ${name}`);
    },
  });
};
