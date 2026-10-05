const test = require('node:test');
const assert = require('node:assert/strict');
const input = require('../src/server/core/gameRoom/inputManager');
const { resolveAttackTime } = require('../src/server/core/gameRoom/damageResolver');
const { evaluateHitRange, getHistoricalPosition } = require('../src/server/core/gameRoom/combatValidation');
const { HuntressReplica, CombatClock } = require('../src/shared/characters/huntressReplication');
const { POSITION_HISTORY_MS } = require('../src/server/core/gameRoomConfig');
const loadServerClock = require('./helpers/serverClockModule');

test('client hit times come from the shared server clock, never the client wall clock', () => {
  const now = 50000, nowMono = 9000;
  // Client is 40 ms behind on the server's monotonic clock.
  assert.equal(resolveAttackTime({ attackServerMono: 8960 }, { now, nowMono }), 49960);
  // A wildly skewed client wall clock is ignored.
  assert.equal(resolveAttackTime({ attackTime: now + 2400 }, { now, nowMono }), now);
  assert.equal(resolveAttackTime({}, { now, nowMono }), now);
  // Server-originated hits keep their own server Date.now().
  assert.equal(resolveAttackTime({ attackTime: now - 30 }, { server: true, now, nowMono }), now - 30);
});

test('future hit times are rejected without a multi-second skew allowance', () => {
  const p = { x: 0, y: 0, char_class: 'ninja', _posHistory: [] };
  const result = evaluateHitRange({ attacker: p, target: { ...p }, attackType: 'basic',
    attackTimeRaw: 10000 + 600, now: 10000 });
  assert.equal(result.attackWasFuture, true);
});

test('humans record one history sample per accepted packet and rewind linearly between them', t => {
  let now = 100000;
  t.mock.method(Date, 'now', () => now);
  const player = { socketId: 'p', name: 'P', char_class: 'ninja', x: 0, y: 0, isAlive: true, connected: true };
  const room = { players: new Map([['p', player]]), io: { to: () => ({ emit() {} }) } };
  input.resetMovementBudget(player, now);
  now += 30; input.handlePlayerInput(room, 'p', { x: 0, y: 0, sequence: 1 });
  now += 30; input.handlePlayerInput(room, 'p', { x: 9, y: 0, sequence: 2 });
  assert.equal(player._posHistory.length, 2);
  assert.equal(getHistoricalPosition(player, now - 15).x, 4.5);
});

test('position history spans about one second regardless of sample rate', () => {
  const player = { x: 0, y: 0, isAlive: true, isBot: true };
  for (let t = 0; t <= 3000; t += 1000 / 60) {
    player.x = t;
    input.recordBotHistory(player, t);
  }
  const history = player._posHistory;
  const span = history[history.length - 1].t - history[0].t;
  assert.ok(span <= POSITION_HISTORY_MS + 1000 / 60 && span >= POSITION_HISTORY_MS - 1000 / 60, `span ${span}`);
});

test('a replica given the shared clock never resets it', () => {
  const clock = new CombatClock();
  clock.reset('room');
  clock.synchronize({ epoch: 'room', sentMono: 500, simMono: 500 }, 100, 120);
  const replica = new HuntressReplica(clock);
  replica.reset('room');
  replica.reset();
  assert.equal(clock.epoch, 'room');
  assert.equal(clock.samples.length, 1);
  const owned = new HuntressReplica();
  owned.reset('other');
  assert.equal(owned.clock.epoch, 'other');
});

test('the match clock bursts on a new epoch, keeps the lowest-RTT offset and reports server time', () => {
  let now = 0;
  const timeouts = [];
  const clockModule = loadServerClock({ performance: { now: () => now },
    setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; } });
  const pending = [];
  const socket = { connected: true, timeout: () => ({ emit: (name, data, ack) => pending.push({ ack, sent: now }) }) };
  clockModule.startServerClockSync(socket);
  assert.equal(clockModule.serverNowMono(), null);
  // A delayed first snapshot alone would suggest the wrong offset (1050).
  clockModule.observeServerClockSnapshot({ snapshotEpoch: 'room', sentMono: 1050, tMono: 1040 }, 0);
  assert.equal(timeouts.length, 5);
  for (const t of timeouts) t.fn();
  assert.equal(pending.length, 5);
  // Server clock is exactly 1000 ms ahead. Slow round trips are asymmetric, so
  // their midpoint estimate is wrong; only the fastest sample is trusted.
  [40, 10, 80, 12, 200].forEach((rtt, i) => {
    const { ack, sent } = pending[i];
    now = sent + rtt;
    const serverMono = sent + rtt / 2 + 1000 + (rtt === 10 ? 0 : rtt / 4);
    ack(null, { epoch: 'room', sentMono: serverMono, simMono: serverMono });
  });
  now = 5000;
  assert.equal(clockModule.serverNowMono(), 6000);
  // Same epoch: no new burst. New room instance: reset and burst again.
  clockModule.observeServerClockSnapshot({ snapshotEpoch: 'room', sentMono: 6000, tMono: 6000 }, now);
  assert.equal(timeouts.length, 5);
  clockModule.observeServerClockSnapshot({ snapshotEpoch: 'room-2', sentMono: 10, tMono: 10 }, now);
  assert.equal(timeouts.length, 10);
  assert.equal(clockModule.getServerClockDiagnostics().epoch, 'room-2');
  clockModule.stopServerClockSync();
});
