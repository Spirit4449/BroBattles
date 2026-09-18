const { Worker } = require('node:worker_threads');
const { createHash } = require('node:crypto');
const { characterBody } = require('../../../shared/duelGeometry');
const { buildGraph } = require('./navigation');

// The live server opts in; deterministic offline simulations retain buildGraph.
// Never construct traversal graphs on the live game's event loop, even on a miss.
function createNavigationService({ limit = 32, log = console.info } = {}) {
  const entries = new Map(), geometryKeys = new WeakMap();
  let worker = null, closed = false;
  function finish(entry, graph, error) {
    entry.pending = false;
    if (graph) entry.graph = { ...graph, geometry: entry.geometry };
    entry.retryAt = error ? Date.now() + 30000 : Infinity;
    entry.resolve(entry.graph);
  }
  function startWorker() {
    if (worker) return worker;
    const current = worker = new Worker(require.resolve('./navigationWorker'));
    current.on('message', ({ key, graph, error, durationMs }) => {
      const entry = entries.get(key);
      if (!entry?.pending) return;
      finish(entry, graph, error);
      log('[bots:navigation]', JSON.stringify({ character: entry.character,
        modifiers: entry.modifiers, buildMs: durationMs, error,
        queueMs: performance.now() - entry.started - (durationMs || 0) }));
      if (![...entries.values()].some(e => e.pending)) current.unref();
    });
    const failed = error => {
      if (worker !== current) return;
      worker = null;
      for (const entry of entries.values()) if (entry.pending) finish(entry, null, true);
      log('[bots:navigation-error]', String(error));
    };
    current.on('error', failed);
    current.on('exit', code => failed(`worker exited (${code})`));
    return current;
  }
  function getEntry(geometry, character, modifiers = {}) {
    let hash = geometryKeys.get(geometry);
    if (!hash) {
      hash = createHash('sha256').update(JSON.stringify(geometry)).digest('hex');
      geometryKeys.set(geometry, hash);
    }
    const mods = { speedMult: modifiers.speedMult ?? 1, jumpMult: modifiers.jumpMult ?? 1 };
    const key = `${hash}:${character}:${mods.speedMult}:${mods.jumpMult}`;
    let entry = entries.get(key);
    if (entry) { entries.delete(key); entries.set(key, entry); }
    if (!entry) {
      const surfaces = geometry.colliders.filter(r => r.collision.up && r.right - r.left >= 12);
      // A surface-only graph permits safe same-platform walking and combat while
      // the worker prepares routes. Never reuse routes built for different buffs.
      entry = { geometry, character, modifiers: mods, retryAt: 0,
        graph: { geometry, character, surfaces, body: characterBody(character),
          edges: new Map(surfaces.map(s => [s.id, []])) } };
      for (const [oldKey, old] of entries) {
        if (entries.size < limit) break;
        if (!old.pending) entries.delete(oldKey);
      }
      if (entries.size >= limit || closed) return { ...entry, promise: Promise.resolve(entry.graph) };
      entries.set(key, entry);
    }
    if (!closed && !entry.pending && Date.now() >= entry.retryAt) {
      entry.pending = true; entry.started = performance.now();
      entry.promise = new Promise(resolve => { entry.resolve = resolve; });
      try { const current = startWorker(); current.ref(); current.postMessage({ key, geometry, character, modifiers: mods }); }
      catch (error) { finish(entry, null, true); log('[bots:navigation-error]', error.message); }
    }
    return entry;
  }
  return {
    getGraph: (geometry, character, modifiers) => getEntry(geometry, character, modifiers).graph,
    prepare: (geometry, character, modifiers) => getEntry(geometry, character, modifiers).promise,
    async close() {
      closed = true;
      for (const entry of entries.values()) if (entry.pending) finish(entry, null, true);
      const current = worker; worker = null;
      if (current) await current.terminate();
      entries.clear();
    },
  };
}
let liveService;
function enableAsyncNavigation() { liveService ||= createNavigationService(); }
function getNavigationGraph(...args) {
  return liveService ? liveService.getGraph(...args) : buildGraph(...args);
}
module.exports = { createNavigationService, enableAsyncNavigation, getNavigationGraph };
