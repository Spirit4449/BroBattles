const test = require('node:test');
const assert = require('node:assert/strict');
const { tickPowerups } = require('../src/server/core/gameRoom/powerupManager');
const { handleDeathDropPickup } = require('../src/server/core/gameRoom/deathDropManager');
const { BankBustGameMode } = require('../src/server/core/gameModes/bankBust/BankBustGameMode');

function fixture() {
  const player = { name: 'player', x: 100, y: 100, isAlive: true, connected: true, loaded: true, team: 'team1' };
  const rewards = {};
  const events = [];
  const room = {
    status: 'active', players: new Map([['player', player]]),
    _powerups: new Map(), _deathDrops: new Map(), _lastPowerupSpawnAt: 10000,
    _ensureRewardBucket: () => rewards,
    io: { to: () => ({ emit: (event, payload) => events.push({ event, payload }) }) },
  };
  return { room, rewards, events };
}

test('powerups wait 500ms after activation, rather than after the warning starts', t => {
  const { room, events } = fixture();
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  room._powerups.set(1, { id: 1, type: 'rage', x: 100, y: 100,
    spawnedAt: 8000, activeAt: 10000, expiresAt: 20000 });
  for (now of [10000, 10499]) {
    tickPowerups(room);
    assert.equal(room._powerups.size, 1);
    assert.equal(events.length, 0);
  }
  now = 10500;
  tickPowerups(room);
  assert.equal(room._powerups.size, 0);
  assert.equal(events.length, 1);
});

for (const type of ['coin', 'gem']) {
  test(`${type} rejects early pickup requests and awards exactly once at 500ms`, t => {
    const { room, rewards, events } = fixture();
    let now = 10000;
    t.mock.method(Date, 'now', () => now);
    room._deathDrops.set(1, { id: 1, type, value: 1, spawnX: 100, spawnY: 100,
      spawnedAt: 10000, expiresAt: 20000 });
    const collect = () => handleDeathDropPickup(room, 'player', { id: 1, x: 100, y: 100 });
    for (now of [10000, 10499]) {
      collect();
      assert.equal(room._deathDrops.size, 1);
      assert.equal(events.length, 0);
      assert.deepEqual(rewards, {});
    }
    now = 10500;
    collect();
    collect();
    assert.equal(room._deathDrops.size, 0);
    assert.equal(events.length, 1);
    assert.equal(rewards[type === 'coin' ? 'dropCoins' : 'dropGems'], 1);
  });
}

test('Bank Bust random gold stays visible but uncollectible for 500ms', () => {
  const { room } = fixture();
  const state = { randomGold: { pickups: [{ id: 'gold', x: 100, y: 100, value: 5, spawnedAt: 10000 }] } };
  const mode = Object.create(BankBustGameMode.prototype);
  mode.room = room;
  mode.getModeState = () => state;
  let awarded = 0;
  mode.addTeamGold = (team, value) => { awarded += value; };
  for (const now of [10000, 10499]) {
    mode._collectRandomGold(now);
    assert.equal(state.randomGold.pickups.length, 1);
    assert.equal(awarded, 0);
  }
  mode._collectRandomGold(10500);
  assert.equal(state.randomGold.pickups.length, 0);
  assert.equal(awarded, 5);
});
