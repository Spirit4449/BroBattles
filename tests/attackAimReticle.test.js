const { test, describe } = require('node:test');
const assert = require('node:assert/strict');

describe("Aim guides", () => {

  const { resolveAttackAimContext } = require('../src/client/game/characters/shared/attackAim.js');
  const { resolveGloopHookSocket } = require('../src/shared/characters/gloopHookGeometry.js');

  test('Gloop super guide starts at the same visible-body socket as the fired hand', () => {
    const player = { x: 200, y: 300, width: 128, height: 128,
      displayWidth: 153.6, displayHeight: 153.6,
      body: { width: 33.6, height: 45.6, center: { x: 200, y: 350 } } };
    const state = resolveAttackAimContext({ character: 'gloop', player,
      family: 'special', pointerWorldX: 900, pointerWorldY: 350, quick: false });
    const firedFrom = resolveGloopHookSocket(player, state.angle);
    assert.ok(Math.abs(state.anchorX - firedFrom.x) < 0.001);
    assert.ok(Math.abs(state.anchorY - firedFrom.y) < 0.001);
    assert.equal(state.baseX, state.anchorX);
    assert.equal(state.baseY, state.anchorY);
  });

});

describe("Quick attack direction", () => {
  const { getNearestOpponentDirection, resolveAttackAimContext } = require('../src/client/game/characters/shared/attackAim');

  test('quick direction selects the nearest living visible opponent and falls back to facing', () => {
    const player = { x: 300, y: 300, flipX: false };
    const enemy = (x, y, extra = {}) => ({ opponent: { x, y, active: true }, opCurrentHealth: 100, ...extra });
    assert.equal(getNearestOpponentDirection(player, {
      left: enemy(200, 300), right: enemy(320, 600),
      dead: enemy(310, 300, { opCurrentHealth: 0 }),
      hidden: enemy(305, 300, { _powerupInvisible: true }),
    }), -1);
    assert.equal(getNearestOpponentDirection(player, {}), 1);
    assert.equal(getNearestOpponentDirection({ ...player, flipX: true }, {}), -1);
  });

  test('quick attacks match the ordinary default trajectory facing the chosen side; aimed attacks ignore it', () => {
    for (const character of ['sparrow', 'gloop', 'ozzy', 'ninja']) {
      for (const family of ['basic', 'special']) {
        const player = { x: 300, y: 300, width: 150, height: 150, flipX: false };
        const options = { character, family, player, quick: true };
        const chosen = resolveAttackAimContext({ ...options, quickFacingDirection: -1 });
        const facing = resolveAttackAimContext({ ...options, player: { ...player, flipX: true } });
        for (const key of ['angle', 'range', 'targetX', 'targetY', 'direction']) {
          assert.equal(chosen[key], facing[key], `${character} ${family} ${key}`);
        }
        const manual = { ...options, quick: false, pointerWorldX: 600, pointerWorldY: 240 };
        assert.deepEqual(resolveAttackAimContext({ ...manual, quickFacingDirection: -1 }),
          resolveAttackAimContext(manual));
        assert.equal(player.flipX, false);
      }
    }
  });
});
