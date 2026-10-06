// Exhaustive bot movement sweeps across every character and Duels map (1v1
// and 2v2). These
// take several seconds, so they run with `npm run test:slow` (and
// `npm run test:bots`) rather than the default `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('../helpers/botRoom');
const { getDuelGeometry } = require('../../src/shared/physics/duelGeometry');
const { buildGraph } = require('../../src/server/core/bots/navigation');
const { bounds } = require('../../src/server/core/bots/physics');
const { staticGeometry } = require('../../src/shared/maps/platformMotion');
const { mapDefaults } = require('../../src/shared/maps');
const { mapArena } = require('../../src/shared/maps/arenas');
const duelMaps = mapDefaults.filter((map) => mapArena(map)?.modeId === 'duels').map((map) => map.id);
const characters = ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'];

// Surfaces the bot planner can route to from the ground floor.
function plannedSurfaces(map, character) {
  const geometry = getDuelGeometry(map);
  const start = geometry.colliders.find((c) => c.collision.up);
  const graph = buildGraph(staticGeometry(geometry), character);
  const seen = new Set([start.id]), queue = [start.id];
  while (queue.length) {
    for (const edge of graph.edges.get(queue.shift()) || []) {
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push(edge.to); }
    }
  }
  const others = graph.surfaces.filter((s) => s.id !== start.id);
  return { geometry, start, reachable: others.filter((s) => seen.has(s.id)), unreachable: others.filter((s) => !seen.has(s.id)) };
}

function clock(t) {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  return { now: () => now, step: (h) => { now += 1000 / 60; h.tick(now); } };
}

// Exercise the real executor, not just replay of idealized graph samples. Low
// trophy bots must be able to reach every static Duel platform (the ones bots
// plan over) independently of aim, reactions, combat damage and optional
// tactical movement. Bots start on the ground floor `place` uses. On maps
// without moving platforms every surface must be routable.
for (const map of duelMaps) for (const character of characters) {
  const { geometry, reachable, unreachable } = plannedSurfaces(map, character);
  if (geometry.movingColliders.length && unreachable.length) {
    test(`${character} routes to map ${map} ${unreachable.map((s) => s.id).join(', ')}`,
      { todo: 'only reachable by riding a moving platform, which bots do not plan yet' }, () => {
        assert.deepEqual(unreachable, []);
      });
  }
  test(`${character} at zero trophies executes every map ${map} destination safely`, (t) => {
    const time = clock(t);
    if (!geometry.movingColliders.length) assert.deepEqual(unreachable.map((s) => s.id), []);
    for (const destination of reachable) {
      const h = makeRoom({ map, characters: [character, 'ninja'], trophies: 0, seed: 17 });
      try {
        const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
        h.players[1].isAlive = false;
        h.place(p, map === 2 ? 980 : 1150);
        brain.retreating = false;
        brain.openingUntil = 0;
        brain.nextDecisionAt = Infinity;
        brain.decision = { mode: 'reposition', goal: { x: destination.x, y: destination.top, surfaceId: destination.id } };
        let arrived = false;
        for (let i = 0; i < 1800 && p.isAlive; i++) {
          time.step(h);
          if (p.grounded && p.platformId === destination.id && !brain.traversal && !brain.maneuver && Math.abs(p.vx) < 12) { arrived = true; break; }
        }
        assert.ok(arrived, `failed to reach ${destination.id}`);
        assert.equal(brain.metrics.unforcedFalls, 0);
      } finally { h.room.cleanup(); }
    }
  });
}

for (const map of duelMaps) for (const character of characters) {
  test(`${character} completes a sudden-death escape on map ${map} without resetting its takeoff`, (t) => {
    const time = clock(t);
    const h = makeRoom({ map, characters: [character, 'ninja'], trophies: 0, seed: 17 });
    try {
      const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
      h.players[1].isAlive = false;
      h.place(p, map === 2 ? 980 : 1150);
      const poisonY = p.y - 5;
      h.room._suddenDeathActive = true;
      h.room._loopStartWallTime = time.now() - h.room.gameMode.getMatchDurationMs();
      // All low landings and takeoff approaches are exposed. The bot must
      // still execute physically valid motion rather than cancelling each think,
      // land on ground above the gas and then stay out of it.
      h.room._computePoisonY = () => poisonY;
      let escapedAt = null;
      for (let i = 0; i < 900 && p.isAlive; i++) {
        time.step(h);
        if (escapedAt === null) {
          if (p.grounded && bounds(p).bottom < poisonY) escapedAt = i;
        } else {
          assert.ok(bounds(p).bottom < poisonY, `returned to the gas at ${p.x},${p.y} (${brain.decision?.mode})`);
        }
      }
      assert.ok(escapedAt !== null, `stalled at ${p.x},${p.y} (${brain.decision?.mode})`);
      assert.equal(brain.metrics.unforcedFalls, 0);
    } finally { h.room.cleanup(); }
  });
}
