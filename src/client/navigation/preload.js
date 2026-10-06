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
  // Navigation owns these blobs, so a warmed lobby video survives page disposal.
  const videos = new Map();
  const gameplayHolds = new Set();
  let videoBytes = 0;
  let ownVideo;
  let activeJob;
  let measuredMbps;
  let manifest;
  let modeId;
  let screen;
  let enabled = false;
  let busy = false;
  let controller;
  let delayTimer;
  let idleTimer;
  let budget = 24 * 1024 * 1024;
  const allowed = () => !document.hidden && navigator.onLine !== false && !navigator.connection?.saveData && !/^(slow-)?2g$/.test(navigator.connection?.effectiveType || '');
  const relevant = job => job.kind === 'video' || job.target === screen;
  const videoLimit = 8 * 1024 * 1024;
  function videoAllowed(job) {
    if (gameplayHolds.size || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false;
    if (videoBytes + job.bytes > videoLimit || job.bytes > budget) return false;
    // Deliberate previews/rewards still yield to gameplay and data-saver, but
    // must not be silently rejected by an unreliable downlink estimate.
    if (job.interactive) return true;
    const connection = navigator.connection;
    const own = job.url === ownVideo;
    if (!own && /3g/.test(connection?.effectiveType || '')) return false;
    const reported = Number(connection?.downlink);
    const speed = Math.min(reported > 0 ? reported : Infinity, measuredMbps || Infinity);
    // No Network Information API: try one bounded, low-priority download.
    return job.bytes * 8 / (speed * 1000000) <= (own ? 5 : 2.5);
  }
  function interruptVideo() {
    if (activeJob?.kind === 'video') {
      activeJob.preempted = true;
      controller?.abort();
    }
  }

  function add(value, target, priority = 2, kind = 'asset') {
    let url;
    try { url = new URL(value, location.origin); } catch (_) { return; }
    if (url.origin !== location.origin || completed.has(url.href) || jobs.size >= 160) return;
    const key = target + ':' + url.href;
    if (!jobs.has(key)) jobs.set(key, { key, url: url.href, target, priority, kind, attempts: 0 });
    interruptVideo();
  }
  function addMode() {
    for (const url of manifest || []) {
      if (typeof url === 'string' && url.startsWith('/bundles/mode-' + modeId + '.')) add(url, 'battle', 1);
      else if (typeof url === 'string' && url.startsWith('/assets/')) add(url, 'battle', 3);
    }
  }
  function seed(target) {
    if (target === 'cards') return;
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
    const job = [...jobs.values()].filter(entry => relevant(entry) && entry.attempts < 3 &&
      (entry.kind !== 'video' || videoAllowed(entry)))
      .sort((a, b) => a.priority - b.priority)[0];
    if (!job) return;
    if (job.kind !== 'video' && completed.has(job.url)) { jobs.delete(job.key); schedule(); return; }
    busy = true;
    activeJob = job;
    job.preempted = false;
    const request = new AbortController();
    controller = request;
    const started = Date.now();
    let transferred = 0;
    const timeout = setTimeout(() => request.abort(), job.kind === 'video' ? (job.interactive ? 20000 : job.url === ownVideo ? 5000 : 2500) : 15000);
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
        transferred += value.byteLength;
        if (budget < 0) { await reader.cancel(); throw new Error('Preload budget exhausted'); }
        if (job.kind === 'video' && (transferred > job.bytes * 1.1 || videoBytes + transferred > videoLimit)) {
          await reader.cancel();
          throw new Error('Card animation exceeds declared size');
        }
        if (job.kind !== 'asset') chunks.push(value);
      }
      if (job.kind === 'video') {
        const blob = new Blob(chunks, { type: job.url.endsWith('.mov') ? 'video/quicktime' : 'video/webm' });
        const url = URL.createObjectURL(blob);
        videos.set(job.url, url);
        videoBytes += blob.size;
        for (const notify of job.listeners) {
          try { notify(url); } catch (_) { /* A retired view cannot fail warming. */ }
        }
      } else if (job.kind !== 'asset') {
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
      const elapsed = Date.now() - started;
      if (transferred >= 65536 && elapsed >= 50) measuredMbps = transferred * 8 / elapsed / 1000;
    } catch (_) {
      // Pauses aren't failures. Real failures retry at the back of their
      // priority group, at most three times.
      if (!enabled || !allowed() || !relevant(job) || job.preempted) job.attempts--;
      else if (job.kind === 'video') {
        job.attempts = 3; // Cosmetic failures stay static for this request.
        if (request.signal.aborted) measuredMbps = Math.max(0.05, transferred * 8 / Math.max(1, Date.now() - started) / 1000);
      }
      if (jobs.has(job.key)) {
        jobs.delete(job.key);
        jobs.set(job.key, job);
      }
    } finally {
      clearTimeout(timeout);
      controller = null;
      activeJob = null;
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
  navigator.connection?.addEventListener?.('change', () => {
    measuredMbps = undefined;
    for (const job of jobs.values()) if (job.kind === 'video') job.attempts = 0;
    if (activeJob?.kind === 'video' && !videoAllowed(activeJob)) interruptVideo();
    if (allowed()) resume(); else pause();
  });
  window.addEventListener?.('offline', pause);
  window.addEventListener?.('online', resume);
  const api = {
    requestCardAnimation(card, notify = () => {}, { interactive = false } = {}) {
      const path = card?.animationUrl;
      if (!/^\/assets\/player-cards\/([a-z0-9-]+)\/\1-animated\.(webm|mov)$/.test(path || '')) return () => {};
      const url = new URL(path, location.origin).href;
      if (videos.has(url)) { notify(videos.get(url)); return () => {}; }
      const key = 'video:' + url;
      let job = jobs.get(key);
      if (!job) {
        if (jobs.size >= 160) return () => {};
        const bytes = Number(card.animationBytes);
        job = { key, url, kind: 'video', target: 'cards', priority: url === ownVideo ? 4 : 5,
          bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 1024 * 1024, attempts: 0, listeners: new Set() };
        jobs.set(key, job);
      }
      if (interactive && !job.interactive) {
        job.interactive = true;
        job.attempts = 0;
      }
      // Explicit previews follow selected gameplay assets, but needn't wait
      // behind the entire speculative shared-asset warming manifest.
      job.priority = job.interactive ? (url === ownVideo ? 2.4 : 2.5) : url === ownVideo ? 4 : 5;
      job.listeners.add(notify);
      schedule();
      return () => {
        job.listeners.delete(notify);
        if (!job.listeners.size && url !== ownVideo && jobs.get(key) === job) {
          jobs.delete(key);
          if (activeJob === job) interruptVideo();
        }
      };
    },
    warmPlayerCard(card) {
      const next = /^\/assets\/player-cards\/([a-z0-9-]+)\/\1-animated\.(webm|mov)$/.test(card?.animationUrl || '')
        ? new URL(card.animationUrl, location.origin).href : null;
      if (next === ownVideo) return;
      ownVideo = next;
      for (const [key, job] of jobs) if (job.kind === 'video') {
        job.priority = job.interactive ? (job.url === ownVideo ? 2.4 : 2.5) : job.url === ownVideo ? 4 : 5;
        if (!job.listeners.size && job.url !== ownVideo) jobs.delete(key);
      }
      interruptVideo();
      if (next) {
        // Retain only the equipped card's speculative request.
        const release = api.requestCardAnimation(card);
        release();
      }
      schedule();
    },
    holdGameplay() {
      const token = {};
      gameplayHolds.add(token);
      interruptVideo();
      return () => { gameplayHolds.delete(token); schedule(); };
    },
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
