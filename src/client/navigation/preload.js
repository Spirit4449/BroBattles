// Discover both script tags and the ordered loadScript calls in game.html.
// Reading a template must never execute it or initialize the other screen.
export function getTemplateResources(html) {
  return [...new Set([...html.matchAll(/["'](\/(?:bundles|styles)\/[^"'\s]+\.(?:js|css)(?:\?[^"'\s]*)?)["']/g)]
    .map(match => match[1]))].filter(url => !/\/navigation[.]/.test(url));
}

// Only download bytes into the HTTP cache. Discovery and assets share a queue,
// cancellation controller, and session byte budget.
export function createBattlePreloader() {
  const jobs = new Map();
  const templates = new Map();
  const completed = new Set();
  let manifest;
  let modeId;
  let screen;
  let enabled = false;
  let busy = false;
  let controller;
  let delayTimer;
  let idleTimer;
  let budget = 24 * 1024 * 1024;
  const allowed = () => !document.hidden && !navigator.connection?.saveData && !/^(slow-)?2g$/.test(navigator.connection?.effectiveType || '');

  function add(value, target, priority = 2, kind = 'asset') {
    let url;
    try { url = new URL(value, location.origin); } catch (_) { return; }
    if (url.origin !== location.origin || completed.has(url.href) || jobs.size >= 160) return;
    const key = target + ':' + url.href;
    if (!jobs.has(key)) jobs.set(key, { key, url: url.href, target, priority, kind, attempts: 0 });
  }
  function addMode() {
    for (const url of manifest || []) {
      if (typeof url === 'string' && url.startsWith('/bundles/mode-' + modeId + '.')) add(url, 'battle', 1);
      else if (typeof url === 'string' && url.startsWith('/assets/')) add(url, 'battle', 3);
    }
  }
  function seed(target) {
    const template = templates.get(target);
    if (template) {
      for (const url of template) add(url, target, 1);
    } else add(target === 'battle' ? '/game.html' : '/index.html', target, 0, 'template');
    if (target === 'battle' && modeId) {
      if (manifest) addMode();
      else add('/battle-preload.json', target, 1, 'manifest');
    }
  }
  function cancelSchedule() {
    clearTimeout(delayTimer);
    if (window.cancelIdleCallback) window.cancelIdleCallback(idleTimer);
    else clearTimeout(idleTimer);
    delayTimer = idleTimer = null;
  }
  function schedule(delay = 250) {
    if (!enabled || busy || !allowed() || budget <= 0 || delayTimer || idleTimer) return;
    delayTimer = setTimeout(() => {
      delayTimer = null;
      const run = () => { idleTimer = null; void pump(); };
      idleTimer = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 1000 }) : setTimeout(run, 0);
    }, delay);
  }
  async function pump() {
    if (!enabled || busy || !allowed() || budget <= 0) return;
    const job = [...jobs.values()].filter(entry => entry.target === screen && entry.attempts < 3)
      .sort((a, b) => a.priority - b.priority)[0];
    if (!job) return;
    if (completed.has(job.url)) { jobs.delete(job.key); schedule(); return; }
    busy = true;
    const request = new AbortController();
    controller = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    job.attempts++;
    try {
      const response = await fetch(job.url, { credentials: 'same-origin', priority: 'low', signal: request.signal });
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error('Preload unavailable');
      }
      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (request.signal.aborted) throw new DOMException('Preload stopped', 'AbortError');
        if (done) break;
        budget -= value.byteLength;
        if (budget < 0) { await reader.cancel(); throw new Error('Preload budget exhausted'); }
        if (job.kind !== 'asset') chunks.push(value);
      }
      if (job.kind !== 'asset') {
        const body = await new Blob(chunks).text();
        if (request.signal.aborted) throw new DOMException('Preload stopped', 'AbortError');
        if (job.kind === 'template') {
          templates.set(job.target, getTemplateResources(body));
          seed(job.target);
        } else {
          const urls = JSON.parse(body);
          if (!Array.isArray(urls)) throw new Error('Invalid preload manifest');
          manifest = urls;
          addMode();
        }
      }
      completed.add(job.url);
      jobs.delete(job.key);
    } catch (_) {
      // Pauses aren't failures. Real failures retry at the back of their
      // priority group, at most three times.
      if (!enabled || !allowed() || screen !== job.target) job.attempts--;
      if (jobs.has(job.key)) {
        jobs.delete(job.key);
        jobs.set(job.key, job);
      }
    } finally {
      clearTimeout(timeout);
      controller = null;
      busy = false;
      schedule();
    }
  }
  function pause() {
    cancelSchedule();
    controller?.abort();
  }
  function resume() {
    if (!screen || !allowed()) return;
    if (!enabled) { api.start(screen); return; }
    seed(screen);
    schedule();
  }
  document.addEventListener('visibilitychange', () => document.hidden ? pause() : resume());
  navigator.connection?.addEventListener?.('change', () => allowed() ? resume() : pause());
  const api = {
    enqueue(urls) {
      const wanted = new Set((urls || []).map(url => new URL(url, location.origin).href));
      for (const [key, job] of jobs) {
        if (job.target === 'battle' && job.priority === 2 && !wanted.has(job.url)) jobs.delete(key);
      }
      for (const url of urls || []) add(url, 'battle');
      schedule();
    },
    selectMode(value) {
      modeId = String(value || 'duels');
      for (const [key, job] of jobs) {
        if (job.url.includes('/bundles/mode-') && !new URL(job.url).pathname.startsWith('/bundles/mode-' + modeId + '.')) jobs.delete(key);
      }
      if (screen === 'battle') seed('battle');
      schedule();
    },
    start(target = 'battle') {
      if (enabled && screen === target) { resume(); return; }
      pause();
      screen = target;
      enabled = false;
      seed(target);
      delayTimer = setTimeout(() => {
        delayTimer = null;
        enabled = true;
        schedule(0);
      }, 1200);
    },
    stop() { enabled = false; screen = null; pause(); },
  };
  return api;
}
