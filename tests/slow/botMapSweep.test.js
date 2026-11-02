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

test('Bank Bust roles find reachable siege and lower-lane objectives on the live map', (t) => {
  const time = clock(t);
  const h = makeRoom({ map: 4, characters: ['ninja', 'wizard'], seed: 17 });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  const { bankDecisionSteps } = require('../../src/server/core/bots/bankBust');
  const { finishSteps } = require('../../src/server/core/bots/tactics');
  const effects = require('../../src/server/core/gameRoom/effects/effectManager');
  const { standOn } = require('../../src/server/core/bots/navigation');
  const own = h.room.modeState.vaults[p.team];
  const surface = brain.graph.surfaces.filter(s => s.left <= own.x && s.right >= own.x)
    .sort((a, b) => Math.abs(a.top - own.y) - Math.abs(b.top - own.y))[0];
  Object.assign(p, standOn(surface, p.char_class, own.x));
  h.room.modeState.objects = [];
  h.room.modeState.randomGold.pickups = [];
  brain.retreating = false;
  const context = brain.context(effects.getModifiers(p, time.now()), time.now());
  brain.bankRole = 'raider';
  const siege = finishSteps(bankDecisionSteps(brain, context, [], time.now()));
  assert.equal(siege?.mode, 'bank-siege');
  assert.notEqual(context.routeTo(siege.goal.surfaceId, siege.goal.x), null);
  brain.bankRole = 'flanker';
  const flank = finishSteps(bankDecisionSteps(brain, context, [], time.now()));
  assert.equal(flank?.mode, 'bank-flank');
  assert.ok(flank.goal.y > own.y, 'flanker chooses a lower crossing');
  assert.notEqual(context.routeTo(flank.goal.surfaceId, flank.goal.x), null);
});

test('an unopposed Bank Bust attacker commits across the map and damages the enemy vault', (t) => {
  const time = clock(t);
  const h = makeRoom({ map: 4, characters: ['ninja', 'wizard'], trophies: 2000, seed: 17 });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  const { standOn } = require('../../src/server/core/bots/navigation');
  const own = h.room.modeState.vaults[p.team], enemy = h.room.modeState.vaults.team2;
  const surface = brain.graph.surfaces.filter(s => s.left <= own.x && s.right >= own.x)
    .sort((a, b) => Math.abs(a.top - own.y) - Math.abs(b.top - own.y))[0];
  Object.assign(p, standOn(surface, p.char_class, own.x));
  h.players[1].isAlive = false;
  h.room.botControllers.delete(h.players[1].participantId);
  h.room.modeState.objects = [];
  h.room.modeState.randomGold.pickups = [];
  h.room.modeState.randomGold.spawnPoints = [];
  brain.bankRole = 'raider';
  brain.openingUntil = 0;
  const initial = enemy.coins;
  for (let i = 0; i < 2400 && p.isAlive && enemy.coins >= initial; i++) time.step(h);
  assert.ok(enemy.coins < initial, `did not reach and attack vault: x=${p.x}, goal=${JSON.stringify(brain.decision)}, recoveries=${brain.metrics.recoveries}`);
});
