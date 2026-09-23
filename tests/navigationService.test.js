const test = require('node:test');
const assert = require('node:assert/strict');
const { createNavigationService } = require('../src/server/core/bots/navigationService');
const { getDuelGeometry } = require('../src/shared/duelGeometry');
const { buildGraph } = require('../src/server/core/bots/navigation');

test('worker builds equivalent routes without blocking, reuses rooms and separates buffs', async () => {
  const service = createNavigationService({ log() {} });
  try {
    const geometry = getDuelGeometry(1);
    const fallback = service.getGraph(geometry, 'ninja');
    assert.ok(fallback.surfaces.length > 0);
    assert.ok([...fallback.edges.values()].every(edges => edges.length === 0));
    let heartbeat = false;
    setImmediate(() => { heartbeat = true; });
    const graph = await service.prepare(geometry, 'ninja');
    assert.equal(heartbeat, true);
    assert.deepEqual(graph.edges, buildGraph(geometry, 'ninja').edges);
    assert.deepEqual(graph.dashEdges, buildGraph(geometry, 'ninja').dashEdges);
    assert.equal(service.getGraph(structuredClone(geometry), 'ninja'), graph);
    const modifiers = { speedMult: 1.25, jumpMult: 1.55 };
    const waiting = service.getGraph(geometry, 'ninja', modifiers);
    assert.notEqual(waiting, graph);
    assert.ok([...waiting.edges.values()].every(edges => edges.length === 0));
    const buffed = await service.prepare(geometry, 'ninja', modifiers);
    assert.deepEqual(buffed.edges, buildGraph(geometry, 'ninja', modifiers).edges);
    const changed = structuredClone(geometry);
    changed.colliders[0].top -= 1;
    assert.notEqual(service.getGraph(changed, 'ninja'), graph);
  } finally { await service.close(); }
});
