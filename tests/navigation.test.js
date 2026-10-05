const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(fetchPage) {
  const location = new URL('https://game.test/');
  const state = { disposed: 0, scopes: 0, replacements: 0, history: [], warmed: 0 };
  const document = {
    body: { dataset: { bbScreen: 'lobby' }, replaceChildren() { state.replacements++; } },
    addEventListener() {},
  };
  const window = { addEventListener() {} };
  const context = {
    URL, AbortController, console, window, document, location,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    history: Object.fromEntries(['pushState', 'replaceState'].map(method => [method, (_, __, url) => {
      state.history.push(url); location.href = url;
    }])),
    fetch: fetchPage || (async url => ({ ok: true, url, text: async () => '' })),
    DOMParser: class { parseFromString() { return { body: { dataset: { bbScreen: 'lobby' } } }; } },
    getSettings: () => ({ music: 1, sfx: 1 }), subscribeSettings() {},
    createLobbyAudio: () => Object.fromEntries(['enterLobby', 'refresh', 'setHidden', 'unlock', 'handoff', 'loading'].map(key => [key, () => {}])),
    createBattlePreloader: () => ({ start() { state.warmed++; }, stop() {}, enqueue() {} }),
    getTemplateResources: () => [],
    createPageScope: () => { state.scopes++; return { active: true, dispose() { state.disposed++; } }; },
  };
  const source = fs.readFileSync(require.resolve('../src/client/navigation/index.js'), 'utf8').replace(/^import .*;\n/gm, '');
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/client/navigation/lobbyReturn.js'), 'utf8').replace(/^export /gm, ''), context);
  vm.runInContext(source, context);
  return { nav: window.__BB_NAVIGATION__, state, location };
}

test('party transitions retain the lobby lifetime and resume idle warming after readiness', async () => {
  const { nav, state, location } = setup();
  const owner = nav.scope();
  const routes = [];
  nav.setLobbyNavigator(async url => routes.push(url.pathname));
  for (let n = 1; n <= 4; n++) {
    await nav.navigate(`/party/${n}`);
    await nav.navigate('/');
  }
  assert.equal(nav.scope(), owner);
  assert.equal(state.scopes, 1);
  assert.equal(state.disposed, 0);
  assert.equal(state.replacements, 0);
  assert.equal(state.warmed, 8);
  assert.equal(routes.length, 8);
  assert.equal(location.pathname, '/');
});

test('a stale route response cannot commit after a newer party navigation', async () => {
  const responses = [];
  const { nav, state } = setup(url => new Promise(resolve => responses.push(() => resolve({ ok: true, url, text: async () => '' }))));
  const routes = [];
  nav.setLobbyNavigator(async url => routes.push(url.pathname));
  const first = nav.navigate('/party/1');
  const second = nav.navigate('/party/2');
  responses[1](); await second;
  responses[0](); await first;
  assert.deepEqual(routes, ['/party/2']);
  assert.equal(state.history.length, 1);
});

test('superseded lobby data receives an abort signal', async () => {
  const { nav } = setup();
  let firstSignal;
  let release;
  nav.setLobbyNavigator(async (url, signal) => {
    if (url.pathname === '/party/1') {
      firstSignal = signal;
      await new Promise(resolve => { release = resolve; });
    }
  });
  const first = nav.navigate('/party/1');
  await new Promise(resolve => setImmediate(resolve));
  await nav.navigate('/party/2');
  assert.equal(firstSignal.aborted, true);
  release(); await first;
});
