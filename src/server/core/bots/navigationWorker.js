const { parentPort } = require('node:worker_threads');
const { buildGraph } = require('./navigation');
const { packGraph } = require('./navigationPack');

// Graphs go back packed (typed arrays, transferred) so receiving one costs the
// game thread a few milliseconds instead of a ~150 ms structured clone.
parentPort.on('message', ({ key, geometry, character, modifiers }) => {
  const started = performance.now();
  try {
    const { packed, transfer } = packGraph(buildGraph(geometry, character, modifiers));
    parentPort.postMessage({ key, packed, durationMs: performance.now() - started, sentAt: Date.now() }, transfer);
  } catch (error) {
    parentPort.postMessage({ key, error: error.message, durationMs: performance.now() - started });
  }
});
