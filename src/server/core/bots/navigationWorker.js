const { parentPort } = require('node:worker_threads');
const { buildGraph } = require('./navigation');

parentPort.on('message', ({ key, geometry, character, modifiers }) => {
  const started = performance.now();
  try {
    const graph = buildGraph(geometry, character, modifiers);
    parentPort.postMessage({ key, graph, durationMs: performance.now() - started });
  } catch (error) {
    parentPort.postMessage({ key, error: error.message });
  }
});
