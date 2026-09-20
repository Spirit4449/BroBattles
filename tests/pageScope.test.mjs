import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/navigation/pageScope.js', import.meta.url), 'utf8');
const { createPageScope } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('screen lifetimes support repeated navigation without stale work', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const originalFetch = globalThis.fetch;
  const document = new EventTarget();
  document.readyState = 'complete';
  document.querySelector = () => null;
  let paused = 0;
  let disconnected = 0;
  const window = Object.assign(new EventTarget(), {
    document, location: { href: 'https://example.test/', pathname: '/' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: fn => setTimeout(fn, 1), cancelAnimationFrame: clearTimeout,
    Audio: class { pause() { paused++; } removeAttribute() {} load() {} },
    ResizeObserver: class { disconnect() { disconnected++; } },
  });
  globalThis.window = window;
  globalThis.document = document;
  try {
    const routes = [];
    const first = createPageScope((...args) => routes.push(args));
    assert.equal(first.document.querySelector, first.document.querySelector,
      'hot native method reads reuse a bound function');
    let calls = 0;
    const listener = () => calls++;
    first.document.addEventListener('DOMContentLoaded', listener, { once: true });
    await Promise.resolve();
    assert.equal(calls, 1, 'new screens initialize even after native DOMContentLoaded');
    first.window.addEventListener('resize', listener);
    first.window.addEventListener('resize', listener);
    window.dispatchEvent(new Event('resize'));
    assert.equal(calls, 2, 'duplicate listeners follow native deduplication');
    first.setTimeout(listener, 15);
    first.setInterval(listener, 15);
    new first.Audio();
    new first.ResizeObserver(() => {});
    first.window.__MATCH_SESSION__ = { level: 5 };
    let signal;
    globalThis.fetch = async (_, options) => {
      signal = options.signal;
      return { json: async () => ({ ok: true }) };
    };
    const response = await first.fetch('/status');
    first.location.href = '/party/2';
    assert.equal(routes[0][0], '/party/2');
    await first.dispose();
    await first.dispose();
    assert.equal(signal.aborted, true);
    await assert.rejects(response.json(), { name: 'AbortError' });
    assert.equal(paused, 1);
    assert.equal(disconnected, 1);
    assert.equal(window.__MATCH_SESSION__, undefined, 'screen globals cannot retain old match state');
    window.dispatchEvent(new Event('resize'));
    first.location.href = '/game/stale';
    await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(calls, 2, 'retired callbacks cannot run on the next screen');
    assert.equal(routes.length, 1, 'retired callbacks cannot redirect the next screen');
    const second = createPageScope(() => {});
    second.window.addEventListener('resize', listener);
    window.dispatchEvent(new Event('resize'));
    assert.equal(calls, 3, 'next screen owns exactly one listener');
    await second.dispose();
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
    globalThis.fetch = originalFetch;
  }
});
