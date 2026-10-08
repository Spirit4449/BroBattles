// Discover both script tags and the ordered loadScript calls in game.html.
// Reading a template must never execute it or initialize the other screen.
export function getTemplateResources(html) {
  return [...new Set([...html.matchAll(/["'](\/(?:bundles|styles)\/[^"'\s]+\.(?:js|css)(?:\?[^"'\s]*)?)["']/g)]
    .map(match => match[1]))].filter(url => !/\/navigation[.]/.test(url));
}

// Only download bytes into the HTTP cache. Discovery and assets share a queue,
// cancellation controller. The session byte budget limits speculation, not
// playback the user is currently viewing.
export function createBattlePreloader() {
  const jobs = new Map();
  const templates = new Map();
  const completed = new Set();
  // Navigation owns these blobs, so a warmed lobby video survives page disposal.
  // Map order is least recently used first.
  const videos = new Map();
  const gameplayHolds = new Set();
  let videoBytes = 0;
  let ownVideo;
  // The matched roster's cards are retained speculative downloads, like ownVideo.
  let rosterVideos = new Set();
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
  const retained = url => url === ownVideo || rosterVideos.has(url);
  const foreground = job => job.kind === 'video' && job.interactive;
  function videoPriority(url, interactive) {
    const rank = url === ownVideo ? 0 : rosterVideos.has(url) ? 1 : 2;
    return (interactive ? [2.4, 2.45, 2.5] : [4, 4.5, 5])[rank];
  }
  // Re-rank queued cards after the equipped card or roster changes, dropping
  // speculative downloads nothing wants any more.
  function retarget() {
    for (const [key, job] of jobs) if (job.kind === 'video') {
      job.priority = videoPriority(job.url, job.interactive);
      if (!job.listeners.size && !retained(job.url)) jobs.delete(key);
    }
    interruptVideo();
  }
  // Card paths are fixed; the catalog's content hash makes the URL immutable.
  function cardVideoUrl(card) {
    const path = card?.animationUrl;
    if (!/^\/assets\/player-cards\/([a-z0-9-]+)\/\1-animated\.(webm|mov)$/.test(path || '')) return null;
    const url = new URL(path, location.origin);
    if (/^[a-f0-9]{12,64}$/.test(card.animationVersion || '')) url.searchParams.set('v', card.animationVersion);
    return url.href;
  }
  // Pending/paused decoders retain a lease until their source is discarded.
  function makeRoom(bytes, evict = false) {
    let available = videoLimit - videoBytes;
    for (const [url, entry] of videos) {
      if (available >= bytes) break;
      if (retained(url) || entry.listeners.size) continue;
      available += entry.size;
      if (evict) {
        videos.delete(url);
        videoBytes -= entry.size;
        URL.revokeObjectURL?.(entry.objectUrl);
      }
    }
    return available >= bytes;
  }
  function videoAllowed(job) {
    if (gameplayHolds.size || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return false;
    if ((!foreground(job) && job.bytes > budget) || job.bytes > videoLimit) return false;
    const wanted = job.interactive || retained(job.url);
    if (videoBytes + job.bytes > videoLimit && !(wanted && makeRoom(job.bytes))) return false;
    // Visible playback still yields to gameplay and data saver, but must not
    // be silently rejected by an unreliable downlink estimate.
    if (job.interactive) return true;
    const connection = navigator.connection;
    if (!wanted && /3g/.test(connection?.effectiveType || '')) return false;
    const reported = Number(connection?.downlink);
    const speed = Math.min(reported > 0 ? reported : Infinity, measuredMbps || Infinity);
    // No Network Information API: try one bounded, low-priority download.
    return job.bytes * 8 / (speed * 1000000) <= (wanted ? 5 : 2.5);
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
    if (!enabled || busy || !allowed() || delayTimer || idleTimer) return;
    delayTimer = setTimeout(() => {
      delayTimer = null;
      const run = () => { idleTimer = null; void pump(); };
      idleTimer = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 1000 }) : setTimeout(run, 0);
    }, delay);
  }
  async function pump() {
    if (!enabled || busy || !allowed()) return;
    const job = [...jobs.values()].filter(entry => relevant(entry) && entry.attempts < 3 && (budget > 0 || foreground(entry)) &&
      (entry.kind !== 'video' || videoAllowed(entry)))
      .sort((a, b) => a.priority - b.priority)[0];
    if (!job) return;
    if (job.kind === 'video') makeRoom(job.bytes, true);
    if (job.kind !== 'video' && completed.has(job.url)) { jobs.delete(job.key); schedule(); return; }
    busy = true;
    activeJob = job;
    job.preempted = false;
    const request = new AbortController();
    controller = request;
    const started = Date.now();
    let transferred = 0;
    let retryable = true;
    const timeout = setTimeout(() => request.abort(), job.kind === 'video' ? (job.interactive ? 20000 : retained(job.url) ? 5000 : 2500) : 15000);
    job.attempts++;
    try {
      const response = await fetch(job.url, { credentials: 'same-origin', priority: 'low', signal: request.signal });
      if (!response.ok || !response.body) {
        retryable = response.status >= 500 || response.status === 408 || response.status === 429;
        await response.body?.cancel();
        throw new Error('Preload unavailable');
      }
      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();
        if (request.signal.aborted) throw new DOMException('Preload stopped', 'AbortError');
        if (done) break;
        transferred += value.byteLength;
        if (!foreground(job)) {
          budget -= value.byteLength;
          if (budget < 0) { await reader.cancel(); throw new Error('Preload budget exhausted'); }
        }
        if (job.kind === 'video' && (transferred > job.bytes * 1.1 || videoBytes + transferred > videoLimit)) {
          retryable = false;
          await reader.cancel();
          throw new Error('Card animation exceeds declared size');
        }
        if (job.kind !== 'asset') chunks.push(value);
      }
      if (job.kind === 'video') {
        const blob = new Blob(chunks, { type: new URL(job.url).pathname.endsWith('.mov') ? 'video/quicktime' : 'video/webm' });
        const url = URL.createObjectURL(blob);
        videos.set(job.url, { objectUrl: url, size: blob.size, listeners: job.listeners });
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
        // Visible playback can recover from a transient server/connection
        // failure. Speculation and terminal media failures do not retry.
        if (!foreground(job) || !retryable) job.attempts = 3;
        if (request.signal.aborted && !foreground(job)) measuredMbps = Math.max(0.05, transferred * 8 / Math.max(1, Date.now() - started) / 1000);
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
      const url = cardVideoUrl(card);
      if (!url) return () => {};
      const cached = videos.get(url);
      if (cached) {
        videos.delete(url);
        videos.set(url, cached);
        cached.listeners.add(notify);
        notify(cached.objectUrl);
        return () => { cached.listeners.delete(notify); schedule(); };
      }
      const key = 'video:' + url;
      let job = jobs.get(key);
      if (!job) {
        if (jobs.size >= 160) return () => {};
        const bytes = Number(card.animationBytes);
        job = { key, url, kind: 'video', target: 'cards', priority: videoPriority(url, false),
          bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : 1024 * 1024, attempts: 0, listeners: new Set() };
        jobs.set(key, job);
      }
      if (interactive && (!job.interactive || !job.listeners.size)) {
        job.interactive = true;
        job.attempts = 0;
      }
      // Visible cards follow selected gameplay assets, but needn't wait
      // behind the entire speculative shared-asset warming manifest.
      job.priority = videoPriority(url, job.interactive);
      job.listeners.add(notify);
      schedule();
      return () => {
        job.listeners.delete(notify);
        if (!job.listeners.size && !retained(url) && jobs.get(key) === job) {
          jobs.delete(key);
          if (activeJob === job) interruptVideo();
        }
        schedule();
      };
    },
    warmPlayerCard(card) {
      const next = cardVideoUrl(card);
      if (next === ownVideo) return;
      ownVideo = next;
      retarget();
      if (next) {
        // Retain only the equipped and roster cards' speculative requests.
        const release = api.requestCardAnimation(card);
        release();
      }
      schedule();
    },
    // The players about to share a battle; their cards are downloaded at a
    // retained speculative priority right behind the local player's card.
    warmRosterCards(cards) {
      const entries = (cards || []).map(card => [cardVideoUrl(card), card]).filter(([url]) => url);
      const next = new Set(entries.map(([url]) => url));
      if (next.size === rosterVideos.size && [...next].every(url => rosterVideos.has(url))) return;
      rosterVideos = next;
      retarget();
      for (const [, card] of entries) api.requestCardAnimation(card)();
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
