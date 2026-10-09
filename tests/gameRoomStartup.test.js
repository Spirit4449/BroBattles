const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createGameHub } = require('../src/server/core/gameHub');
const { registerGameEvents } = require('../src/server/core/socketEvents/gameEvents');
const { createBotParticipants } = require('../src/server/core/bots/identity');
const { decorateParticipant } = require('../src/server/services/match/matchRosterService');
const { spawnForParticipant } = require('../src/shared/physics/duelGeometry');
const { PREGAME_MS, PREGAME_GRACE_MS, COUNTDOWN_MS, START_DEADLINE_MS, plannedCountdownStart } = require('../src/shared/matchIntroTiming');

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

// A built-in map for each team size: each map is made for one mode.
const { mapDefaults } = require('../src/shared/maps');
const { mapArena } = require('../src/shared/maps/arenas');
const mapForTeamSize = (teamSize) => mapDefaults.find((map) => mapArena(map).playersPerTeam === teamSize);

async function setup(t, teamSize = 1, { humans = 1 } = {}) {
  const map = mapForTeamSize(teamSize), arena = mapArena(map);
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
  const friends = Array.from({ length: humans - 1 }, (_, i) => decorateParticipant({
    user_id: 1800 + i, name: `Friend${i}`, char_class: 'ninja', team: 'team1',
    level: 3, trophies: 500,
  }));
  const db = {
    async runQuery(sql) {
      if (sql.includes('FROM match_participants')) return [{ name: human.name, party_id: null }];
      if (sql.startsWith('UPDATE matches')) return [];
      throw new Error(`Unexpected startup query: ${sql}`);
    },
    async setUserStatus() {},
  };
  const hub = createGameHub({ io, db });
  const room = await hub.createGameRoom(1341, {
    mode: teamSize, modeId: arena.modeId, modeVariantId: arena.modeVariantId,
    map: map.id,
    players: [human, ...friends, ...createBotParticipants([human, ...friends], teamSize, { seed: 17 }).map(decorateParticipant)],
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
    await client.receive('game:join', { matchId: 1341, ninjaCombatVersion: 1, huntressCombatVersion: 2 }, (value) => { ack = value; });
    return ack;
  }
  async function ready(client) {
    await client.receive('game:ready', {});
  }
  const started = () => events.filter((e) => e.type === 'game:start').length;
  return { room, hub, human, friends, events, socket, join, ready, started };
}

for (const teamSize of [1, 2, 3]) {
  test(`${mapArena(mapForTeamSize(teamSize)).label} socket join starts a filled room after human readiness`, async (t) => {
    const h = await setup(t, teamSize);
    const client = h.socket('human');
    assert.deepEqual(await h.join(client), { ok: true, matchId: 1341 });
    assert.equal(client.data.gameMatchId, 1341);
    assert.ok(client.rooms.has('game:1341:team:team1'));
    const initial = client.sent.find((e) => e.type === 'game:init').payload;
    assert.equal(initial.players.length, teamSize * 2);
    assert.equal(initial.players.filter((p) => p.isBot).length, teamSize * 2 - 1);
    assert.equal(initial.players.find((p) => !p.isBot).participantId, 'user:1712');
    assert.equal(h.room.status, 'waiting');
    assert.deepEqual([...h.room._requiredUserIds], [1712]);

    await h.join(client);
    assert.equal(client.listenerCount('game:special'), 1, 'duplicate join does not double actions');
    await h.ready(client);
    await h.ready(client);
    assert.deepEqual([...h.room._readyAt.keys()], [1712], 'no bot browser is needed');
    assert.equal(h.room.status, 'waiting', 'the pregame plays before the countdown');
    t.mock.timers.tick(PREGAME_MS - 1);
    assert.equal(h.started(), 0);
    t.mock.timers.tick(1);
    assert.equal(h.room.status, 'active');
    assert.equal(h.started(), 1);
    assert.equal(h.room._loopRunning, false);
    const init = client.sent.findLast((e) => e.type === 'game:init');
    await h.join(client);
    assert.equal(client.sent.findLast((e) => e.type === 'game:init').payload.countdownRemainingMs, COUNTDOWN_MS,
      'a rejoin during the countdown resumes it');
    assert.notEqual(init, client.sent.findLast((e) => e.type === 'game:init'));
    t.mock.timers.tick(COUNTDOWN_MS);
    assert.equal(h.room._loopRunning, true, 'countdown starts the real loop');
    assert.equal(h.events.filter((e) => e.type === 'player:respawn').length, 0, 'fight does not teleport players');
    const intro = h.events.find(e => e.type === 'game:start').payload;
    assert.equal(Object.keys(intro.spawns).length, teamSize * 2);
    // The client stands fighters where game:init put them; the countdown must
    // not re-pick different spots for anyone, human or bot.
    for (const p of initial.players) {
      const spawn = intro.spawns[p.name];
      assert.ok(Math.abs(spawn.x - p.x) <= 0.5 && Math.abs(spawn.y - p.y) <= 0.5,
        `${p.name} keeps its join spawn at countdown`);
    }
    const slots = new Set(Object.values(intro.spawns).map((s) => `${s.x},${s.y}`));
    assert.equal(slots.size, teamSize * 2, 'every fighter has its own spawn');
    assert.ok(h.events.some(e => e.type === 'game:state'), 'shield state is sent at fight');
    h.room.processTick();
    h.room.broadcastSnapshot();
    // Snapshots are deltas; rebuild them in order the way a client does.
    const decoder = require('../src/shared/snapshotDelta').createSnapshotDecoder();
    let snapshot = null;
    for (const e of h.events) if (e.type === 'game:snapshot') snapshot = decoder.decode(e.payload) || snapshot;
    assert.equal(Object.keys(snapshot.players).length, teamSize * 2);
    // Identity is delivered once by game:init; periodic snapshots carry state.
    for (const p of initial.players) assert.ok(p.participantId && typeof p.isBot === 'boolean');
    for (const player of Object.values(snapshot.players)) {
      assert.equal(player.participantId, undefined);
      assert.ok(Number.isFinite(player.x) && Number.isFinite(player.y));
    }
    assert.equal(h.hub.getStats().rooms[0].botCount, teamSize * 2 - 1);
  });
}

test('movement packets before the countdown cannot move a fighter off its spawn', async (t) => {
  const h = await setup(t);
  const client = h.socket('human');
  await h.join(client);
  const player = h.room.players.get(client.id);
  const spawn = { x: player.x, y: player.y };
  h.room.handlePlayerInput(client.id, { x: spawn.x + 40, y: spawn.y, sequence: 1, timestamp: Date.now() });
  assert.deepEqual({ x: player.x, y: player.y }, spawn);
  await h.ready(client);
  t.mock.timers.tick(PREGAME_MS);
  assert.equal(h.room.status, 'active');
  const intro = h.events.find(e => e.type === 'game:start').payload;
  assert.deepEqual(intro.spawns[player.name], spawn);
});

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

test('countdown waits for every player up to the grace window, and starts early once all are ready', () => {
  assert.equal(plannedCountdownStart([], 2), null);
  assert.equal(plannedCountdownStart([0], 2), PREGAME_MS + PREGAME_GRACE_MS, 'a straggler gets the grace window');
  assert.equal(plannedCountdownStart([0, 1000], 2), PREGAME_MS, 'early arrivals do not wait');
  assert.equal(plannedCountdownStart([0, PREGAME_MS + 900], 2), PREGAME_MS + 900, 'the last arrival ends the hold');
  assert.equal(plannedCountdownStart([0], 1), PREGAME_MS);
});

for (const lateMs of [PREGAME_MS + 700, null]) {
  test(`two humans: ${lateMs === null ? 'a no-show cannot stall the match' : 'a late loader shortens the silent hold'}`, async (t) => {
    const h = await setup(t, 2, { humans: 2 });
    const first = h.socket('first');
    const second = h.socket('second', h.friends[0]);
    await h.join(first);
    await h.join(second);
    await h.ready(first);
    assert.deepEqual(h.events.filter((e) => e.type === 'player:loaded').map((e) => e.payload.name),
      [h.human.name], 'clients already in the pregame learn a fighter loaded');
    if (lateMs === null) {
      t.mock.timers.tick(PREGAME_MS + PREGAME_GRACE_MS - 1);
      assert.equal(h.started(), 0);
      t.mock.timers.tick(1);
      assert.equal(h.started(), 1, 'grace expires without the missing player');
    } else {
      t.mock.timers.tick(lateMs);
      assert.equal(h.started(), 0);
      await h.ready(second);
      t.mock.timers.tick(0);
      assert.equal(h.started(), 1, 'the countdown starts as soon as the last player is in');
    }
  });
}

test('the start deadline starts a match nobody reported loaded, and cleanup releases every start timer', async (t) => {
  const h = await setup(t);
  const client = h.socket('human');
  await h.join(client);
  t.mock.timers.tick(START_DEADLINE_MS);
  assert.equal(h.started(), 1);
  h.room.cleanup();
  assert.equal(h.room._countdownTimeout, null);
  t.mock.timers.tick(COUNTDOWN_MS);
  assert.equal(h.room._loopRunning, false, 'a disposed room never starts its loop');
});
