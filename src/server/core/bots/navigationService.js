const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { characterBody } = require('../../../shared/physics/duelGeometry');
const { buildGraph, markGraphStatic } = require('./navigation');
const { unpackGraph } = require('./navigationPack');
const { netTrace } = require('../gameRoom/netTraceRecorder');

// Requests not repeated for this long are dropped from the build queue: the
// bots that wanted them have moved on (a wall fell, a buff ended).
const STALE_REQUEST_MS = 3000;
// A geometry differing from a built one by at most this many colliders (Bank
// Bust walls) borrows that graph's routes while its own builds.
const FALLBACK_COLLIDER_DIFF = 6;

const colliderKey = (r) => `${r.id}:${r.left},${r.top},${r.right},${r.bottom}`;

// The live server opts in; deterministic offline simulations retain buildGraph.
// Never construct traversal graphs on the live game's event loop, even on a miss.
// One worker: on the 4-core Pi a second one slowed every build to ~10 s and
// the game thread with it (memory bandwidth), for a shorter queue.
function createNavigationService({ limit = 32, workers = 1, log = console.info } = {}) {
  const entries = new Map(), geometryKeys = new WeakMap();
  const queue = new Set();
  const pool = [];
  let closed = false;
  let readyVersion = 0;

  function finish(entry, graph, error) {
    entry.pending = false;
    entry.queued = false;
    queue.delete(entry);
    if (graph) { entry.graph = markGraphStatic(graph); entry.ready = true; entry.readyAt = Date.now(); entry.fallback = null; readyVersion++; }
    entry.retryAt = error ? Date.now() + 30000 : Infinity;
    entry.resolve?.(entry.graph);
  }

  function onMessage(slot, { key, packed, error, durationMs, sentAt }) {
    slot.busy = null;
    const entry = entries.get(key);
    if (entry?.pending) {
      const unpackStart = performance.now();
      const graph = packed ? unpackGraph(packed, entry.geometry) : null;
      const unpackMs = performance.now() - unpackStart;
      finish(entry, graph, error || !graph);
      const record = { character: entry.character, modifiers: entry.modifiers, buildMs: durationMs, error,
        transferMs: Number.isFinite(sentAt) ? Date.now() - sentAt : null, unpackMs,
        queueMs: performance.now() - entry.started - (durationMs || 0) };
      log('[bots:navigation]', JSON.stringify(record));
      netTrace.noteGlobal({ kind: 'nav', ...record, stillPending: queue.size + pool.filter(w => w.busy).length });
    }
    pump();
  }

  function startWorker(slot) {
    const current = slot.worker = new Worker(require.resolve('./navigationWorker'));
    current.on('message', (message) => onMessage(slot, message));
    const failed = error => {
      if (slot.worker !== current) return;
      slot.worker = null;
      const entry = slot.busy; slot.busy = null;
      if (entry?.pending) finish(entry, null, true);
      log('[bots:navigation-error]', String(error));
      pump();
    };
    current.on('error', failed);
    current.on('exit', code => failed(`worker exited (${code})`));
    return current;
  }

  // Hand the most recently requested live job to each idle worker.
  function pump() {
    if (closed) return;
    const now = Date.now();
    for (const entry of [...queue]) {
      if (now - entry.lastRequested > STALE_REQUEST_MS) {
        queue.delete(entry); entry.queued = false; entry.pending = false; entry.retryAt = 0;
        entry.resolve?.(entry.graph);
      }
    }
    while (pool.length < workers) pool.push({ worker: null, busy: null });
    for (const slot of pool) {
      if (slot.busy || !queue.size) continue;
      let next = null;
      for (const entry of queue) if (!next || entry.lastRequested > next.lastRequested) next = entry;
      queue.delete(next);
      slot.busy = next;
      try {
        const worker = slot.worker || startWorker(slot);
        worker.ref();
        worker.postMessage({ key: next.key, geometry: next.geometry, character: next.character, modifiers: next.modifiers });
      } catch (error) { slot.busy = null; finish(next, null, true); log('[bots:navigation-error]', error.message); }
    }
    // Idle workers must not keep the process alive.
    for (const slot of pool) if (!slot.busy) slot.worker?.unref();
  }

  // While a graph for a changed wall layout builds, keep routing with the most
  // recent graph for the same character and buffs on nearly the same geometry,
  // checked against the current walls (walks; takeoffs revalidate every edge).
  function fallbackFor(entry) {
    if (entry.fallback?.source?.ready) return entry.fallback.graph;
    // Look again only once another graph has finished.
    if (entry.fallbackCheckedAt === readyVersion) return null;
    entry.fallbackCheckedAt = readyVersion;
    const keys = entry.colliderKeys ||= new Set(entry.geometry.colliders.map(colliderKey));
    let best = null;
    for (const other of entries.values()) {
      if (other === entry || !other.ready || other.character !== entry.character ||
          other.modKey !== entry.modKey || other.geometry.world?.width !== entry.geometry.world?.width ||
          other.geometry.world?.height !== entry.geometry.world?.height) continue;
      const otherKeys = other.colliderKeys ||= new Set(other.geometry.colliders.map(colliderKey));
      let diff = 0;
      for (const k of keys) if (!otherKeys.has(k)) diff++;
      for (const k of otherKeys) if (!keys.has(k)) diff++;
      if (diff <= FALLBACK_COLLIDER_DIFF && (!best || other.readyAt > best.readyAt)) best = other;
    }
    if (!best) return null;
    const surfaces = best.graph.surfaces.filter(s => keys.has(colliderKey(s)));
    const graph = markGraphStatic({ ...best.graph, surfaces, geometry: entry.geometry });
    entry.fallback = { source: best, graph };
    return graph;
  }

  function getEntry(geometry, character, modifiers = {}) {
    let hash = geometryKeys.get(geometry);
    if (!hash) {
      hash = createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
      geometryKeys.set(geometry, hash);
    }
    const mods = { speedMult: modifiers.speedMult ?? 1, jumpMult: modifiers.jumpMult ?? 1 };
    const modKey = `${mods.speedMult}:${mods.jumpMult}`;
    const key = `${hash.slice(0, 32)}:${character}:${modKey}`;
    let entry = entries.get(key);
    if (entry) { entries.delete(key); entries.set(key, entry); }
    if (!entry) {
      const surfaces = geometry.colliders.filter(r => r.collision.up && r.right - r.left >= 12);
      // A surface-only graph permits safe same-platform walking and combat while
      // the worker prepares routes. Never reuse routes built for different buffs.
      entry = { key, geometry, character, modifiers: mods, modKey, retryAt: 0, ready: false, lastRequested: Date.now(),
        graph: markGraphStatic({ geometry, character, surfaces, body: characterBody(character),
          edges: new Map(surfaces.map(s => [s.id, []])) }) };
      for (const [oldKey, old] of entries) {
        if (entries.size < limit) break;
        if (!old.pending) entries.delete(oldKey);
      }
      if (entries.size >= limit || closed) return { ...entry, promise: Promise.resolve(entry.graph) };
      entries.set(key, entry);
    }
    entry.lastRequested = Date.now();
    if (!closed && !entry.ready && !entry.pending && Date.now() >= entry.retryAt) {
      entry.pending = true; entry.queued = true; entry.started = performance.now();
      entry.promise = new Promise(resolve => { entry.resolve = resolve; });
      queue.add(entry);
      pump();
    }
    return entry;
  }

  return {
    getGraph(geometry, character, modifiers) {
      const entry = getEntry(geometry, character, modifiers);
      return entry.ready ? entry.graph : (fallbackFor(entry) || entry.graph);
    },
    prepare: (geometry, character, modifiers) => getEntry(geometry, character, modifiers).promise,
    async close() {
      closed = true;
      for (const entry of entries.values()) if (entry.pending) finish(entry, null, true);
      const running = pool.splice(0).map(slot => slot.worker).filter(Boolean);
      await Promise.all(running.map(worker => worker.terminate()));
      entries.clear();
    },
  };
}
let liveService;
function enableAsyncNavigation(options = {}) {
  liveService ||= createNavigationService(options);
}
async function closeAsyncNavigation() {
  const service = liveService;
  liveService = null;
  if (service) await service.close();
}
function getNavigationGraph(...args) {
  return liveService ? liveService.getGraph(...args) : buildGraph(...args);
}
module.exports = { createNavigationService, enableAsyncNavigation, closeAsyncNavigation, getNavigationGraph };
