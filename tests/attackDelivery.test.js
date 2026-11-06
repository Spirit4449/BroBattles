const test = require('node:test');
const assert = require('node:assert/strict');
const { DELIVERIES, deliveryOf, clampDeliveryRewind, attackerPose, attachedRectShape, pathSweepShapes,
  shapeTouches } = require('../src/shared/combat/attackDelivery');
const { ATTACK_RUNTIMES, createRuntimeAttack, tickRuntimeAttack } = require('../src/server/core/gameRoom/characterAttackRegistry');
const { getResolvedAttackDescriptor } = require('../src/server/core/gameRoom/attackDescriptorResolver');
const { attackDescriptors } = require('../src/shared/characters');
const { getResolvedCharacterAttackConfig } = require('../src/shared/characters/characterTuning');
const { updateBodyGeometry } = require('../src/server/core/gameRoom/inputManager');
const { damageHitboxSnapshot } = require('../src/server/core/gameRoom/damageHitboxes');
const { HIT_STALENESS_MAX_MS } = require('../src/server/core/gameRoomConfig');

test('every attack runtime and every attack belongs to a delivery with a bounded rewind', () => {
  for (const kind of Object.keys(ATTACK_RUNTIMES)) assert.ok(deliveryOf(kind), `${kind} has a delivery`);
  for (const type of Object.keys(attackDescriptors)) {
    const kind = getResolvedAttackDescriptor(type)?.runtime?.kind;
    if (kind) assert.ok(deliveryOf(kind), `${type} (${kind}) has a delivery`);
  }
  // No delivery rewinds further than the server keeps a claimed view.
  for (const [name, policy] of Object.entries(DELIVERIES)) {
    assert.ok(policy.rewindCapMs <= HIT_STALENESS_MAX_MS, name);
    assert.equal(clampDeliveryRewind(name, 1e9), policy.rewindCapMs);
    assert.equal(clampDeliveryRewind(name, -5), 0);
    assert.equal(clampDeliveryRewind(name, 'x'), 0);
  }
  assert.ok(DELIVERIES.attached.rewindCapMs < DELIVERIES.released.rewindCapMs, 'a dodge counts sooner against melee');
  assert.equal(DELIVERIES.area.rewindCapMs, 0, 'warned areas favor the target');
});

// The server's attached runtime and the attacker's client must test the same
// volume at the same moment of the attack, or a drawn hit becomes a miss.
function serverShapes(type, character, elapsedTimes, { flip = false } = {}) {
  const player = { name: 'A', socketId: 'a', char_class: character, x: 500, y: 300, flip, isAlive: true,
    loaded: true, team: 'team1', effects: {} };
  updateBodyGeometry(player, { geometry: { colliders: [] } });
  const room = { matchData: { editorDebugHitboxes: true }, players: new Map([['a', player]]) };
  const now = 1_000_000;
  const attack = createRuntimeAttack(player, { type, id: type, direction: flip ? -1 : 1 }, now);
  return { player, shapes: elapsedTimes.map((elapsed) => {
    room._damageHitboxes?.clear();
    tickRuntimeAttack(room, attack, now + elapsed);
    return damageHitboxSnapshot(room, now + elapsed)?.[0] || null;
  }) };
}

const close = (a, b) => Math.abs(a - b) < 1e-6;

test('Draven: the client predicts with the server splash volume at every moment of the attack', () => {
  const splash = getResolvedCharacterAttackConfig('draven', 'splash');
  const times = [0, splash.damageStartMs, splash.growDurationMs / 2, splash.growDurationMs, splash.activeWindowMs - 1];
  for (const flip of [false, true]) {
    const { player, shapes } = serverShapes('draven-splash', 'draven', times, { flip });
    times.forEach((elapsed, i) => {
      const [client] = attachedRectShape(attackerPose('draven', player.x, player.y, { flip }), splash, elapsed);
      if (!shapes[i]) { assert.equal(client, undefined, `nothing before damage starts (${elapsed} ms)`); return; }
      for (const edge of ['left', 'right', 'top', 'bottom']) {
        assert.ok(close(client[edge], shapes[i][edge]), `${edge} at ${elapsed} ms, flip ${flip}`);
      }
    });
  }
});

test('Thorg: the client predicts with the server sweep capsules at every moment of the attack', () => {
  const sweep = getResolvedCharacterAttackConfig('thorg', 'sweep');
  const times = [sweep.windupMs + 1, sweep.windupMs + sweep.strikeMs / 3, sweep.windupMs + sweep.strikeMs];
  for (const flip of [false, true]) {
    const direction = flip ? -1 : 1;
    const { player, shapes } = serverShapes('thorg-fall', 'thorg', times, { flip });
    let previous = 0;
    times.forEach((elapsed, i) => {
      const progress = Math.min(1, (elapsed - sweep.windupMs) / sweep.strikeMs);
      const client = pathSweepShapes(attackerPose('thorg', player.x, player.y, { flip }), direction, previous, progress).at(-1);
      previous = progress;
      for (const key of ['a', 'b']) {
        assert.ok(close(client[key].x, shapes[i][key].x) && close(client[key].y, shapes[i][key].y), `${key} at ${elapsed} ms`);
      }
      assert.ok(close(client.radius, shapes[i].radius));
    });
  }
});

test('shape contact covers rects, capsules and sectors against a box', () => {
  const box = { left: 100, right: 140, top: 0, bottom: 100 };
  assert.ok(shapeTouches({ kind: 'rect', left: 130, right: 200, top: 50, bottom: 60 }, box));
  assert.ok(!shapeTouches({ kind: 'rect', left: 141, right: 200, top: 50, bottom: 60 }, box));
  assert.ok(shapeTouches({ kind: 'capsule', a: { x: 0, y: 50 }, b: { x: 95, y: 50 }, radius: 6 }, box));
  assert.ok(!shapeTouches({ kind: 'capsule', a: { x: 0, y: 50 }, b: { x: 90, y: 50 }, radius: 6 }, box));
  const sector = { kind: 'sector', x: 0, y: 50, radius: 100, innerRadius: 0, angle: 0, halfSpread: Math.PI / 6 };
  assert.ok(!shapeTouches(sector, box), 'centre beyond the radius');
  assert.ok(shapeTouches(sector, box, { reach: 24 }), 'reach widens a sector');
  assert.ok(!shapeTouches({ ...sector, angle: Math.PI }, box, { reach: 24 }), 'behind the sector');
});
