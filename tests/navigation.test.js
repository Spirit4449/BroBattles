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
    createBattlePreloader: () => ({ start() { state.warmed++; }, stop() {}, enqueue() {} }),
    getTemplateResources: () => [],
    createPageScope: () => { state.scopes++; return { active: true, dispose() { state.disposed++; } }; },
  };
  const source = fs.readFileSync(require.resolve('../src/navigation/index.js'), 'utf8').replace(/^import .*;\n/gm, '');
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(require.resolve('../src/navigation/lobbyReturn.js'), 'utf8').replace(/^export /gm, ''), context);
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

test('a game return uses the loading bar instead of the lobby message overlay', () => {
  const source = fs.readFileSync(require.resolve('../src/navigation/index.js'), 'utf8');
  assert.match(source, /function showLobbyLoadingBar\(\)/);
  assert.match(source, /returningToLobby[\s\S]*?showLobbyLoadingBar\(\)/);
  assert.match(source, /showLoadingBar\('Loading lobby…'\)/);
  assert.doesNotMatch(source, /'Preparing your lobby…'/);
});

test('a battle launch keeps one bottom-anchored loading bar through game startup', () => {
  const source = fs.readFileSync(require.resolve('../src/navigation/index.js'), 'utf8');
  assert.match(source, /function showBattleLoadingBar\(\)/);
  assert.match(source, /showLoadingBar\('Preparing your battle…'\)/);
  assert.match(source, /url\.pathname\.startsWith\('\/game\/'\)[\s\S]*?showBattleLoadingBar\(\)/);
  const css = fs.readFileSync(require.resolve('../public/styles/loading.css'), 'utf8');
  assert.match(css, /#loading-wrap, #bb-route-loading-wrap/);
  assert.match(css, /bottom: max\(20px, env\(safe-area-inset-bottom\)\)/);
  assert.doesNotMatch(source, /showTransition\(url\.pathname\.startsWith\('\/game\/'\) \? 'Preparing your battle…'/);
});

test('the route loader keeps its pixel font while pages exchange stylesheets', () => {
  const source = fs.readFileSync(require.resolve('../src/navigation/index.js'), 'utf8');
  assert.match(source, /function ensureRouteLoaderFont\(\)/);
  assert.match(source, /style\.dataset\.navigation = 'route-loader-font'/);
  assert.match(source, /font-display:block/);
  assert.match(source, /document\.fonts\?\.load\?\.\('16px "Press Start 2P"'\)/);
});
