const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/client/navigation/preload.js'), 'utf8').replace(/^export /gm, '');
const flush = async () => { for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve)); };

function setup(handler) {
  let now = 0, nextId = 0;
  const timers = new Map(), listeners = {}, calls = [];
  const setTimer = (fn, delay = 0) => { const id = ++nextId; timers.set(id, { fn, at: now + delay }); return id; };
  const document = { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; } };
  const connection = { addEventListener: (_, fn) => { listeners.connection = fn; } };
  const context = vm.createContext({
    URL, AbortController, DOMException, Blob, document, navigator: { connection }, location: new URL('https://game.test/'),
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    window: { requestIdleCallback: fn => setTimer(fn, 1), cancelIdleCallback: id => timers.delete(id) },
    fetch: async (url, options) => {
      calls.push({ url: new URL(url).pathname, href: url, options });
      if (handler) { const result = await handler(new URL(url).pathname, options); if (result) return result; }
      if (url.endsWith('/game.html')) return new Response('<script src="/bundles/navigation.bundle.abc.js"></script><script>loadScript("/bundles/game.bundle.0123456789abcdef.js")</script><link href="/bundles/game.0123456789abcdef.css">');
      if (url.endsWith('/index.html')) return new Response('<script src="/bundles/index.bundle.0123456789abcdef.js"></script><link href="/styles/lobby.css?v=3">');
      if (url.endsWith('/battle-preload.json')) return new Response(JSON.stringify(['/bundles/mode-bank-bust.js', '/bundles/mode-other.js', '/assets/game-sounds/death.mp3']));
      return new Response('asset');
    },
  });
  vm.runInContext(source, context);
  return {
    preloader: context.createBattlePreloader(), calls, connection, document, listeners, context,
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        await flush();
        const entry = [...timers].filter(([, value]) => value.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at;
        timers.delete(entry[0]);
        entry[1].fn();
      }
      now = end;
      await flush();
    },
  };
}

test('warming waits 1.2 seconds plus idle time and prioritizes deployed code over selected assets', async () => {
  const env = setup();
  env.preloader.enqueue(['/assets/ninja/spritesheet.webp']);
  env.preloader.selectMode('bank-bust');
  env.preloader.start();
  await env.advance(1200);
  assert.equal(env.calls.length, 0);
  await env.advance(3000);
  const paths = env.calls.map(call => call.url);
  assert.equal(paths[0], '/game.html');
  assert.ok(paths.indexOf('/bundles/game.bundle.0123456789abcdef.js') < paths.indexOf('/assets/ninja/spritesheet.webp'));
  assert.ok(paths.includes('/bundles/mode-bank-bust.js'));
  assert.ok(!paths.includes('/bundles/mode-other.js'));
  assert.ok(paths.every(path => !path.includes('/navigation.')));
  env.preloader.enqueue(['/assets/ninja/spritesheet.webp']);
  env.preloader.start();
  await env.advance(2000);
  assert.equal(env.calls.filter(call => call.url.includes('spritesheet')).length, 1);
});

test('one request at a time; navigation aborts discovery and it retries on resume', async () => {
  let blocked = true;
  const env = setup((path, { signal }) => {
    if (path !== '/game.html' || !blocked) return;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))));
  });
  env.preloader.enqueue(['/assets/ninja/spritesheet.webp']);
  env.preloader.start();
  await env.advance(3000);
  assert.equal(env.calls.length, 1);
  env.preloader.stop();
  assert.equal(env.calls[0].options.signal.aborted, true);
  await env.advance(1000);
  blocked = false;
  env.preloader.start();
  await env.advance(4000);
  assert.equal(env.calls.filter(call => call.url === '/game.html').length, 2);
  assert.ok(env.calls.some(call => call.url.includes('spritesheet')));
});

test('visibility and connection restrictions pause warming, including during its initial delay', async () => {
  const env = setup();
  env.preloader.start();
  await env.advance(500);
  env.document.hidden = true;
  env.listeners.visibilitychange();
  await env.advance(4000);
  assert.equal(env.calls.length, 0);
  env.document.hidden = false;
  env.connection.saveData = true;
  env.listeners.visibilitychange();
  await env.advance(4000);
  assert.equal(env.calls.length, 0);
  env.connection.saveData = false;
  env.connection.effectiveType = '2g';
  env.listeners.connection();
  await env.advance(4000);
  assert.equal(env.calls.length, 0);
  env.connection.effectiveType = '4g';
  env.listeners.connection();
  await env.advance(2000);
  assert.ok(env.calls.length > 0);
});

test('failed assets retry and obsolete selections are removed from the queue', async () => {
  let attempts = 0;
  const env = setup(path => path === '/assets/ninja/spritesheet.webp' && ++attempts < 2 ? new Response('', { status: 503 }) : null);
  env.preloader.enqueue(['/assets/wizard/spritesheet.webp']);
  env.preloader.enqueue(['/assets/ninja/spritesheet.webp']);
  env.preloader.start();
  await env.advance(4000);
  assert.equal(attempts, 2);
  assert.ok(!env.calls.some(call => call.url.includes('wizard')));
});

test('budget exhaustion cancels a stream and stops further speculative requests', async () => {
  let cancelled = false;
  const env = setup(path => path === '/assets/large.webp' ? new Response(new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(24 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  })) : null);
  env.preloader.enqueue(['/assets/large.webp', '/assets/next.webp']);
  env.preloader.start();
  await env.advance(5000);
  assert.equal(cancelled, true);
  assert.ok(!env.calls.some(call => call.url === '/assets/next.webp'));
});

test('results warming requests only the static lobby and its resources', async () => {
  const env = setup();
  env.preloader.enqueue(['/assets/ninja/spritesheet.webp']);
  env.preloader.start('lobby');
  await env.advance(4000);
  assert.deepEqual(env.calls.map(call => call.url), ['/index.html', '/bundles/index.bundle.0123456789abcdef.js', '/styles/lobby.css']);
});

const card = (id, bytes = 100000) => ({ animationUrl: `/assets/player-cards/${id}/${id}-animated.webm`, animationBytes: bytes });

test('cards use the gameplay queue, own card first, and share cached blobs across navigation', async () => {
  const env = setup();
  const self = card('self'), other = card('other');
  const ready = [];
  env.preloader.requestCardAnimation(other, url => ready.push(['other', url]));
  env.preloader.requestCardAnimation(self, url => ready.push(['self', url]));
  env.preloader.warmPlayerCard(self);
  env.preloader.enqueue(['/assets/ninja/spritesheet.webp']);
  env.preloader.selectMode('bank-bust');
  env.preloader.start();
  await env.advance(8000);
  const paths = env.calls.map(call => call.url);
  assert.ok(paths.indexOf('/assets/game-sounds/death.mp3') < paths.indexOf(self.animationUrl));
  assert.ok(paths.indexOf(self.animationUrl) < paths.indexOf(other.animationUrl));
  assert.deepEqual(ready.map(([id]) => id), ['self', 'other']);
  assert.ok(ready.every(([, url]) => url.startsWith('blob:')));
  env.preloader.stop();
  let cached;
  env.preloader.requestCardAnimation(self, url => { cached = url; });
  assert.equal(cached, ready[0][1]);
  env.preloader.start('cards');
  await env.advance(3000);
  assert.equal(env.calls.filter(call => call.url === self.animationUrl).length, 1);
});

test('gameplay holds prevent video downloads until both visual and audio work finish', async () => {
  const env = setup();
  const visual = env.preloader.holdGameplay(), audio = env.preloader.holdGameplay();
  env.preloader.warmPlayerCard(card('self'));
  env.preloader.start('cards');
  await env.advance(3000);
  assert.equal(env.calls.length, 0);
  visual();
  await env.advance(1000);
  assert.equal(env.calls.length, 0);
  audio();
  await env.advance(1000);
  assert.equal(env.calls.length, 1);
});

test('slow networks reserve optional downloads for self and data saver stays static', async () => {
  const env = setup();
  env.connection.effectiveType = '3g';
  env.connection.downlink = 1;
  env.connection.saveData = true;
  env.preloader.warmPlayerCard(card('self', 100000));
  env.preloader.requestCardAnimation(card('other', 100000));
  env.preloader.start('cards');
  await env.advance(4000);
  assert.equal(env.calls.length, 0);
  env.connection.saveData = false;
  env.listeners.connection();
  await env.advance(3000);
  assert.deepEqual(env.calls.map(call => call.url), [card('self').animationUrl]);
  env.connection.effectiveType = '4g';
  env.listeners.connection();
  await env.advance(1000);
  assert.equal(env.calls.length, 2);
});

test('new gameplay work aborts an optional download and resumes it after critical assets', async () => {
  let blocked = true;
  const env = setup((path, { signal }) => {
    if (path !== card('self').animationUrl || !blocked) return;
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('stopped', 'AbortError'))));
  });
  env.preloader.warmPlayerCard(card('self'));
  env.preloader.start();
  await env.advance(3500);
  const first = env.calls.find(call => call.url === card('self').animationUrl);
  assert.ok(first);
  env.preloader.enqueue(['/assets/new-map.webp']);
  assert.equal(first.options.signal.aborted, true);
  blocked = false;
  await env.advance(2000);
  const paths = env.calls.map(call => call.url);
  assert.ok(paths.indexOf('/assets/new-map.webp') < paths.lastIndexOf(card('self').animationUrl));
});

test('leaving previews cancels pending work and changing equipped cards discards old warming', async () => {
  const env = setup();
  env.preloader.warmPlayerCard(card('old'));
  env.preloader.warmPlayerCard(card('new'));
  const cancel = env.preloader.requestCardAnimation(card('hover'));
  cancel();
  env.preloader.start('cards');
  await env.advance(4000);
  assert.deepEqual(env.calls.map(call => call.url), [card('new').animationUrl]);
});

test('optional download deadline stays static without retry storms', async () => {
  const env = setup((path, { signal }) => path.endsWith('.webm') ?
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('slow', 'AbortError')))) : null);
  let ready = false;
  env.preloader.requestCardAnimation(card('slow'), () => { ready = true; });
  env.preloader.start('cards');
  await env.advance(15000);
  assert.equal(ready, false);
  assert.equal(env.calls.length, 1);
  assert.equal(env.calls[0].options.signal.aborted, true);
});

test('deliberate previews load despite low downlink estimates but still wait for gameplay', async () => {
  const env = setup();
  env.connection.effectiveType = '3g';
  env.connection.downlink = 0.3;
  const release = env.preloader.holdGameplay();
  const apple = { animationUrl: '/assets/player-cards/royal/royal-animated.mov', animationBytes: 1400000 };
  let ready;
  env.preloader.requestCardAnimation(apple, url => { ready = url; }, { interactive: true });
  env.preloader.start('cards');
  await env.advance(3000);
  assert.equal(env.calls.length, 0);
  release();
  await env.advance(1000);
  assert.equal(env.calls.length, 1);
  assert.match(ready, /^blob:/);
});

test('roster warming deduplicates cards, replaces obsolete rosters, and uses content versions', async () => {
  const env = setup();
  const self = card('self'), ally = { ...card('ally'), animationVersion: '0123456789abcdef' };
  env.preloader.warmPlayerCard(self);
  env.preloader.warmRosterCards([card('old')]);
  env.preloader.warmRosterCards([ally, self, ally]);
  env.preloader.start('cards');
  await env.advance(4000);
  assert.deepEqual(env.calls.map(call => call.url), [self.animationUrl, ally.animationUrl]);
  assert.equal(new URL(env.calls[1].href).searchParams.get('v'), ally.animationVersion);
  let cached;
  const release = env.preloader.requestCardAnimation(ally, url => { cached = url; });
  assert.match(cached, /^blob:/);
  release();
});

test('cache pressure never revokes a blob still owned by a decoder', async () => {
  const size = 3 * 1024 * 1024;
  const env = setup(path => path.endsWith('.webm') ? new Response(new Uint8Array(size)) : null);
  const urls = [];
  const releaseA = env.preloader.requestCardAnimation(card('a', size), url => urls.push(url), { interactive: true });
  const releaseB = env.preloader.requestCardAnimation(card('b', size), url => urls.push(url), { interactive: true });
  env.preloader.start('cards');
  await env.advance(4000);
  let next;
  const releaseC = env.preloader.requestCardAnimation(card('c', size), url => { next = url; }, { interactive: true });
  await env.advance(1000);
  assert.equal(next, undefined, 'live decoders fill the cache');
  assert.equal((await fetch(urls[0])).status, 200);
  releaseB();
  await env.advance(1000);
  assert.match(next, /^blob:/);
  assert.equal((await fetch(urls[0])).status, 200, 'remaining decoder keeps its source');
  await assert.rejects(fetch(urls[1]), 'unused least-recent blob is revoked');
  releaseA(); releaseC();
});

test('visible playback survives exhausted speculative warming and still yields to gameplay', async () => {
  const env = setup(path => path === '/assets/large.webp' ? new Response(new Uint8Array(32 * 1024 * 1024)) : null);
  env.preloader.enqueue(['/assets/large.webp', '/assets/unused.webp']);
  env.preloader.start();
  await env.advance(5000);
  assert.ok(!env.calls.some(call => call.url === '/assets/unused.webp'), 'speculative warming exhausted its budget');
  const releaseHold = env.preloader.holdGameplay();
  let ready;
  env.preloader.requestCardAnimation(card('visible'), url => { ready = url; }, { interactive: true });
  await env.advance(1000);
  assert.equal(ready, undefined);
  releaseHold();
  await env.advance(1000);
  assert.match(ready, /^blob:/, 'visible cards are foreground work, not lifetime speculation');
  assert.ok(!env.calls.some(call => call.url === '/assets/unused.webp'));
});

test('visible card requests retry transient local server failures without retrying forever', async () => {
  let requests = 0;
  const env = setup(path => path.endsWith('.webm') && ++requests < 3 ? new Response('', { status: 503 }) : null);
  let ready;
  env.preloader.requestCardAnimation(card('visible'), url => { ready = url; }, { interactive: true });
  env.preloader.start('cards');
  await env.advance(4000);
  assert.match(ready, /^blob:/);
  const failed = setup(() => new Response('', { status: 503 }));
  failed.preloader.requestCardAnimation(card('broken'), () => {}, { interactive: true });
  failed.preloader.start('cards');
  await failed.advance(20000);
  const attempts = failed.calls.length;
  await failed.advance(20000);
  assert.equal(failed.calls.length, attempts, 'persistent failures have a finite retry limit');
});
