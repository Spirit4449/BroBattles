const test = require('node:test');
const assert = require('node:assert/strict');
const { createNavigationService } = require('../src/server/core/bots/navigationService');
const { getDuelGeometry } = require('../src/shared/physics/duelGeometry');
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

test('a new wall borrows the built routes, walks against the new geometry, and switches when its own graph lands', async () => {
  const service = createNavigationService({ log() {} });
  try {
    const geometry = getDuelGeometry(1);
    const graph = await service.prepare(geometry, 'ninja');
    const floor = graph.surfaces.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
    const wall = { id: 'wall-test', left: floor.left + 200, right: floor.left + 248, top: floor.top - 96, bottom: floor.top,
      collision: { up: true, down: true, left: true, right: true } };
    const walled = { ...geometry, colliders: [...geometry.colliders, wall] };
    const borrowed = service.getGraph(walled, 'ninja');
    assert.notEqual(borrowed, graph);
    assert.equal(borrowed.edges, graph.edges, 'routes come from the built graph');
    assert.equal(borrowed.geometry, walled, 'walks are checked against the walls that stand now');
    assert.equal(service.getGraph(walled, 'ninja'), borrowed, 'the borrowed graph is stable between thinks');
    // Buffs never borrow: a jump built for one buff does not fit another.
    assert.ok([...service.getGraph(walled, 'ninja', { speedMult: 1.5 }).edges.values()].every(list => list.length === 0));
    const own = await service.prepare(walled, 'ninja');
    assert.notEqual(own, borrowed);
    assert.equal(service.getGraph(walled, 'ninja'), own);
    assert.ok(own.surfaces.some(s => s.id === 'wall-test'), 'the wall top is a surface of its own graph');
  } finally { await service.close(); }
});

test('a graph for a changed wall layout reuses the moves the wall cannot reach and equals a full build', () => {
  const navigationPath = require.resolve('../src/server/core/bots/navigation');
  const freshNavigation = () => { delete require.cache[navigationPath]; return require(navigationPath); };
  const navigation = freshNavigation();
  const geometry = getDuelGeometry(1);
  const before = navigation.buildGraph(geometry, 'ninja');
  const floor = before.surfaces.reduce((a, b) => (b.right - b.left > a.right - a.left ? b : a));
  const wall = { id: 'wall-test', left: floor.left + 200, right: floor.left + 248, top: floor.top - 96, bottom: floor.top,
    collision: { up: true, down: true, left: true, right: true } };
  for (const colliders of [[...geometry.colliders, wall], geometry.colliders]) {
    const changed = { ...geometry, colliders };
    const patched = navigation.buildGraph(changed, 'ninja');
    const full = freshNavigation().buildGraph(structuredClone(changed), 'ninja');
    assert.deepEqual(patched.surfaces, full.surfaces);
    assert.deepEqual(patched.edges, full.edges);
    assert.deepEqual(patched.dashEdges, full.dashEdges);
  }
  const walled = freshNavigation();
  walled.buildGraph(geometry, 'ninja');
  const after = walled.buildGraph({ ...geometry, colliders: [...geometry.colliders, wall] }, 'ninja');
  const kept = before.surfaces.filter(s => after.edges.get(s.id) === walled.buildGraph(geometry, 'ninja').edges.get(s.id));
  assert.ok(kept.length > 0, 'surfaces far from the wall keep their moves');
  assert.ok(kept.length < before.surfaces.length, 'surfaces near the wall are simulated again');
});
