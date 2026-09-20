const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function fixture({ ready = false, idle = true } = {}) {
  let nextId = 0;
  const frames = new Map(), idles = new Map(), timers = new Map(), listeners = new Map(), cleanups = new Set(), errors = [];
  const add = queue => fn => { const id = ++nextId; queue.set(id, fn); return id; };
  const scope = { active: true, onDispose(fn) { cleanups.add(fn); return () => cleanups.delete(fn); } };
  const context = vm.createContext({
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
  });
  vm.runInContext(fs.readFileSync(require.resolve('../src/lobby/deferredSetup.js'), 'utf8').replace(/^export /gm, ''), context);
  function step(queue) {
    const entry = queue.entries().next().value;
    if (!entry) return;
    queue.delete(entry[0]);
    entry[1]();
  }
  return {
    ...context, frames, idles, timers, listeners, cleanups, errors,
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

test('lobby bootstrap defers optional requests and retains fresh on-open settings', () => {
  const source = fs.readFileSync(require.resolve('../src/index.js'), 'utf8');
  const deferred = source.slice(source.indexOf('  deferLobbySetup(['), source.indexOf('  const initialCharClass'));
  assert.match(deferred, /ensureProfilePopup\(\)/);
  assert.match(deferred, /ensureShop/);
  assert.match(deferred, /refreshTrophyClaimAvailability/);
  assert.match(deferred, /initializeLobbyHints/);
  assert.match(deferred, /get\('profile'\) === 'self'/);
  const bootstrap = source.slice(source.indexOf('document.addEventListener("DOMContentLoaded", async () => {'));
  assert.doesNotMatch(bootstrap, /await loadPartySettings\(\)/);
  assert.match(source, /async function openPartySettingsOverlay\(\)[\s\S]*?await loadPartySettings\(\)/);
  assert.match(source, /open: \(\.\.\.args\) => ensureShop\(\)\.open\(\.\.\.args\)/);
  assert.match(source, /open: \(\.\.\.args\) => ensureProfilePopup\(\)\?\.open\(\.\.\.args\)/);
});

test('actual menu wiring supports early clicks, deferred profile deep links, and wallet updates', () => {
  const source = fs.readFileSync(require.resolve('../src/index.js'), 'utf8');
  const wiring = source.slice(source.indexOf('  const ensureProfilePopup ='), source.indexOf('  const initialCharClass'));
  const f = fixture();
  const button = () => ({ addEventListener(_, callback) { this.click = callback; } });
  const shopButton = button(), usernameButton = button();
  const calls = [];
  let tasks, shopOptions, wiredProfile;
  const userData = { name: 'Player', coins: 10, gems: 20 };
  const coinCount = {}, gemCount = {};
  const location = new URL('https://game.test/?profile=self&shop=currency');
  vm.runInNewContext(wiring, {
    createLazyInitializer: f.createLazyInitializer,
    deferLobbySetup: pending => { tasks = pending; },
    initProfilePopup: () => { calls.push('profile-init'); return { open: () => calls.push('profile-open'), close() {} }; },
    initializeShop: options => { calls.push('shop-init'); shopOptions = options; return { open: section => calls.push(`shop-open:${section}`), getFeaturedSale() {} }; },
    set __lobbyProfilePopup(value) { wiredProfile = value; },
    profileController: { updateWallet: () => calls.push('wallet'), invalidate() {} },
    shopButton, usernameButton, coinResourceButton: button(), gemResourceButton: button(),
    document: { getElementById: () => button() }, userData, guest: true, coinCount, gemCount,
    URL, URLSearchParams, location,
    history: { replaceState: (_, __, url) => { location.href = new URL(url, location).href; } },
    refreshTrophyClaimAvailability: () => calls.push('trophies'),
    initializeLobbyHints: () => calls.push('hints'),
  });
  assert.deepEqual(calls, [], 'wiring menus does not initialize them or fetch optional data');
  assert.equal(typeof wiredProfile.open, 'function', 'socket bootstrap gets a usable facade immediately');
  shopButton.click();
  usernameButton.click();
  assert.deepEqual(calls, ['shop-init', 'shop-open:sales', 'profile-init', 'profile-open']);
  tasks.forEach(task => task());
  assert.equal(calls.filter(call => call === 'shop-init').length, 1);
  assert.equal(calls.filter(call => call === 'profile-init').length, 1);
  assert.equal(calls.filter(call => call === 'profile-open').length, 2, 'profile=self is still honored');
  assert.equal(location.search, '?shop=currency', 'profile cleanup preserves shop deep links');
  shopOptions.onWalletChange({ coins: 40, gems: 50 });
  assert.equal(userData.coins, 40);
  assert.equal(userData.gems, 50);
  assert.equal(coinCount.textContent, '40');
  assert.equal(gemCount.textContent, '50');
  assert.equal(calls.at(-1), 'wallet');
});
