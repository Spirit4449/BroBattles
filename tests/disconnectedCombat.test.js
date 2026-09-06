const test = require('node:test');
const assert = require('node:assert/strict');
const { makeRoom } = require('./helpers/botRoom');
const inferno = require('../src/server/core/gameRoom/abilities/dravenInfernoAbility');
const { observe } = require('../src/server/core/bots/perception');

test('bots see disconnected living enemies and Inferno damages them', t => {
  const { room, players: [caster, target] } = makeRoom({ characters: ['draven', 'wizard'] });
  t.after(() => room.cleanup());
  Object.assign(caster, { x: 100, y: 200, connected: true });
  Object.assign(target, { x: 130, y: 200, connected: false, socketId: null });
  assert.equal(observe(room, caster, 1000, new Map()).enemies.length, 1);
  const health = target.health;
  inferno.activate(caster, 1000);
  inferno.tick(room, caster, 1100);
  assert.ok(target.health < health);
  target.isAlive = false;
  assert.equal(observe(room, caster, 1200, new Map()).enemies.length, 0);
});
