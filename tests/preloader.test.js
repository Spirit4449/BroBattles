const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../src/navigation/preload.js'), 'utf8').replace(/^export /gm, '');
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
      calls.push({ url: new URL(url).pathname, options });
      if (handler) { const result = await handler(new URL(url).pathname, options); if (result) return result; }
      if (url.endsWith('/game.html')) return new Response('<script src="/bundles/navigation.bundle.abc.js"></script><script>loadScript("/bundles/game.bundle.0123456789abcdef.js")</script><link href="/bundles/game.0123456789abcdef.css">');
      if (url.endsWith('/index.html')) return new Response('<script src="/bundles/index.bundle.0123456789abcdef.js"></script><link href="/styles/lobby.css?v=3">');
      if (url.endsWith('/battle-preload.json')) return new Response(JSON.stringify(['/bundles/mode-bank-bust.js', '/bundles/mode-other.js', '/assets/death.mp3']));
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
