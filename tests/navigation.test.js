const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createClientModuleGraph } = require('./helpers/clientModule');
const { createLobbyFixture } = require('./helpers/lobbyFixture');

describe("Page transitions", () => {
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
    const modulePath = name => path.resolve(__dirname, '../src/client/' + name);
    const graph = createClientModuleGraph({ globals: context, imports: {
      [modulePath('navigation/pageScope')]: { createPageScope: context.createPageScope },
      [modulePath('navigation/preload')]: { createBattlePreloader: context.createBattlePreloader, getTemplateResources: context.getTemplateResources },
      [modulePath('navigation/lobbyAudio.mjs')]: { createLobbyAudio: context.createLobbyAudio },
      [modulePath('site/preferences')]: { getSettings: context.getSettings, subscribeSettings: context.subscribeSettings },
    } });
    graph.load(modulePath('navigation/index.js'));
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
});

describe("Lobby return lifecycle", () => {

  function setup(fetch) {
    const state = { version: 0, scope: 'game', routes: [] };
    const { createLobbyReturnController } = createClientModuleGraph({ globals: { fetch, AbortController, setTimeout, clearTimeout } }).load(path.resolve(__dirname, '../src/client/navigation/lobbyReturn.js'));
    const controller = createLobbyReturnController({
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

  test('lobby bootstrap consumes a fresh handoff or fetches status, then renders the received account', async () => {
    for (const hasHandoff of [true, false]) {
      const data = { success: true, userData: { name: 'Owner', char_class: 'ninja', coins: 55, gems: 7 }, guest: true };
      const requests = [];
      const f = createLobbyFixture({ globals: {
        console: { log() {}, warn() {}, error() {} },
        fetch: async url => {
          requests.push(url);
          return { ok: true, json: async () => url === '/status' ? data : { success: true, friends: [], messages: [], members: [] } };
        },
      } });
      f.window.__BB_NAVIGATION__ = { consumeLobbyReturnStatus: () => hasHandoff ? data : null, progress() {}, ready() {}, setLobbyNavigator() {} };
      f.load('src/client/pages/lobby.js');
      await f.settle();
      f.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));
      await f.settle();
      assert.equal(requests.filter(url => url === '/status').length, hasHandoff ? 0 : 1);
      assert.equal(f.document.getElementById('coin-count').textContent, '55');
      assert.equal(f.document.getElementById('username-text').textContent, 'Owner');
    }
  });
});

test('the initial lobby loading cover holds on a fast load and offers a retry on timeout', async () => {
  const f = createLobbyFixture();
  const { watchLobbyLoading, revealLobby } = f.load('src/client/lobby/lobbyReveal.js');
  const loading = f.document.getElementById('lobby-loading');
  const roster = f.document.getElementById('lobby-area');
  const retry = loading.querySelector('button');
  watchLobbyLoading();
  assert.equal(loading.hidden, false);
  assert.equal(retry.hidden, true);
  await f.runTimers(12_000);
  assert.equal(loading.hidden, false);
  assert.equal(retry.hidden, false);
  assert.equal(roster.getAttribute('aria-busy'), 'true');
  const reveal = revealLobby();
  await f.settle();
  await f.advance(499);
  assert.equal(loading.hidden, false);
  assert.equal(roster.getAttribute('aria-busy'), 'true');
  await f.advance(1);
  await reveal;
  assert.equal(loading.hidden, true);
  assert.equal(roster.getAttribute('aria-busy'), 'false');
});

test('lobby menus work before deferred setup and later setup reuses them, preserving deep links and wallet updates', async () => {
  const calls = [];
  let shopOptions;
  const user = { name: 'Owner', char_class: 'ninja', coins: 10, gems: 20 };
  const clientPath = name => path.resolve(__dirname, '../src/client/' + name);
  const f = createLobbyFixture({ url: 'https://game.test/?profile=self&shop=currency', imports: {
    [clientPath('lobby/profile/profileController')]: { createProfileController: () => ({
      initProfilePopup() { calls.push('profile-init'); return { open: () => calls.push('profile-open'), close() {} }; },
      updateWallet: () => calls.push('wallet'), invalidate() {},
    }) },
    [clientPath('lobby/shop/shop.js')]: { initializeShop: options => {
      shopOptions = options; calls.push('shop-init');
      return { open: section => calls.push(`shop-open:${section}`), getFeaturedSale: () => null,
        refreshNotifications: () => calls.push('shop-notifications') };
    } },
    [clientPath('lobby/profile/trophyController')]: { createTrophyController: () => ({ openTrophyProgressionOverlay() {}, refreshTrophyClaimAvailability() {}, scrollTrophyTrack() {}, updateTrophyTrackControls() {} }) },
    [clientPath('lobby/lobbyHints.js')]: { initializeLobbyHints() {} },
  }, globals: {
    console: { log() {}, warn() {}, error() {} },
    fetch: async url => ({ ok: true, json: async () => url === '/status'
      ? { userData: user, guest: true } : { success: true, friends: [], messages: [], members: [] } }),
  } });
  f.load('src/client/pages/lobby.js');
  await f.settle();
  f.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));
  await f.settle();
  assert.deepEqual(calls, []);
  f.document.getElementById('shop-button').click();
  f.document.getElementById('username-button').click();
  assert.deepEqual(calls, ['shop-init', 'shop-open:sales', 'profile-init', 'profile-open']);
  await f.advance(500);
  await f.settle();
  await f.advance(500);
  await f.settle();
  assert.equal(calls.filter(call => call === 'shop-init').length, 1);
  assert.equal(calls.filter(call => call === 'profile-init').length, 1);
  assert.equal(calls.filter(call => call === 'profile-open').length, 2);
  assert.equal(calls.filter(call => call === 'shop-notifications').length, 1);
  assert.equal(f.window.location.search, '?shop=currency');
  const { applyWallet } = f.load('src/client/lobby/wallet.mjs');
  const { getUser } = f.load('src/client/lobby/session.mjs');
  applyWallet(shopOptions.userData, { coins: 40, gems: 50 });
  shopOptions.onWalletChange({ coins: 40, gems: 50 });
  assert.equal(getUser().coins, 40); assert.equal(getUser().gems, 50);
  assert.equal(user.coins, 10, 'rendering the account leaves the status response intact');
  assert.equal(f.document.getElementById('coin-count').textContent, '40');
  assert.equal(f.document.getElementById('gem-count').textContent, '50');
  assert.equal(calls.at(-1), 'wallet');
});

test('Escape closes the foremost viewers popup before dismissing the underlying lobby chat', async () => {
  const f = createLobbyFixture();
  f.load('src/client/pages/lobby.js');
  await f.settle();
  const panel = f.document.querySelector('.bb-chat-lobby-panel');
  panel.classList.add('is-open');
  const viewers = f.document.createElement('div');
  viewers.className = 'bb-chat-viewers-popup';
  viewers.innerHTML = '<button data-chat-viewers-close>Close</button>';
  viewers.querySelector('button').addEventListener('click', () => viewers.remove());
  f.document.body.appendChild(viewers);
  f.event(f.document, 'keydown', { key: 'Escape' });
  assert.equal(viewers.isConnected, false);
  assert.equal(panel.classList.contains('is-open'), true);
  f.event(f.document, 'keydown', { key: 'Escape' });
  assert.equal(panel.classList.contains('is-open'), false);
});

test('the profile password dialog handles failed and successful saves and clears its fields on dismissal', async () => {
  const userData = { name: 'Owner', char_class: 'ninja', coins: 10, gems: 20, guest: false };
  const passwordRequests = [];
  const f = createLobbyFixture({ globals: {
    fetch: async (url, options) => {
      if (url === '/profile/change-password') {
        passwordRequests.push(JSON.parse(options.body));
        if (passwordRequests.length === 1) {
          return { ok: false, status: 400, json: async () => ({ error: 'Incorrect current password.' }) };
        }
      }
      return { ok: true, json: async () => {
        if (url === '/status') return { userData, guest: false };
        if (url === '/profile/data') return { profile: { username: 'Owner', guest: false } };
        return { success: true, friends: [], messages: [], members: [] };
      } };
    },
  } });
  f.load('src/client/pages/lobby.js');
  await f.settle();
  f.document.dispatchEvent(new f.window.Event('DOMContentLoaded'));
  await f.settle();
  const id = value => f.document.getElementById(value);
  const overlay = id('profile-overlay');
  const toggle = id('profile-change-password');
  id('username-button').click();
  await f.settle();

  toggle.click();
  const dialog = id('password-change-dialog');
  const form = id('profile-password-form');
  const current = id('profile-current-password');
  const next = id('profile-new-password');
  assert.equal(dialog.hasAttribute('open'), true);
  current.value = 'temporary current password';
  next.value = 'temporary new password';
  f.event(form, 'submit');
  f.event(form, 'submit');
  await f.settle();
  assert.deepEqual(passwordRequests, [{
    currentPassword: 'temporary current password', newPassword: 'temporary new password',
  }]);
  assert.equal(dialog.hasAttribute('open'), true);
  assert.equal(dialog.querySelector('[role="alert"]').textContent, 'Incorrect current password.');

  f.event(dialog, 'cancel');
  assert.equal(overlay.getAttribute('aria-hidden'), 'false');
  assert.equal(id('password-change-dialog'), null);
  assert.equal(current.value, '');
  assert.equal(next.value, '');
  assert.equal(id('profile-message').textContent, '');

  toggle.click();
  assert.equal(id('profile-current-password').value || '', '');
  assert.equal(id('profile-new-password').value || '', '');
  id('profile-current-password').value = 'correct current password';
  id('profile-new-password').value = 'temporary new password';
  f.event(id('profile-password-form'), 'submit');
  await f.settle();
  assert.equal(passwordRequests.length, 2);
  assert.equal(id('password-change-dialog'), null);
  assert.equal(id('profile-message').textContent, 'Password updated.');
  id('profile-close').click();
  assert.equal(overlay.getAttribute('aria-hidden'), 'true');
  assert.equal(id('profile-message').textContent, '');
});

test('retiring a screen closes its native dialog and removes its Escape capture immediately', () => {
  const f = createLobbyFixture();
  const cleanups = new Set();
  const captureListeners = new Set();
  f.window.__BB_PAGE_SCOPE__ = {
    onDispose(callback) {
      cleanups.add(callback);
      return () => cleanups.delete(callback);
    },
  };
  const add = f.window.addEventListener;
  const remove = f.window.removeEventListener;
  f.window.addEventListener = (type, listener, capture) => {
    if (type === 'keydown' && capture) captureListeners.add(listener);
    add(type, listener, capture);
  };
  f.window.removeEventListener = (type, listener, capture) => {
    if (type === 'keydown' && capture) captureListeners.delete(listener);
    remove(type, listener, capture);
  };
  const { openModalDialog } = f.load('src/client/ui/nativeDialog.js');
  const dialog = f.document.createElement('dialog');
  const trigger = f.document.createElement('button');
  let focusCalls = 0;
  let closeCalls = 0;
  trigger.focus = () => { focusCalls++; };
  f.document.body.append(trigger, dialog);
  // Chrome schedules the close event, so retirement must complete before it fires.
  dialog.close = () => {
    dialog.removeAttribute('open');
    dialog.removeAttribute('data-fixture-modal');
  };
  openModalDialog(dialog, {
    trigger,
    escape: true,
    onClose() { closeCalls++; dialog.remove(); },
  });
  assert.equal(captureListeners.size, 1);
  for (const dispose of [...cleanups]) dispose();
  assert.equal(dialog.isConnected, false);
  assert.equal(captureListeners.size, 0);
  assert.equal(cleanups.size, 0);
  assert.equal(closeCalls, 1);
  assert.equal(focusCalls, 0);
  f.event(dialog, 'close');
  assert.equal(closeCalls, 1);
});

test('battle loading is monotonic and reveals only after the background and route presentation are ready', async () => {
  const f = createLobbyFixture();
  f.document.body.innerHTML = '<div id="game-bg"></div><div id="matchmaking-screen"></div><div id="loading-wrap"><div id="loading-bar-fill"></div><div id="loading-text"></div><span id="loading-percent"></span></div>';
  const reports = [];
  let present;
  f.window.__BB_NAVIGATION__ = {
    beginBattleLoading: () => new Promise(resolve => { present = resolve; }),
    progress: (percent, message) => reports.push({ percent, message }),
  };
  f.window.__BB_PAGE_SCOPE__ = { active: true };
  let ready = 0;
  f.document.addEventListener('game:ready', () => ready++);
  const { setBattleLoading, markBattleBackgroundReady } = f.load('src/client/game/boot/battleLoading.js');
  setBattleLoading(48, 'Downloading the engine');
  setBattleLoading(22, 'Engine ready');
  assert.equal(f.document.querySelector('#loading-percent').textContent, '48%');
  assert.deepEqual(reports.map(report => report.percent), [48, 48]);
  setBattleLoading(100);
  assert.equal(ready, 0);
  markBattleBackgroundReady();
  assert.equal(ready, 0);
  present();
  await f.settle();
  assert.equal(ready, 1);
  assert.ok(f.document.getElementById('loading-wrap').classList.contains('hidden'));
  assert.ok(f.document.getElementById('game-bg').classList.contains('visible'));
  markBattleBackgroundReady();
  await f.settle();
  assert.equal(ready, 1);
});

test('a retired battle loader leaves the next route untouched', async () => {
  const f = createLobbyFixture();
  f.document.body.innerHTML = '<div id="game-bg"></div><div id="loading-wrap"></div>';
  let present;
  f.window.__BB_NAVIGATION__ = {
    beginBattleLoading: () => new Promise(resolve => { present = resolve; }),
    progress() {},
  };
  const scope = { active: true };
  f.window.__BB_PAGE_SCOPE__ = scope;
  let ready = 0;
  f.document.addEventListener('game:ready', () => ready++);
  const { setBattleLoading, markBattleBackgroundReady } = f.load('src/client/game/boot/battleLoading.js');
  markBattleBackgroundReady();
  setBattleLoading(100);
  scope.active = false;
  present();
  await f.settle();
  assert.equal(ready, 0);
  assert.ok(!f.document.getElementById('loading-wrap').classList.contains('hidden'));
});

test('opening and resizing Trophy Road leave the server progression unchanged', async () => {
  const model = Object.freeze({ tiers: Object.freeze([]), player: Object.freeze({ trophies: 10 }) });
  const f = createLobbyFixture({ globals: { fetch: async () => ({ ok: true, json: async () => model }) } });
  const controller = f.load('src/client/lobby/profile/trophyController.js').createTrophyController({});
  await controller.openTrophyProgressionOverlay({ preserveScroll: true });
  assert.equal(f.document.querySelector('.trophy-rewards-state strong')?.textContent,
    'No reward milestones yet');
  f.window.dispatchEvent(new f.window.Event('resize'));
  await f.advance(32);
  assert.deepEqual(Object.keys(model), ['tiers', 'player']);
});
