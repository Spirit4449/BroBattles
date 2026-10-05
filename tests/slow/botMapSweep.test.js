// Exhaustive bot movement sweeps across every character and Duel map. These
// take several seconds, so they run with `npm run test:slow` (and
// `npm run test:bots`) rather than the default `npm test`.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('../helpers/botRoom');
const { getDuelGeometry } = require('../../src/shared/physics/duelGeometry');
const { buildGraph } = require('../../src/server/core/bots/navigation');
const characters = ['ninja', 'thorg', 'draven', 'wizard', 'huntress', 'gloop'];

function clock(t) {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  return { now: () => now, step: (h) => { now += 1000 / 60; h.tick(now); } };
}

// Exercise the real executor, not just replay of idealized graph samples. Low
// trophy bots must be able to reach every ordinary Duel platform independently
// of aim, reactions, combat damage and optional tactical movement.
for (const map of [1, 2, 3]) for (const character of characters) {
  test(`${character} at zero trophies executes every map ${map} destination safely`, (t) => {
    const time = clock(t);
    const destinations = buildGraph(getDuelGeometry(map), character).surfaces.filter((s) => s.id !== 'p0');
    for (const destination of destinations) {
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

for (const map of [1, 2, 3]) for (const character of characters) {
  test(`${character} completes a sudden-death escape on map ${map} without resetting its takeoff`, (t) => {
    const time = clock(t);
    const h = makeRoom({ map, characters: [character, 'ninja'], trophies: 0, seed: 17 });
    try {
      const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
      h.players[1].isAlive = false;
      h.place(p, map === 2 ? 980 : 1150);
      const startY = p.y;
      h.room._suddenDeathActive = true;
      h.room._loopStartWallTime = time.now() - h.room.gameMode.getMatchDurationMs();
      // All low landings and takeoff approaches are exposed. The bot must
      // still execute physically valid motion rather than cancelling each think.
      h.room._computePoisonY = () => startY - 5;
      let escaped = false;
      for (let i = 0; i < 900 && p.isAlive; i++) {
        time.step(h);
        if (p.grounded && p.y < startY - 150) { escaped = true; break; }
      }
      assert.ok(escaped, `stalled at ${p.x},${p.y} (${brain.decision?.mode})`);
      assert.equal(brain.metrics.unforcedFalls, 0);
    } finally { h.room.cleanup(); }
  });
}
