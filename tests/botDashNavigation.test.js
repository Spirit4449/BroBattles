const test = require('node:test');
const assert = require('node:assert/strict');
const { buildGraph, findRoute, standOn, prepareTraversal } = require('../src/server/core/bots/navigation');
const { stepBody } = require('../src/server/core/bots/physics');
const { getDuelGeometry } = require('../src/shared/duelGeometry');
const { makeRoom } = require('./helpers/botRoom');

const DT = 1000 / 60;
function terrain(kind) {
  const shapes = {
    high: [ ['low', 100, 500, 900], ['high', 330, 650, 640] ],
    gap: [ ['low', 100, 500, 800], ['high', 850, 1150, 800] ],
    shortcut: [ ['low', 100, 500, 900], ['middle', 400, 640, 810], ['high', 200, 480, 725] ],
  };
  return { world: { x: 0, y: 0, width: 1400, height: 1200 },
    colliders: shapes[kind].map(([id, left, right, top]) => ({ id, left, right, top, bottom: top + 25, x: (left + right) / 2,
      collision: { up: true, down: false, left: false, right: false } })) };
}

for (const kind of ['high', 'gap']) {
  test(`dash routing reaches a ${kind === 'high' ? '260px higher platform' : '350px gap'} beyond normal jump range`, () => {
    const geometry = terrain(kind), graph = buildGraph(geometry, 'ninja');
    const options = { startX: 300, goalX: geometry.colliders.at(-1).x };
    assert.equal(findRoute(graph, 'low', 'high', Infinity, options), null);
    const route = findRoute(graph, 'low', 'high', Infinity, { ...options, allowDash: true });
    assert.ok(route?.some(edge => edge.dash));
    const edge = route[0];
    const p = { ...standOn(geometry.colliders[0], 'ninja', edge.takeoffX), isAlive: true };
    const prepared = prepareTraversal(p, edge, geometry, {}, 1000);
    assert.ok(prepared);
    prepared.frames.forEach((input, i) => {
      p.flip = input.direction < 0;
      assert.equal(stepBody(p, input, geometry, DT, 1000 + i * DT).fell, false);
    });
    assert.equal(p.platformId, 'high');
    assert.equal(p.grounded, true);
    assert.equal(p.dashSeq, 1);
    assert.equal(prepareTraversal({ ...p, ...standOn(geometry.colliders[0], 'ninja', edge.takeoffX) }, edge, geometry, {}, 2000), null,
      'a route cannot bypass the shared cooldown');
  });
}

test('dash climb selects a faster direct ascent over two ordinary jumps', () => {
  const graph = buildGraph(terrain('shortcut'), 'ninja');
  const options = { startX: 300, goalX: 340 };
  const ordinary = findRoute(graph, 'low', 'high', Infinity, options);
  const shortcut = findRoute(graph, 'low', 'high', Infinity, { ...options, allowDash: true });
  assert.equal(ordinary.length, 2);
  assert.equal(shortcut.length, 1);
  assert.ok(shortcut[0].dash);
  assert.ok(shortcut[0].duration < ordinary.reduce((ms, edge) => ms + edge.duration, 0));
});

test('routing never promises two dashes on a single charge', () => {
  const edge = (to, dash) => ({ to, dash, takeoffX: 0, landingX: 0, duration: 500, frames: [] });
  const graph = { surfaces: ['a', 'b', 'c'].map(id => ({ id, top: 900 })),
    edges: new Map(), dashEdges: new Map([['a', [edge('b', { x: 0, y: -1 })]], ['b', [edge('c', { x: 0, y: -1 })]]]) };
  assert.equal(findRoute(graph, 'a', 'c', Infinity, { allowDash: true }), null);
  graph.edges.set('b', [edge('c')]);
  assert.equal(findRoute(graph, 'a', 'c', Infinity, { allowDash: true }).length, 2);
});

for (const kind of ['high', 'gap']) for (const character of ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop']) {
  test(`${character} executes a live jump-and-dash route across ${kind} terrain`, t => {
    let now = 1000000;
    t.mock.method(Date, 'now', () => now);
    t.mock.method(console, 'log', () => {});
    const h = makeRoom({ characters: [character, 'ninja'], seed: 17 });
    t.after(() => h.room.cleanup());
    const [p, enemy] = h.players, brain = h.room.botControllers.get(p.participantId);
    const geometry = terrain(kind);
    h.room.geometry = { ...h.room.geometry, ...geometry, mapId: 998 };
    enemy.isAlive = false;
    h.place(p, 300, geometry.colliders[0]);
    brain.random = () => 0.5; brain.openingUntil = 0;
    const context = brain.context({}, now), goal = geometry.colliders.at(-1);
    assert.ok(context.routeTo(goal.id, goal.x)?.some(edge => edge.dash));
    p._dashReadyAt = now + 10000;
    assert.equal(brain.context({}, now).routeTo(goal.id, goal.x), null, 'does not plan an unavailable dash');
    p._dashReadyAt = 0;
    brain.decision = { mode: 'reposition', goal: { surfaceId: goal.id, x: goal.x, y: goal.top } };
    brain.nextDecisionAt = Infinity;
    let arrived = false;
    for (let i = 0; i < 600 && !arrived; i++) {
      now += DT;
      h.tick(now);
      arrived = p.platformId === goal.id && p.grounded && !brain.traversal;
    }
    assert.equal(arrived, true);
    assert.equal(brain.metrics.dashTravel, 1);
    assert.equal(brain.metrics.unforcedFalls, 0);
  });
}

test('all sampled dash routes on duel maps replay their advertised safe landings', () => {
  let replayed = 0;
  for (const map of [1, 2, 3]) {
    const geometry = getDuelGeometry(map), graph = buildGraph(geometry, 'huntress');
    for (const [from, edges] of graph.dashEdges) for (const edge of edges) {
      const p = { ...standOn(graph.surfaces.find(s => s.id === from), 'huntress', edge.takeoffX), isAlive: true };
      edge.frames.forEach((input, i) => {
        p.flip = input.direction < 0;
        assert.equal(stepBody(p, input, geometry, DT, i * DT).fell, false);
      });
      assert.equal(p.grounded, true);
      assert.equal(p.platformId, edge.to);
      assert.equal(p.dashSeq, 1);
      replayed++;
    }
  }
  assert.ok(replayed > 20);
});
