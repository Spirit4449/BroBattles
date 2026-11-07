const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { loadClientModule } = require('./helpers/clientModule');
const { createLobbyFixture } = require('./helpers/lobbyFixture');

describe('Ready and party state', () => {
  function fixture() {
    const f = createLobbyFixture({ url: 'https://game.test/party/7', globals: {
      fetch: async () => { throw new Error('Offline'); },
      console: { log() {}, warn() {}, error() {} },
    } });
    const api = f.load('src/client/lobby/party/party.js');
    const roster = status => ({ partyId: 7, ownerName: 'Owner', immediate: true,
      selection: { modeId: 'duels', modeVariantId: 'duels-1v1', mapId: 1 },
      members: [{ name: 'Owner', char_class: 'ninja', team: 'team1', slot_index: 0, status }] });
    api.renderPartyMembers(roster('online'));
    api.initReadyToggle();
    api.socketInit();
    return { ...f, api, roster, button: f.document.getElementById('ready'),
      roots: [...f.document.querySelectorAll('#navbar, .lobby-party-actions, .lobby-quick-actions, #bottom-bar .dropdown-group, #lobby-area')],
      status: f.document.querySelector('[data-is-current-user="true"] .status'),
      async click() { this.button.click(); await f.settle(); },
      async acknowledge(error = null, reply = { ok: true }) { await f.acknowledgements.shift()(error, reply); },
    };
  }

  test('ready and cancel respond before acknowledgement, preserve unlocked panels and restore prior inert state', async () => {
    const f = fixture();
    f.roots[0].inert = true;
    await f.click();
    assert.equal(f.status.textContent, 'ready');
    assert.equal(f.button.value, 'Cancel');
    assert.ok(f.roots.every(root => root.inert));
    assert.ok(!f.document.querySelector('.bb-chat-lobby-wrap')?.inert);
    assert.ok(!f.document.querySelector('.bb-friends-panel')?.inert);
    assert.equal(f.button.disabled, true);
    assert.equal(f.sent[0].payload.partyId, 7);
    assert.equal(f.sent[0].payload.ready, true);
    await f.acknowledge();
    assert.equal(f.button.disabled, false);
    await f.click();
    assert.equal(f.status.textContent, 'online');
    assert.equal(f.button.value, 'Ready');
    assert.equal(f.roots[0].inert, true);
    assert.ok(f.roots.slice(1).every(root => !root.inert));
    await f.acknowledge();
  });

  test('a member can ready for the owner’s locked mode without seeing a personal unlock warning', async () => {
    const f = createLobbyFixture({ url: 'https://game.test/party/7', globals: {
      fetch: async () => { throw new Error('Offline'); },
      console: { log() {}, warn() {}, error() {} },
    } });
    const member = { name: 'Member', char_class: 'ninja', trophies: 0, trophy_peak: 0 };
    f.window.__BRO_BATTLES_USERDATA__ = member;
    const catalog = f.load('src/client/lib/gameSelectionCatalog.js');
    catalog.setSelectionProgressionUser(() => member);
    const selection = { modeId: 'bank-bust', modeVariantId: 'bank-bust-3v3', mapId: 4 };
    const api = f.load('src/client/lobby/party/party.js');
    api.applyLobbySelection(selection);
    api.renderPartyMembers({ partyId: 7, ownerName: 'Owner', immediate: true, selection,
      members: [
        { name: 'Owner', char_class: 'ninja', team: 'team1', slot_index: 0, status: 'online' },
        { ...member, team: 'team1', slot_index: 1, status: 'online' },
      ] });
    api.initReadyToggle(); api.socketInit();
    const button = f.document.getElementById('ready');
    assert.equal(button.disabled, false);
    assert.doesNotMatch(f.document.getElementById('mode-preview-subtitle').textContent, /Unlock at/);
    button.click(); await f.settle();
    assert.equal(f.sent.at(-1).payload.ready, true);
    assert.equal(f.sent.at(-1).payload.partyId, 7);
    await f.acknowledgements.shift()(null, { ok: true });
    assert.equal(button.value, 'Cancel');
    assert.match(catalog.getSelectionBlockReason(selection), /Unlock at/, 'solo access still requires the personal unlock');
    assert.equal(catalog.getSelectionBlockReason(selection, { usePartyHostAccess: true }), '');
  });

  test('rejection or timeout rolls back readiness even when refreshing the roster fails', async () => {
    for (const error of [null, new Error('Timeout')]) {
      const f = fixture();
      await f.click();
      await f.acknowledge(error, { ok: false });
      assert.equal(f.status.textContent, 'online');
      assert.equal(f.button.value, 'Ready');
      assert.ok(f.roots.every(root => !root.inert));
      assert.equal(f.notices.length, 1);
    }
  });

  test('pending readiness survives roster updates; cancel failure rolls back and old-route replies are ignored', async () => {
    const f = fixture();
    await f.click();
    f.socket.emit('party:members', f.roster('online'));
    assert.equal(f.status.textContent, 'ready');
    await f.acknowledge();
    await f.click();
    await f.acknowledge(null, { ok: false });
    assert.equal(f.button.value, 'Cancel');
    await f.click();
    f.window.location.pathname = '/party/8';
    f.api.resetLobbyRoute(8);
    await f.acknowledge(new Error('Timeout'));
    assert.equal(f.button.value, 'Ready');
    assert.equal(f.notices.length, 1, 'old-route failure produces no new notice');
  });
});

describe("Deferred lobby initialization", () => {
  function fixture({ ready = false, idle = true } = {}) {
    let nextId = 0;
    const frames = new Map(), idles = new Map(), timers = new Map(), listeners = new Map(), cleanups = new Set(), errors = [];
    const add = queue => fn => { const id = ++nextId; queue.set(id, fn); return id; };
    const scope = { active: true, onDispose(fn) { cleanups.add(fn); return () => cleanups.delete(fn); } };
    const context = {
      window: {
        __BB_PAGE_SCOPE__: scope,
        requestAnimationFrame: add(frames), cancelAnimationFrame: id => frames.delete(id),
        requestIdleCallback: idle ? add(idles) : undefined, cancelIdleCallback: id => idles.delete(id),
        setTimeout: add(timers), clearTimeout: id => timers.delete(id),
      },
      document: {
        getElementById: () => ({ hasAttribute: () => !ready }),
        addEventListener: (name, fn) => listeners.set(name, fn),
        removeEventListener: name => listeners.delete(name),
      },
      console: { warn: (...args) => errors.push(args) },
    };
    const api = loadClientModule(require.resolve('../src/client/lobby/deferredSetup.js'), context);
    function step(queue) {
      const entry = queue.entries().next().value;
      if (!entry) return;
      queue.delete(entry[0]);
      entry[1]();
    }
    return {
      ...context, ...api, frames, idles, timers, listeners, cleanups, errors,
      ready: () => { ready = true; listeners.get('lobby:ready')?.(); },
      paint: () => step(frames), runTask: () => step(idle ? idles : timers),
      dispose: () => { scope.active = false; [...cleanups].forEach(fn => fn()); },
    };
  }

  for (const ready of [false, true]) {
    for (const idle of [false, true]) {
      test(`optional setup waits for readiness and a painted frame (already ready=${ready}, idle=${idle})`, () => {
        const f = fixture({ ready, idle }), calls = [];
        f.deferLobbySetup([() => calls.push('profile'), () => calls.push('shop')]);
        if (!ready) {
          f.paint(); f.runTask();
          assert.deepEqual(calls, []);
          f.ready();
        }
        f.paint(); f.runTask();
        assert.deepEqual(calls, []);
        f.paint();
        assert.deepEqual(calls, []);
        f.runTask();
        assert.deepEqual(calls, ['profile']);
        f.runTask();
        assert.deepEqual(calls, ['profile', 'shop']);
        assert.equal(f.cleanups.size, 0);
        assert.equal(f.listeners.size, 0);
      });
    }
  }

  for (const stage of ['loading', 'first-frame', 'second-frame', 'idle', 'between-tasks']) {
    test(`navigation cancels deferred setup at ${stage}`, () => {
      const f = fixture(), calls = [];
      f.deferLobbySetup([() => calls.push(1), () => calls.push(2)]);
      if (stage !== 'loading') f.ready();
      if (['second-frame', 'idle', 'between-tasks'].includes(stage)) f.paint();
      if (['idle', 'between-tasks'].includes(stage)) f.paint();
      const lateIdle = f.idles.values().next().value;
      if (stage === 'between-tasks') f.runTask();
      const count = calls.length;
      f.dispose();
      lateIdle?.(); // Even an already-queued browser callback cannot touch the next screen.
      f.ready(); f.paint(); f.runTask();
      assert.equal(calls.length, count);
      assert.equal(f.frames.size + f.idles.size + f.timers.size + f.listeners.size + f.cleanups.size, 0);
    });
  }

  test('early menu interaction initializes once; the later idle task reuses it', () => {
    const f = fixture();
    let initialized = 0;
    const controller = { open: () => 'opened' };
    const ensure = f.createLazyInitializer(() => { initialized++; return controller; });
    f.deferLobbySetup([ensure]);
    assert.equal(ensure().open(), 'opened');
    f.ready(); f.paint(); f.paint(); f.runTask();
    assert.equal(ensure(), controller);
    assert.equal(initialized, 1);
  });

  test('failed initialization can retry; failed optional tasks do not block later setup', async () => {
    const f = fixture({ ready: true });
    let attempts = 0, finished = false;
    const ensure = f.createLazyInitializer(() => {
      if (++attempts === 1) throw new Error('retry');
      return 'ready';
    });
    f.deferLobbySetup([ensure, () => Promise.reject(new Error('request failed')), () => { finished = true; }]);
    f.paint(); f.paint(); f.runTask(); f.runTask(); f.runTask();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, true);
    assert.equal(f.errors.length, 2);
    assert.equal(ensure(), 'ready');
    assert.equal(attempts, 2);
  });

});
