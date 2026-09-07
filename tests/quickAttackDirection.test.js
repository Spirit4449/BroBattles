const test = require('node:test');
const assert = require('node:assert/strict');
const { getNearestOpponentDirection, resolveAttackAimContext } = require('../src/characters/shared/attackAim');

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
  for (const character of ['huntress', 'gloop', 'wizard', 'ninja']) {
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
