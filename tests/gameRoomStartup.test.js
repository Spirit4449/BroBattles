const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createGameHub } = require('../src/server/core/gameHub');
const { registerGameEvents } = require('../src/server/core/socketEvents/gameEvents');
const { createBotParticipants } = require('../src/server/core/bots/identity');
const { decorateParticipant } = require('../src/server/services/matchRosterService');
const { spawnForParticipant } = require('../src/shared/duelGeometry');

class TestSocket extends EventEmitter {
  constructor(id, user) {
    super();
    this.id = id;
    this.data = { user };
    this.rooms = new Set();
    this.sent = [];
  }
  join(room) { this.rooms.add(room); }
  leave(room) { this.rooms.delete(room); }
  emit(type, payload) { this.sent.push({ type, payload }); return true; }
  async receive(type, ...args) {
    for (const listener of this.listeners(type)) await listener(...args);
  }
}

async function setup(t, teamSize = 1) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  t.mock.method(console, 'log', () => {});
  const events = [];
  const io = {
    sockets: { sockets: new Map() },
    to(channel) {
      return {
        emit(type, payload) { events.push({ channel, type, payload }); },
        compress() { return this; },
      };
    },
  };
  const human = decorateParticipant({
    user_id: 1712, name: 'RealPlayer', char_class: 'ninja', team: 'team1',
    level: 3, trophies: 500,
  });
  const db = {
    async runQuery(sql) {
      if (sql.includes('FROM match_participants')) return [{ name: human.name, party_id: null }];
      throw new Error(`Unexpected startup query: ${sql}`);
    },
    async setUserStatus() {},
  };
  const hub = createGameHub({ io, db });
  const room = await hub.createGameRoom(1341, {
    mode: teamSize, modeId: 'duels', modeVariantId: `duels-${teamSize}v${teamSize}`,
    map: teamSize,
    players: [human, ...createBotParticipants([human], teamSize, { seed: 17 }).map(decorateParticipant)],
  });
  room.DEV_TIMING_DIAG = false;
  t.after(() => hub.removeGameRoom(1341));
  function socket(id, user = human) {
    const result = new TestSocket(id, user);
    io.sockets.sockets.set(id, result);
    registerGameEvents(result, { db, gameHub: hub });
    return result;
  }
  async function join(client) {
    let ack;
    await client.receive('game:join', { matchId: 1341 }, (value) => { ack = value; });
    return ack;
  }
  async function ready(client) {
    const spawn = spawnForParticipant(room.geometry, human, 0, teamSize);
    await client.receive('game:ready', { x: spawn.x, y: spawn.y, flip: false });
  }
  return { room, hub, human, events, socket, join, ready };
}

for (const teamSize of [1, 2, 3]) {
  test(`Duel ${teamSize}v${teamSize} socket join starts a filled room after human readiness`, async (t) => {
    const h = await setup(t, teamSize);
    const client = h.socket('human');
    assert.deepEqual(await h.join(client), { ok: true, matchId: 1341 });
    assert.equal(client.data.gameMatchId, 1341);
    assert.ok(client.rooms.has('game:1341:team:team1'));
    const initial = client.sent.find((e) => e.type === 'game:init').payload;
    assert.equal(initial.players.length, teamSize * 2);
    assert.equal(initial.players.filter((p) => p.isBot).length, teamSize * 2 - 1);
    assert.equal(initial.players.find((p) => !p.isBot).participantId, 'user:1712');
    assert.equal(h.room.status, 'starting');
    assert.deepEqual([...h.room._requiredUserIds], [1712]);

    await h.join(client);
    assert.equal(client.listenerCount('game:special'), 1, 'duplicate join does not double actions');
    await h.ready(client);
    assert.equal(h.room.status, 'active');
    assert.deepEqual([...h.room._readyAcks], [1712], 'no bot browser is needed');
    assert.equal(h.events.filter((e) => e.type === 'game:start').length, 1);
    assert.equal(h.room._loopRunning, false);
    t.mock.timers.tick(6000);
    assert.equal(h.room._loopRunning, true, 'countdown starts the real loop');
    assert.equal(h.events.filter((e) => e.type === 'player:respawn').length, 0, 'fight does not teleport players');
    const intro = h.events.find(e => e.type === 'game:start').payload;
    assert.equal(Object.keys(intro.spawns).length, teamSize * 2);
    assert.ok(h.events.some(e => e.type === 'game:state'), 'shield state is sent at fight');
    h.room.processTick();
    h.room.broadcastSnapshot();
    const snapshot = h.events.findLast((e) => e.type === 'game:snapshot').payload;
    assert.equal(Object.keys(snapshot.players).length, teamSize * 2);
    for (const player of Object.values(snapshot.players)) {
      assert.ok(player.participantId);
      assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
    }
    assert.equal(h.hub.getStats().rooms[0].botCount, teamSize * 2 - 1);
  });
}

test('human reconnect preserves identity and combat state, and releases old socket bindings', async (t) => {
  const h = await setup(t);
  const first = h.socket('first');
  await h.join(first);
  await h.ready(first);
  const player = h.room.players.get(first.id);
  const bot = [...h.room.players.values()].find((p) => p.isBot);
  player.health -= 500;
  player.superCharge = 750;
  player._lastPositionSeq = 100;
  const health = player.health;
  const second = h.socket('second', { ...h.human, user_id: '1712' });
  assert.equal((await h.join(second)).ok, true);
  assert.equal(h.room.players.get(second.id), player);
  assert.equal(h.room.players.has(first.id), false);
  assert.equal(player.participantId, 'user:1712');
  assert.equal(player.health, health);
  assert.equal(player.superCharge, 750);
  assert.equal(player._lastPositionSeq, -1);
  assert.equal(first.listenerCount('game:special'), 0);
  assert.equal(first.rooms.has('game:1341'), false);
  assert.equal(h.room.players.get(bot.participantId), bot);

  await h.hub.handlePlayerLeave(second, 1341);
  assert.equal(h.room.hasConnectedHumanPlayers(), false);
  assert.equal(second.listenerCount('game:special'), 0);
  assert.ok(h.room._abandonTimer);
  const third = h.socket('third');
  assert.equal((await h.join(third)).ok, true);
  assert.equal(h.room.players.get(third.id), player);
  assert.equal(h.room._abandonTimer, null);
  assert.equal(player.health, health);
  assert.equal(h.room.getPlayerCount(), 2);
});

test('a socket cannot enter a match by claiming a bot name', async (t) => {
  const h = await setup(t);
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const bot = [...h.room.players.values()][0];
  const outsider = h.socket('outsider', { user_id: 9999, name: bot.name });
  assert.deepEqual(await h.join(outsider), { ok: false, error: 'join_failed' });
  assert.equal(h.room.players.size, 1);
  assert.equal(outsider.rooms.size, 0);
  assert.equal(outsider.sent.some((e) => e.type === 'game:init'), false);
  assert.ok(outsider.sent.some((e) => e.payload?.message === 'You are not a participant in this match'));
});
