const fs = require('node:fs');
const path = require('node:path');
const { createBrowserFixture } = require('./browserFixture');

function createLobbyFixture(options = {}) {
  const template = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');
  const fixture = createBrowserFixture(template, options);
  const root = path.resolve(__dirname, '../..');
  const notices = [];
  fixture.window.__BRO_BATTLES_USERDATA__ = { name: 'Owner', char_class: 'ninja', peak_trophies: 10000, trophies: 10000 };
  Object.assign(fixture.imports, {
    [root + '/src/client/lib/socket.js']: { __esModule: true, default: fixture.socket, ensureSocketConnected() {}, waitForConnect: async () => {} },
    [root + '/src/client/site/shell']: { ensureLegalAcceptance: async () => {}, setNavigationGuard() {} },
    [root + '/src/client/site/shell.js']: { ensureLegalAcceptance: async () => {}, setNavigationGuard() {} },
    [root + '/src/client/ui/uiSounds.js']: { initUISounds() {}, playSound() {} },
    [root + '/src/client/ui/sonner.js']: { sonner: (...args) => notices.push(args) },
    [root + '/src/client/lobby/party/buttonSpawnFx.js']: { playButtonSpawnFx() {}, playButtonSpawnFxOnChange() {} },
    [root + '/src/client/lobby/preloadBattle']: { warmBattleSelection() {} },
    ...options.imports,
  });
  return { ...fixture, notices };
}

module.exports = { createLobbyFixture };
