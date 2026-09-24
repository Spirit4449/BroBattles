const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const flush = () => new Promise(resolve => setImmediate(resolve));

// Small DOM transport double: requests, style completion, and cleanup resolve
// independently, so the real router can be exercised in adverse order.
function setup({ routeResponse, statusResponse, gameDataResponse, deferStyles = false, deferCleanup = false, initialStyles = [], imageClass, animate, destinationStyles = ['https://game.test/bundles/index.css'], injectedScripts = [] } = {}) {
  const location = new URL('https://game.test/game/1');
  const state = { fetches: [], executed: [], preloaded: [], styleRequests: [], disposed: 0, bodies: 0, status: null, warmed: 0, movedStyles: [], progressWrites: [] };
  let now = 0, timerId = 0;
  const timers = new Map();
  function advanceTime(ms) {
    now += ms;
    for (const [id, timer] of [...timers]) {
      if (timer.at <= now) { timers.delete(id); timer.callback(); }
    }
  }
  let scopeId = 0;
  let context;
  class Element extends EventTarget {
    constructor(tag) {
      super();
      if (animate) this.animate = animate;
      this.tagName = tag.toUpperCase(); this.childNodes = []; this.dataset = {}; this.style = {}; this.attrs = new Map(); this.recordProgress();
    }
    recordProgress() {
      Object.defineProperty(this.style, 'width', {
        get: () => this.lastWidth,
        set: value => {
          this.lastWidth = value;
          if (this.id === 'bb-route-loading-fill') state.progressWrites.push(Number.parseFloat(value));
        },
      });
    }
    get attributes() { return [...this.attrs].map(([name, value]) => ({ name, value })); }
    setAttribute(name, value) {
      this.attrs.set(name, value);
      if (name === 'data-bb-screen') this.dataset.bbScreen = value;
    }
    removeAttribute(name) { this.attrs.delete(name); if (name === 'data-bb-screen') delete this.dataset.bbScreen; }
    remove() {
      if (this.parent) this.parent.childNodes = this.parent.childNodes.filter(node => node !== this);
      this.parent = null;
    }
    append(...nodes) {
      for (const node of nodes) {
        if (node.parent === document.head && node.rel === 'stylesheet') state.movedStyles.push(node.href);
        node.remove(); node.parent = this; this.childNodes.push(node);
        if (this !== document.head && this !== document.body) continue;
        if (node.tagName === 'LINK' && node.rel === 'preload' && node.as === 'script') state.preloaded.push(node.href);
        if (node.tagName === 'LINK' && node.rel === 'stylesheet' && !state.styleRequests.includes(node)) {
          state.styleRequests.push(node);
          if (!deferStyles) queueMicrotask(() => node.onload?.());
        }
        if (node.tagName === 'SCRIPT') {
          queueMicrotask(() => {
            state.executed.push(node.src);
            if (node.src?.includes('static.cloudflareinsights.com')) {
              node.onerror?.();
              return;
            }
            if (node.src?.includes('index.bundle')) {
              state.status = context.window.__BB_NAVIGATION__.consumeLobbyReturnStatus();
            }
            node.onload?.();
          });
        }
      }
    }
    insertBefore(node, anchor) {
      this.append(node);
      this.childNodes.splice(this.childNodes.indexOf(node), 1);
      this.childNodes.splice(this.childNodes.indexOf(anchor), 0, node);
    }
    replaceChildren(...nodes) {
      if (this === document.body) state.bodies++;
      for (const child of [...this.childNodes]) child.remove();
      this.append(...nodes);
    }
    cloneNode() { const node = new Element(this.tagName); node.href = this.href; node.rel = this.rel; node.textContent = this.textContent; return node; }
    querySelectorAll(selector) {
      const nodes = this.childNodes.flatMap(node => [node, ...node.querySelectorAll('*')]);
      if (selector === '*') return nodes;
      if (selector.startsWith('link[rel="stylesheet"]')) return nodes.filter(node => node.rel === 'stylesheet' || (node.tagName === 'STYLE' && !node.dataset.navigation));
      if (selector === 'link[rel="preload"][as="font"]') return [];
      if (selector === 'link[rel="preload"]') return nodes.filter(node => node.rel === 'preload');
      return nodes.filter(node => selector.startsWith('#') ? node.id === selector.slice(1) : node.tagName.toLowerCase() === selector);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  const document = new EventTarget();
  document.createElement = tag => new Element(tag);
  document.head = new Element('head');
  document.body = new Element('body');
  document.body.setAttribute('data-bb-screen', 'game');
  document.getElementById = id => document.head.querySelector('#' + id) || document.body.querySelector('#' + id);
  for (const href of initialStyles) {
    const link = new Element('link'); link.rel = 'stylesheet'; link.href = href;
    document.head.append(link);
  }
  const window = new EventTarget();
  if (imageClass) window.Image = imageClass;
  const status = { success: true, userData: { name: 'tester', coins: 123 }, party_id: 7 };
  context = vm.createContext({
    URL, AbortController, console, window, document, location,
    Date: class extends Date { static now() { return now; } },
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {},
    history: { pushState: (_, __, url) => { location.href = url; }, replaceState: (_, __, url) => { location.href = url; } },
    fetch: async (url, options) => {
      state.fetches.push({ url: new URL(url, location).pathname, options });
      if (url === '/status') return statusResponse ? statusResponse() : { ok: true, json: async () => status };
      if (url === '/gamedata') return gameDataResponse();
      if (routeResponse) return routeResponse(url, options);
      return { ok: true, url, text: async () => '<script src="/bundles/index.bundle.js"></script>' };
    },
    DOMParser: class {
      parseFromString() {
        const body = new Element('body'); body.setAttribute('data-bb-screen', 'lobby');
        const head = new Element('head');
        for (const href of destinationStyles) {
          const style = new Element('link'); style.rel = 'stylesheet'; style.href = href; head.append(style);
        }
        const script = new Element('script'); script.src = 'https://game.test/bundles/index.bundle.js';
        const injected = injectedScripts.map(src => { const node = new Element('script'); node.src = src; return node; });
        return { title: 'Lobby', body, head, querySelectorAll: () => [script, ...injected] };
      }
    },
    createBattlePreloader: () => ({ start() { state.warmed++; }, stop() {}, enqueue() {} }),
    createPageScope: () => ({
      id: String(++scopeId), active: true,
      async dispose() {
        if (!this.active) return;
        this.active = false;
        state.disposed++;
        if (deferCleanup) await new Promise(resolve => { state.finishCleanup = resolve; });
      },
    }),
  });
  for (const file of ['preload', 'lobbyReturn', 'index']) {
    const source = fs.readFileSync(require.resolve(`../src/navigation/${file}.js`), 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
    // Keep the queue stub; resource discovery runs its actual implementation.
    vm.runInContext(file === 'preload' ? source.slice(0, source.indexOf('function createBattlePreloader')) : source, context);
  }
  const nav = window.__BB_NAVIGATION__;
  nav.scope();
  return { nav, state, document, location, status, advanceTime };
}

test('return overlaps script downloads, CSS, and cleanup; status is delivered once to the new lobby', async () => {
  const env = setup({ deferStyles: true, deferCleanup: true });
  const returning = env.nav.prepareLobbyReturn(2);
  await flush();
  assert.deepEqual(env.state.fetches.map(request => request.url), ['/status', '/party/7']);
  assert.equal(env.state.preloaded.length, 1);
  assert.equal(env.state.styleRequests.length, 1);
  assert.equal(env.state.disposed, 1);
  assert.equal(env.state.executed.length, 0);
  env.state.styleRequests[0].onload();
  await flush();
  assert.equal(env.state.executed.length, 0, 'scripts cannot execute before retiring the game');
  env.state.finishCleanup();
  await returning;
  assert.equal(env.state.bodies, 1);
  assert.equal(env.state.status, env.status);
  assert.equal(env.nav.consumeLobbyReturnStatus(), null);
  env.document.dispatchEvent(new Event('lobby:ready'));
  env.advanceTime(299);
  assert.ok(env.document.getElementById('bb-route-transition'));
  env.advanceTime(1);
  assert.equal(env.document.getElementById('bb-route-transition'), null);
});

test('a blocked Cloudflare analytics beacon cannot fail lobby navigation', async () => {
  const env = setup({ injectedScripts: ['https://static.cloudflareinsights.com/beacon.min.js/v31'] });
  await env.nav.navigate('/party/1');
  assert.equal(env.state.bodies, 1);
  assert.deepEqual(env.state.executed, ['https://game.test/bundles/index.bundle.js']);
  assert.equal(env.document.getElementById('bb-route-transition').querySelector('button'), null);
});

test('a superseding route waits for and retains a stylesheet already requested by the cancelled route', async () => {
  const env = setup({ deferStyles: true });
  const first = env.nav.navigate('/party/1');
  await flush();
  const second = env.nav.navigate('/party/2');
  await flush();
  assert.equal(env.state.styleRequests.length, 1);
  assert.equal(env.state.executed.length, 0, 'a reused stylesheet is still awaited');
  env.state.styleRequests[0].onload();
  await Promise.all([first, second]);
  assert.equal(env.state.bodies, 1);
  assert.equal(env.state.executed.length, 1);
  assert.equal(env.location.pathname, '/party/2');
  assert.ok(env.document.head.childNodes.includes(env.state.styleRequests[0]), 'cancelled route cannot remove the newer route stylesheet');
  assert.equal(env.state.status, null);
});

test('failed destination styles are retried without retaining return data', async () => {
  const env = setup({ deferStyles: true });
  const returning = env.nav.prepareLobbyReturn(2);
  await flush();
  env.state.styleRequests[0].onerror();
  await returning;
  assert.equal(env.nav.consumeLobbyReturnStatus(), null);
  assert.equal(env.state.bodies, 0);
  const retry = env.nav.navigate('/party/7', { replace: true });
  await flush();
  assert.equal(env.state.styleRequests.length, 2);
  env.state.styleRequests[1].onload();
  await retry;
  assert.equal(env.state.bodies, 1);
  assert.equal(env.state.status, null);
});


test('late loading progress preserves the error message and retry action', () => {
  const { nav, document } = setup();
  nav.fail(new Error('Startup failed'));
  const panel = document.getElementById('bb-route-transition');
  const message = panel.querySelector('p').textContent;
  nav.progress(50, "Couldn't start game");
  nav.progress(95, 'Arena ready…');
  assert.equal(panel.querySelector('p').textContent, message);
  assert.equal(panel.querySelector('button').hidden, false);
  assert.equal(panel.querySelector('button').textContent, 'Try again');
});


for (const [from, to] of [['game', 'index'], ['index', 'game']]) {
  test(`${from} to ${to} keeps the loading CSS attached and preserves the destination cascade`, async () => {
    const shared = ['https://game.test/styles/ui-system.css', 'https://game.test/styles/loading.css'];
    const destinationStyles = [`https://game.test/bundles/${to}.css`, shared[0], `https://game.test/styles/${to}.css`, shared[1]];
    const { nav, document, state, advanceTime } = setup({
      initialStyles: [`https://game.test/bundles/${from}.css`, ...shared], destinationStyles,
    });
    const loaderSheet = document.head.childNodes.find(node => node.href === shared[1]);
    await nav.navigate('/party/7');
    assert.deepEqual(state.movedStyles, [], 'loaded CSS must never detach during commit');
    assert.ok(document.head.childNodes.includes(loaderSheet), 'the overlay sheet stays mounted');
    assert.deepEqual(document.head.childNodes.filter(node => node.rel === 'stylesheet').map(node => node.href), destinationStyles);
    assert.ok(document.getElementById('bb-route-transition'), 'cover stays until readiness');
    document.dispatchEvent(new Event('lobby:ready'));
    advanceTime(1000);
    assert.equal(document.getElementById('bb-route-transition'), null);
  });
}


test('transition artwork starts first and navigation waits for decode before covering the screen', async () => {
  let image, decodeDone;
  class Image {
    constructor() { image = this; }
    decode() { return new Promise(resolve => { decodeDone = resolve; }); }
  }
  const { nav, document, state } = setup({ imageClass: Image });
  assert.equal(image.src, '/assets/loadingscreen.webp');
  assert.equal(image.fetchPriority, 'high');
  const first = nav.navigate('/party/1');
  const second = nav.navigate('/party/2');
  assert.equal(document.getElementById('bb-route-transition'), null);
  assert.equal(state.fetches.length, 0);
  image.onload();
  await flush();
  assert.equal(state.bodies, 0, 'download completion alone is not decode readiness');
  decodeDone();
  await Promise.all([first, second]);
  assert.equal(state.fetches.length, 1, 'superseded route cannot resume after decoding');
  assert.equal(state.fetches[0].url, '/party/2');
  assert.equal(state.bodies, 1);
  assert.ok(document.getElementById('bb-route-transition'));
});

test('lobby return waits for artwork and a failed image still allows recovery', async () => {
  let image;
  class Image { constructor() { image = this; } }
  const { nav, document, state } = setup({ imageClass: Image });
  const returning = nav.prepareLobbyReturn(2);
  assert.equal(document.getElementById('bb-route-transition'), null);
  assert.equal(state.fetches.length, 0);
  image.onerror();
  await flush();
  // The actual navigation retries a failed warmup; it must remain recoverable.
  if (image.onerror) image.onerror();
  await returning;
  assert.equal(state.bodies, 1);
});


test('other ready screens keep the full transition', async () => {
  const { nav, document, advanceTime } = setup();
  await nav.navigate('/game/2');
  const overlay = document.getElementById('bb-route-transition');
  document.dispatchEvent(new Event('game:ready'));
  advanceTime(999);
  assert.equal(document.getElementById('bb-route-transition'), overlay);
  advanceTime(1);
  assert.equal(document.getElementById('bb-route-transition'), null);
});

test('a newer route cancels the pending dismissal of its loading screen', async () => {
  const { nav, document, advanceTime } = setup();
  await nav.navigate('/party/1');
  document.dispatchEvent(new Event('lobby:ready'));
  advanceTime(200);
  await nav.navigate('/game/2');
  advanceTime(500);
  assert.ok(document.getElementById('bb-route-transition'));
  document.dispatchEvent(new Event('game:ready'));
  advanceTime(299);
  assert.ok(document.getElementById('bb-route-transition'));
  advanceTime(1);
  assert.equal(document.getElementById('bb-route-transition'), null);
});

test('an error cancels pending dismissal so the retry button remains available', async () => {
  const { nav, document, advanceTime } = setup();
  await nav.navigate('/party/1');
  document.dispatchEvent(new Event('lobby:ready'));
  nav.fail(new Error('Late startup failure'));
  advanceTime(1000);
  assert.equal(document.getElementById('bb-route-transition').querySelector('button').hidden, false);
});


test('page replacement waits for fade-in and removal waits for fade-out', async () => {
  const animations = [];
  const { nav, document, state, advanceTime } = setup({
    animate(keyframes, options) {
      let finish;
      const finished = new Promise(resolve => { finish = resolve; });
      animations.push({ keyframes, options, finish });
      return { finished, cancel() { finish(); } };
    },
  });
  const navigation = nav.navigate('/game/2');
  await flush();
  assert.equal(state.bodies, 0, 'outgoing page stays behind the fading cover');
  assert.equal(animations[0].options.duration, 120);
  animations[0].finish();
  await navigation;
  assert.equal(state.bodies, 1);
  document.dispatchEvent(new Event('game:ready'));
  advanceTime(999);
  assert.equal(animations.length, 1);
  advanceTime(1);
  assert.equal(animations.length, 2);
  assert.equal(animations[1].options.duration, 120);
  assert.ok(document.getElementById('bb-route-transition'));
  animations[1].finish();
  await flush();
  assert.equal(document.getElementById('bb-route-transition'), null);
});


test('lobby return advances on completed work and never resets during the status handoff', async () => {
  const { nav, state, document, advanceTime } = setup({ deferStyles: true });
  const returning = nav.prepareLobbyReturn(2);
  assert.deepEqual(state.progressWrites, [8]);
  await flush();
  assert.ok(state.progressWrites.includes(25), 'status completion advances progress');
  assert.equal(state.progressWrites.at(-1), 45, 'HTML loaded while styles are still pending');
  state.styleRequests[0].onload();
  await returning;
  assert.ok(state.progressWrites.includes(70), 'styles completion advances progress');
  assert.equal(state.progressWrites.at(-1), 88, 'scripts loaded, waiting for roster');
  nav.progress(94);
  nav.progress(50);
  nav.progress(NaN);
  assert.equal(state.progressWrites.at(-1), 94, 'late or invalid reports cannot regress progress');
  document.dispatchEvent(new Event('lobby:ready'));
  assert.equal(state.progressWrites.at(-1), 100);
  for (let index = 1; index < state.progressWrites.length; index++) {
    assert.ok(state.progressWrites[index] >= state.progressWrites[index - 1], 'every rendered width is monotonic');
  }
  advanceTime(1000);
  assert.equal(document.getElementById('bb-route-transition'), null);
});

for (const code of ['MATCH_UNAVAILABLE', 'MATCH_ENDED']) {
  test(`retry returns to the player's lobby when the server reports ${code}`, async () => {
    const env = setup({ gameDataResponse: async () => ({ ok: false, json: async () => ({ code }) }) });
    env.nav.fail(new Error('Timed out'));
    await env.document.getElementById('bb-route-transition').querySelector('button').onclick();
    assert.deepEqual(env.state.fetches.map(r => r.url), ['/gamedata', '/status', '/party/7']);
    assert.equal(env.location.pathname, '/party/7');
  });
}

test('retry is single flight and a failed retry has a cooldown', async () => {
  let reject;
  const env = setup({ gameDataResponse: () => new Promise((_, fail) => { reject = fail; }) });
  env.nav.fail(new Error('Startup failed'));
  const button = env.document.getElementById('bb-route-transition').querySelector('button');
  const recovery = button.onclick();
  await button.onclick();
  assert.equal(button.disabled, true);
  assert.equal(env.state.fetches.length, 1);
  reject(new Error('Offline'));
  await recovery;
  await button.onclick();
  assert.equal(env.state.fetches.length, 1);
  assert.equal(button.disabled, true);
  env.advanceTime(2000);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, 'Try again');
});

test('a live match retries its destination and stale ready events cannot dismiss failure', async () => {
  const env = setup({ gameDataResponse: async () => ({ ok: true, json: async () => ({ success: true }) }) });
  env.nav.fail(new Error('Asset failure'));
  env.document.dispatchEvent(new Event('game:ready'));
  env.advanceTime(1000);
  const overlay = env.document.getElementById('bb-route-transition');
  assert.ok(overlay);
  await overlay.querySelector('button').onclick();
  assert.deepEqual(env.state.fetches.map(r => r.url), ['/gamedata', '/game/1']);
});

test('known terminal startup errors return to the lobby without rechecking the match', async () => {
  const env = setup();
  env.nav.fail(Object.assign(new Error('Match ended'), { code: 'MATCH_ENDED' }));
  await env.document.getElementById('bb-route-transition').querySelector('button').onclick();
  assert.deepEqual(env.state.fetches.map(r => r.url), ['/status', '/party/7']);
});

test('a match check that finishes after another navigation cannot redirect the player', async () => {
  let resolve;
  const env = setup({ gameDataResponse: () => new Promise(done => { resolve = done; }) });
  env.nav.fail(new Error('Startup failed'));
  const retry = env.document.getElementById('bb-route-transition').querySelector('button').onclick();
  await env.nav.navigate('/party/3');
  resolve({ ok: false, json: async () => ({ code: 'MATCH_ENDED' }) });
  await retry;
  assert.equal(env.location.pathname, '/party/3');
  assert.deepEqual(env.state.fetches.map(r => r.url), ['/gamedata', '/party/3']);
});


test('return retires game while status is pending and retry preserves lobby intent', async () => {
  let release;
  const env = setup({ statusResponse: () => new Promise(resolve => { release = resolve; }) });
  const returning = env.nav.prepareLobbyReturn(7);
  await flush();
  assert.equal(env.state.disposed, 1, 'game reconnect listeners retire before status completes');
  env.nav.fail(new Error('Return interrupted'));
  release({ ok: true, json: async () => env.status });
  await returning;
  await env.document.getElementById('bb-route-transition').querySelector('button').onclick();
  assert.deepEqual(env.state.fetches.map(r => r.url), ['/status', '/party/7']);
  assert.equal(env.location.pathname, '/party/7');
});

test('lobby return retries a temporary connection failure after retiring the game', async () => {
  let attempts = 0;
  const env = setup({ routeResponse: async url => {
    if (++attempts === 1) throw new TypeError('Load failed');
    return { ok: true, url, text: async () => '' };
  } });
  const returning = env.nav.prepareLobbyReturn(7);
  await flush();
  assert.equal(env.state.disposed, 1);
  assert.equal(attempts, 1);
  env.advanceTime(500);
  await returning;
  assert.equal(attempts, 2);
  assert.equal(env.location.pathname, '/party/7');
  assert.equal(env.state.bodies, 1);
});

test('persistent connection failures are bounded and keep a lobby retry destination', async () => {
  const env = setup({ routeResponse: async () => { throw new TypeError('Load failed'); } });
  const returning = env.nav.prepareLobbyReturn(7);
  await flush();
  env.advanceTime(500);
  await flush();
  env.advanceTime(1000);
  await returning;
  assert.equal(env.state.fetches.filter(r => r.url === '/party/7').length, 3);
  const panel = env.document.getElementById('bb-route-transition');
  assert.equal(panel.dataset.destination, 'https://game.test/party/7');
  assert.equal(panel.querySelector('button').hidden, false);
  assert.equal(env.state.disposed, 1);
});

test('superseding a connection retry prevents another request to the old lobby', async () => {
  const env = setup({ routeResponse: async url => {
    if (url.endsWith('/party/7')) throw new TypeError('Load failed');
    return { ok: true, url, text: async () => '' };
  } });
  const returning = env.nav.prepareLobbyReturn(7);
  await flush();
  await env.nav.navigate('/party/8');
  env.advanceTime(500);
  await returning;
  assert.equal(env.state.fetches.filter(r => r.url === '/party/7').length, 1);
  assert.equal(env.location.pathname, '/party/8');
});
