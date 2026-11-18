const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeBotBehaviorRoom } = require('../helpers/botRoom');
const { bounds } = require('../../src/server/core/physics/bodySolver');
const { getDuelGeometry } = require('../../src/shared/physics/duelGeometry');
const effects = require('../../src/shared/combat/runtime/effects/effectManager');

test('bots climb the Bank Bust routes to the catwalks and in and out of the tunnel', (t) => {
  for (const [startId, goalId] of [
    ['chamber-l-3-body', 'gantry-l-body'],
    ['hill-top-body', 'gantry-centre-body'],
    ['tunnel-1-body', 'floor-l-body'],
    ['shelf-l-body', 'tunnel-2-body'],
    ['floor-l-body', 'tunnel-3-body'],
    ['hill-top-body', 'tunnel-3-body'],
  ]) {
    const h = makeBotBehaviorRoom(t, ['ninja', 'ozzy']);
    h.room.geometry = getDuelGeometry(4);
    const start = h.room.geometry.colliders.find((surface) => surface.id === startId);
    const goal = h.room.geometry.colliders.find((surface) => surface.id === goalId);
    h.place(h.p, start.x, start);
    h.players[1].isAlive = false;
    h.brain.openingUntil = 0;
    h.brain.nextIdleAt = Infinity;
    h.brain.random = () => 0.5;
    h.brain.retreating = false;
    h.brain.context(effects.getModifiers(h.p, h.now()), h.now());
    h.brain.decision = { mode: 'reposition', goal: { x: goal.x, y: goal.top, surfaceId: goal.id } };
    h.brain.nextDecisionAt = Infinity;

    let arrived = false;
    for (let i = 0; i < 720 && !arrived; i++) {
      h.advance(1);
      const feet = bounds(h.p).bottom;
      arrived = Math.abs(feet - goal.top) < 6 && h.p.x >= goal.left && h.p.x <= goal.right;
    }
    assert.equal(arrived, true, `${startId} to ${goalId}, stopped at ${h.p.x},${h.p.y}`);
  }
});
