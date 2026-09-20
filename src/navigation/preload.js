// Download into the HTTP cache only. No Phaser instance, image decoding, audio
// decoding, or script execution while the player is in the lobby.
export function createBattlePreloader() {
  const seen = new Set();
  const queue = [];
  let running = false;
  let busy = false;
  let controller;
  let budget = 24 * 1024 * 1024;
  const allowed = () => !document.hidden && !navigator.connection?.saveData && !/^(slow-)?2g$/.test(navigator.connection?.effectiveType || '');
  async function pump() {
    if (!running || busy || !allowed() || budget <= 0 || !queue.length) return;
    busy = true;
    const url = queue.shift();
    controller = new AbortController();
    try {
      const response = await fetch(url, { credentials: 'same-origin', priority: 'low', signal: controller.signal });
      if (response.ok && response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          budget -= value.byteLength;
          if (budget <= 0) { await reader.cancel(); break; }
        }
      }
    } catch (error) {
      if (error.name === 'AbortError') queue.unshift(url);
    } finally {
      busy = false;
      controller = null;
      // One download at a time, with breathing room for foreground requests.
      if (running) setTimeout(pump, 250);
    }
  }
  function enqueue(urls, first = false) {
    for (const value of first ? [...urls].reverse() : urls || []) {
      const url = new URL(value, location.origin);
      if (url.origin !== location.origin || seen.has(url.href) || queue.length >= 160) continue;
      seen.add(url.href);
      if (first) queue.unshift(url.href); else queue.push(url.href);
    }
    pump();
  }
  let discovered = false;
  async function discover() {
    if (discovered || !allowed()) return;
    discovered = true;
    try {
      // Read deployed template URLs, including content hashes in production.
      const html = await (await fetch('/game.html', { priority: 'low' })).text();
      const urls = [...html.matchAll(/["'](\/bundles\/[^"'\s]+\.(?:js|css))["']/g)].map(match => match[1]);
      enqueue(urls.filter(url => !url.includes('/navigation.')), true);
      const manifest = await (await fetch('/battle-preload.json', { priority: 'low' })).json();
      enqueue(manifest);
    } catch (_) { discovered = false; }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) controller?.abort();
    else if (running) { void discover(); pump(); }
  });
  return {
    enqueue,
    start() { running = true; setTimeout(() => { if (running) { void discover(); pump(); } }, 1200); },
    stop() { running = false; controller?.abort(); },
  };
}
