const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/navigation/lobbyReturn.js'), 'utf8').replace(/^export /gm, '');

function setup(fetch) {
  const state = { version: 0, scope: 'game', routes: [] };
  const context = vm.createContext({ fetch, AbortController, setTimeout, clearTimeout });
  vm.runInContext(source, context);
  const controller = context.createLobbyReturnController({
    getRouteVersion: () => state.version, getScopeId: () => state.scope,
    navigate: async (target, options) => {
      controller.clear();
      state.version++;
      state.scope = 'lobby';
      state.routes.push({ target, options });
      controller.bind(options.lobbyReturnStatus, state.version, state.scope);
    },
  });
  return { controller, state };
}
const reply = data => ({ ok: true, json: async () => data });

test('one fresh status request is shared by concurrent returns and consumed once', async () => {
  let calls = 0;
  let release;
  const data = { success: true, userData: { coins: 42 }, party_id: 7 };
  const { controller, state } = setup(() => { calls++; return new Promise(resolve => { release = resolve; }); });
  const first = controller.prepare(3);
  const second = controller.prepare(3);
  assert.equal(first, second);
  release(reply(data));
  await first;
  assert.equal(calls, 1);
  assert.equal(state.routes[0].target, '/party/7');
  assert.equal(controller.consume(), data);
  assert.equal(controller.consume(), null);
});

test('authoritative no-party status wins over the previous match party', async () => {
  const { controller, state } = setup(async () => reply({ success: true, userData: {}, party_id: null }));
  await controller.prepare(77);
  assert.equal(state.routes[0].target, '/');
});

test('failure falls back without caching an invalid response; bans redirect', async () => {
  for (const fetch of [async () => { throw new Error('offline'); }, async () => ({ ok: false, json: async () => ({}) })]) {
    const { controller, state } = setup(fetch);
    await controller.prepare(8);
    assert.equal(state.routes[0].target, '/party/8');
    assert.equal(controller.consume(), null);
  }
  const { controller, state } = setup(async () => ({ ok: false, json: async () => ({ banned: true }) }));
  await controller.prepare(8);
  assert.equal(state.routes[0].target, '/banned');
  assert.equal(controller.consume(), null);
});

test('superseded requests cannot navigate, and handoffs cannot escape their scope or route', async () => {
  let release;
  let signal;
  const { controller, state } = setup((_, options) => {
    signal = options.signal;
    return new Promise(resolve => { release = resolve; });
  });
  const pending = controller.prepare(9);
  controller.clear();
  state.version++;
  release(reply({ success: true, userData: {}, party_id: 9 }));
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(state.routes.length, 0);
  controller.bind({ userData: {} }, state.version, 'old-scope');
  assert.equal(controller.consume(), null);
  controller.bind({ userData: {} }, state.version - 1, state.scope);
  assert.equal(controller.consume(), null);
  controller.bind({ userData: {} }, state.version, state.scope);
  controller.clear();
  assert.equal(controller.consume(), null);
});

test('actual lobby bootstrap skips its fetch only when given a fresh handoff', async () => {
  const index = fs.readFileSync(require.resolve('../src/index.js'), 'utf8');
  const bootstrap = index.slice(index.indexOf('const returnStatus ='), index.indexOf('  .then(async (data) => {', index.indexOf('const returnStatus =')));
  for (const hasHandoff of [true, false]) {
    let calls = 0;
    const data = { success: true, userData: { coins: 55 }, party_id: 3 };
    const context = vm.createContext({
      window: { __BB_NAVIGATION__: { consumeLobbyReturnStatus: () => hasHandoff ? data : null } },
      Promise, console: { log() {} }, getJoinDebugMeta: value => value,
      fetch: async () => { calls++; return reply(data); },
    });
    const received = await vm.runInContext(bootstrap + '; statusPromise', context);
    assert.equal(received, data);
    assert.equal(calls, hasHandoff ? 0 : 1);
  }
});
