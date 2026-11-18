const { computeMatchStats } = require('../src/shared/characters/characterStats');
const { createFakeIo } = require('./helpers/fakeIo');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGameHub } = require('../src/server/core/gameHub');
const { registerGameEvents } = require('../src/server/core/socketEvents/gameEvents');
const { createBotParticipants } = require('../src/server/core/bots/identity');
const { decorateParticipant } = require('../src/server/services/match/matchRosterService');
const { PREGAME_MS, PREGAME_GRACE_MS, COUNTDOWN_MS, START_DEADLINE_MS, plannedCountdownStart } = require('../src/shared/matchIntroTiming');

// Both duel formations use the same map; Bank Bust has its own pool.
const { mapDefaults } = require('../src/shared/maps');
const { mapArena } = require('../src/shared/maps/arenas');
const mapForTeamSize = (teamSize) => mapDefaults.find((map) => teamSize <= 2 ? mapArena(map).modeId === 'duels' : mapArena(map).playersPerTeam === teamSize);

async function setup(t, teamSize = 1, { humans = 1, friendLevel = 3 } = {}) {
  const map = mapForTeamSize(teamSize), arena = mapArena(map);
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000000 });
  t.mock.method(console, 'log', () => {});
  const events = [];
  const io = createFakeIo({ onEmit: (channel, type, payload) => events.push({ channel, type, payload }) });
  const human = decorateParticipant({
    user_id: 1712, name: 'RealPlayer', char_class: 'ninja', team: 'team1',
    level: 3, trophies: 500,
  });
  const friends = Array.from({ length: humans - 1 }, (_, i) => {
    const friend = decorateParticipant({
      user_id: 1800 + i, name: `Friend${i}`, char_class: 'ninja', team: 'team1',
      level: friendLevel || 3, trophies: 500,
    });
    // A legacy roster entry without a level.
    if (!friendLevel) delete friend.level;
    return friend;
  });
  const db = {
    async runQuery(sql) {
      if (sql.includes('FROM match_participants')) return [{ name: human.name, party_id: null }];
      if (sql.startsWith('UPDATE matches')) return [];
      if (sql.includes('SELECT char_levels')) return [{ char_levels: JSON.stringify({ ninja: 7 }) }];
      throw new Error(`Unexpected startup query: ${sql}`);
    },
    async setUserStatus() {},
  };
  const hub = createGameHub({ io, db });
  const room = await hub.createGameRoom(1341, {
    mode: teamSize, modeId: arena.modeId, modeVariantId: arena.modeId === 'duels' ? `duels-${teamSize}v${teamSize}` : arena.modeVariantId,
    map: map.id,
    players: [human, ...friends, ...createBotParticipants([human, ...friends], teamSize, { seed: 17 }).map(decorateParticipant)],
  });
  room.DEV_TIMING_DIAG = false;
  t.after(() => hub.removeGameRoom(1341));
  function socket(id, user = human) {
    const result = io.addSocket(id, { data: { user } });
    registerGameEvents(result, { db, gameHub: hub });
    return result;
  }
  async function join(client) {
    let ack;
    await client.receive('game:join', { matchId: 1341, ninjaCombatVersion: 1, sparrowCombatVersion: 2, networkWireVersion: 1 }, (value) => { ack = value; });
    return ack;
  }
  async function ready(client) {
    await client.receive('game:ready', {});
  }
  const started = () => events.filter((e) => e.type === 'game:start').length;
  return { room, hub, human, friends, events, socket, join, ready, started };
}

for (const teamSize of [1, 2, 3]) {
  test(`${mapArena(mapForTeamSize(teamSize)).label} ${teamSize}v${teamSize} socket join starts a filled room after human readiness`, async (t) => {
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

test('overlapping reconnects leave only the latest socket registered', async (t) => {
  const h = await setup(t);
  const first = h.socket('first');
  assert.equal((await h.join(first)).ok, true);
  const player = h.room.players.get(first.id);
  const second = h.socket('second');
  const third = h.socket('third');

  const results = await Promise.all([h.join(second), h.join(third)]);

  assert.ok(results.every((result) => result.ok));
  assert.equal(h.room.players.get(third.id), player);
  assert.equal(third.listenerCount('game:special'), 1);
  assert.ok(third.rooms.has('game:1341:team:team1'));
  assert.equal(h.room.players.has(second.id), false);
  assert.equal(second.listenerCount('game:special'), 0);
  assert.equal(second.rooms.has('game:1341:team:team1'), false);
});

const matchChannels = ['game:1341', 'game:1341:team:team1'];

for (const channel of matchChannels) {
  test(`a failed adapter join for ${channel} preserves the previous player socket`, async (t) => {
    const h = await setup(t);
    const previous = h.socket('previous');
    const joining = h.socket('joining');
    await h.room.addPlayer(previous, h.human);
    const player = h.room.players.get(previous.id);
    const originalJoin = joining.join.bind(joining);
    t.mock.method(joining, 'join', async (name) => {
      originalJoin(name);
      if (name === channel) throw new Error('adapter join failed');
    });

    await assert.rejects(h.room.addPlayer(joining, h.human), /adapter join failed/);

    assert.equal(h.room.players.get(previous.id), player);
    assert.equal(h.room.players.has(joining.id), false);
    assert.equal(previous.listenerCount('game:special'), 1);
    assert.equal(joining.listenerCount('game:special'), 0);
    assert.deepEqual([...previous.rooms], matchChannels);
    assert.equal(joining.rooms.size, 0);
  });

  for (const interrupt of ['disconnect', 'dispose']) {
    test(`${interrupt} during adapter join for ${channel} rolls back memberships`, async (t) => {
      const h = await setup(t);
      const joining = h.socket('joining');
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const originalJoin = joining.join.bind(joining);
      t.mock.method(joining, 'join', async (name) => {
        if (name === channel) {
          entered.resolve();
          await release.promise;
        }
        originalJoin(name);
      });

      const attempt = h.room.addPlayer(joining, h.human);
      await entered.promise;
      if (interrupt === 'dispose') h.hub.removeGameRoom(1341);
      else {
        joining.connected = false;
        joining.rooms.clear();
        await h.hub.handlePlayerLeave(joining, 1341);
      }
      release.resolve();

      await assert.rejects(attempt, { code: interrupt === 'dispose' ? 'MATCH_FINISHED' : 'SOCKET_DISCONNECTED' });
      assert.equal(h.room.players.has(joining.id), false);
      assert.equal(joining.listenerCount('game:special'), 0);
      assert.equal(joining.rooms.size, 0);
    });
  }
}

test('a failed adapter leave restores the previous player rooms', async (t) => {
  const h = await setup(t);
  const previous = h.socket('previous');
  const joining = h.socket('joining');
  await h.room.addPlayer(previous, h.human);
  const player = h.room.players.get(previous.id);
  const originalLeave = previous.leave.bind(previous);
  const leave = t.mock.method(previous, 'leave', async (name) => {
    originalLeave(name);
    if (name === matchChannels[1]) throw new Error('adapter leave failed');
  });

  await assert.rejects(h.room.addPlayer(joining, h.human), /adapter leave failed/);
  leave.mock.restore();

  assert.equal(h.room.players.get(previous.id), player);
  assert.equal(previous.listenerCount('game:special'), 1);
  assert.deepEqual([...previous.rooms], matchChannels);
  assert.equal(h.room.players.has(joining.id), false);
  assert.equal(joining.listenerCount('game:special'), 0);
  assert.equal(joining.rooms.size, 0);
});

test('a human who has not joined by the countdown is a hittable ghost at spawn, and joining takes it over', async (t) => {
  const h = await setup(t, 2, { humans: 2 });
  const host = h.socket('host');
  await h.join(host);
  await h.ready(host);
  t.mock.timers.tick(START_DEADLINE_MS);
  assert.equal(h.room.status, 'active');
  const ghost = [...h.room.players.values()].find((p) => p.name === h.friends[0].name);
  assert.ok(ghost, 'the absent human has a server entry');
  assert.equal(ghost.loaded, false);
  assert.ok(Number.isFinite(ghost.x) && Number.isFinite(ghost.y), 'stands at a spawn');
  assert.equal(h.room.hasConnectedHumanPlayers(), true);
  assert.equal(h.room.getPlayerCount(), [...h.room.players.values()].filter((p) => p.connected).length);

  const enemy = [...h.room.players.values()].find((p) => p.isBot && p.team !== ghost.team);
  // A melee attacker: ninja hits are only trusted from its own projectiles.
  Object.assign(enemy, { char_class: 'draven', x: ghost.x + 20, y: ghost.y, flip: true, _posHistory: [] });
  const before = ghost.health;
  const result = h.room.handleHit(enemy.participantId, { attacker: enemy.name, target: ghost.name, attackType: 'basic', instanceId: 'g' }, { server: true });
  assert.equal(result?.accepted, true);
  assert.ok(ghost.health < before, 'the ghost takes damage');

  const late = h.socket('late', { ...h.friends[0] });
  assert.equal((await h.join(late)).ok, true);
  assert.equal(h.room.players.get(late.id), ghost, 'joining takes over the ghost');
  assert.equal(ghost.connected, true);
  assert.ok(ghost.health < before, 'damage taken as a ghost is kept');
  assert.equal(ghost._neverJoined, false, 'a late joiner earns match rewards');
});

test('a ghost is knocked back by the server, which steps it until its client loads', async (t) => {
  const inputManager = require('../src/server/core/gameRoom/inputManager');
  const h = await setup(t, 2, { humans: 2 });
  const host = h.socket('host');
  await h.join(host);
  await h.ready(host);
  t.mock.timers.tick(START_DEADLINE_MS + COUNTDOWN_MS);
  const ghost = [...h.room.players.values()].find((p) => p.name === h.friends[0].name);
  assert.equal(ghost._neverJoined, true);
  t.mock.timers.tick(Math.max(0, ghost._controlLockUntil - Date.now()) + 1);
  const startX = ghost.x;
  h.room.applyKnockback(ghost, { source: 'x', cause: 'stomp', radial: true, amountX: 300, amountY: -180 });
  for (let i = 0; i < 10; i++) {
    t.mock.timers.tick(h.room.FIXED_DT_MS);
    inputManager.stepIdleHumans(h.room, h.room.FIXED_DT_MS, Date.now());
  }
  assert.ok(ghost.x > startX + 10, 'the knockback carries the ghost');
});

test('a ghost seeded without a level looks it up, and a join waits for it', async (t) => {
  const h = await setup(t, 2, { humans: 2, friendLevel: null });
  const host = h.socket('host');
  await h.join(host);
  await h.ready(host);
  t.mock.timers.tick(START_DEADLINE_MS);
  const ghost = [...h.room.players.values()].find((p) => p.name === h.friends[0].name);
  const late = h.socket('late', { ...h.friends[0] });
  assert.equal((await h.join(late)).ok, true);
  assert.equal(h.room.players.get(late.id), ghost);
  assert.equal(ghost.level, 7, 'the stored character level, not level 1');
  assert.equal(ghost.maxHealth, computeMatchStats('ninja', 7).maxHealth);
  assert.equal(ghost.health, ghost.maxHealth);
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
    const firstInit = first.sent.find((e) => e.type === 'game:init').payload;
    const pending = firstInit.players.find((p) => p.name === h.friends[0].name);
    assert.ok(Number.isFinite(pending.x) && Number.isFinite(pending.y),
      'a fighter who has not joined yet still has a spawn position');
    await h.join(second);
    const joined = [...h.room.players.values()].find((p) => p.name === h.friends[0].name);
    assert.ok(Math.abs(joined.x - pending.x) <= 0.5 && Math.abs(joined.y - pending.y) <= 0.5,
      'joining keeps that spawn');
    await h.ready(first);
    assert.deepEqual(h.events.filter((e) => e.type === 'player:loaded').map((e) => e.payload.name),
      [h.human.name], 'clients already in the pregame learn a fighter loaded');
    const loaded = h.events.find((e) => e.type === 'player:loaded').payload;
    assert.ok(Number.isFinite(loaded.x) && Number.isFinite(loaded.y), 'and where they stand');
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

test('timer starts sudden death exactly at regulation and finishes by remaining health at the cap', t => {
  const { tickTimerAndSuddenDeath } = require('../src/server/core/gameRoom/timerManager');
  const { SUDDEN_DEATH_MAX_MS, TIMER_EMIT_INTERVAL_MS } = require('../src/shared/combat/matchConfig');
  const { installFakeClock } = require('./helpers/fakeClock');
  const clock = installFakeClock(t);
  t.mock.method(console, 'log', () => {});
  const started = Date.now();
  const regulation = TIMER_EMIT_INTERVAL_MS * 10;
  const io = createFakeIo();
  const outcomes = [];
  const room = {
    io, matchId: 4, status: 'active',
    broadcast: (event, payload) => io.to('game:4').emit(event, payload),
    loopStartWallTime: started, _lastTimerEmitMs: started,
    gameMode: { getMatchDurationMs: () => regulation },
    geometry: { world: { x: 0, y: 0, width: 500, height: 500 } },
    players: new Map([
      ['a', { team: 'team1', x: 100, y: 100, isAlive: true, health: 50 }],
      ['b', { team: 'team2', x: 200, y: 100, isAlive: true, health: 12 }],
    ]),
    computePoisonY: () => 450,
    finishGame: (winner, metadata) => outcomes.push({ winner, metadata }),
  };
  clock.setTime(started + regulation - TIMER_EMIT_INTERVAL_MS);
  tickTimerAndSuddenDeath(room);
  assert.equal(io.emitted.at(-1).payload.suddenDeath, false);
  assert.equal(io.emitted.at(-1).payload.remaining, TIMER_EMIT_INTERVAL_MS);
  clock.setTime(started + regulation);
  tickTimerAndSuddenDeath(room);
  tickTimerAndSuddenDeath(room);
  assert.equal(io.emitted.filter(record => record.event === 'game:sudden-death:start').length, 1);
  assert.equal(io.emitted.at(-1).payload.remaining, 0);
  assert.equal(io.emitted.at(-1).payload.suddenDeath, true);
  assert.deepEqual(outcomes, []);
  clock.setTime(started + regulation + SUDDEN_DEATH_MAX_MS);
  tickTimerAndSuddenDeath(room);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].winner, 'team1');
  assert.equal(outcomes[0].metadata.suddenDeathTimeout, true);
  assert.equal(outcomes[0].metadata.tiebreakReason, 'health');
});
