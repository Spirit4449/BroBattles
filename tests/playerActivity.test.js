const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlayerActivityService } = require('../src/server/services/playerActivityService');
function fixture() {
  let time = 1000, liveMatch = 7;
  const writes = [], events = [], probes = [];
  const room = { status: 'active', humans: true, hasConnectedHumanPlayers() { return this.humans; } };
  const service = createPlayerActivityService({
    getGameRoom: () => room,
    now: () => time, schedule: false,
    db: {
      runQuery: async () => liveMatch ? [{ match_id: liveMatch }] : [],
      getPartyIdByName: async () => 3, updateLastSeen: async () => {},
    },
    io: { to: id => ({ emit: (event, data) => events.push({ id, event, data }) }) },
    setPresence: async (name, status) => writes.push({ name, status }),
  });
  const socket = id => ({
    id, connected: true, data: { user: { name: 'Owner', user_id: 1 } },
    timeout: () => ({ emit: (event, data, ack) => probes.push({ event, data, ack }) }),
  });
  const lobby = socket('lobby'), game = socket('game');
  return { service, room, lobby, game, writes, events, probes,
    setTime: value => { time = value; }, endDb: () => { liveMatch = null; },
    latest: () => writes.at(-1)?.status,
    flush: () => service.tick(),
  };
}

test('match membership alone cannot claim In Battle; heartbeat acknowledgement can', async () => {
  const f = fixture();
  f.service.registerMatch(7, [{ name: 'Owner' }]);
  f.service.joinGame(f.game, 7);
  await f.flush();
  assert.equal(f.latest(), 'offline');
  f.probes[0].ack(null, { matchId: 7 });
  await f.flush();
  assert.equal(f.latest(), 'In Battle');
});

test('game presence expires after ten seconds; input renews the lease', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]); f.service.joinGame(f.game, 7);
  f.service.gameActivity(f.game, 7); await f.flush();
  f.setTime(10999); await f.flush(); assert.equal(f.latest(), 'In Battle');
  f.setTime(11000); await f.flush(); assert.equal(f.latest(), 'offline');
  f.service.gameActivity(f.game, 7); await f.flush(); assert.equal(f.latest(), 'In Battle');
});

test('a recent lobby ping supplies online fallback and the live return target', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]); f.service.joinGame(f.game, 7);
  f.service.gameActivity(f.game, 7);
  f.setTime(8000); await f.service.lobbyPing(f.lobby);
  f.setTime(11000); await f.flush();
  assert.equal(f.latest(), 'online');
  assert.equal(f.events.at(-1).data.matchId, null);
});

test('end screen lasts ten seconds and game packets cannot extend it', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]); f.service.joinGame(f.game, 7);
  f.service.finishMatch(7); await f.flush(); assert.equal(f.latest(), 'End Screen');
  f.probes[0].ack(null, { matchId: 7 }); f.service.gameActivity(f.game, 7);
  f.setTime(10999); await f.flush(); assert.equal(f.latest(), 'End Screen');
  f.setTime(11000); await f.flush(); assert.equal(f.latest(), 'offline');
});

test('returning to the lobby clears end screen and survives its old deadline', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]);
  f.service.finishMatch(7); await f.flush();
  f.setTime(6000); await f.service.lobbyPing(f.lobby);
  assert.equal(f.latest(), 'online');
  // The completed match must stay closed even while its DB write is pending.
  assert.equal(f.events.at(-1).data.matchId, null);
  f.setTime(11000); await f.flush(); assert.equal(f.latest(), 'online');
});

test('old socket disconnects and acknowledgements cannot clear a replacement game connection', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]); f.service.joinGame(f.game, 7);
  const oldProbe = f.probes[0];
  const replacement = { ...f.game, id: 'new' };
  f.service.joinGame(replacement, 7); f.service.gameActivity(replacement, 7);
  f.service.disconnect(f.game); oldProbe.ack(null, { matchId: 7 });
  await f.flush(); assert.equal(f.latest(), 'In Battle');
});

test('a finished game socket cannot impersonate a lobby return', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]);
  f.game.data.gameMatchId = 7; f.service.finishMatch(7);
  await f.service.lobbyPing(f.game); await f.flush(); assert.equal(f.latest(), 'End Screen');
});

test('a new match supersedes old end-screen expiry', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]); f.service.finishMatch(7);
  f.service.registerMatch(8, [{ name: 'Owner' }]); f.service.joinGame(f.game, 8);
  f.setTime(11000); f.service.gameActivity(f.game, 8); await f.flush();
  assert.equal(f.latest(), 'In Battle');
});

test('abandonment clears the return target without inventing online presence', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]);
  f.service.finishMatch(7, { endScreen: false }); await f.flush();
  assert.equal(f.latest(), 'offline');
});

test('finished room clears return target even if database still says live', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }]); f.service.joinGame(f.game, 7);
  f.service.gameActivity(f.game, 7); await f.service.lobbyPing(f.lobby);
  assert.equal(f.events.at(-1).data.matchId, 7);
  f.room.status = 'finished';
  await f.service.lobbyPing(f.lobby);
  assert.equal(f.events.at(-1).data.matchId, null);
});

test('bots alone cannot keep the return button active', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }, { name: 'Bot', isBot: true }]);
  f.service.joinGame(f.game, 7); f.service.gameActivity(f.game, 7);
  await f.service.lobbyPing(f.lobby);
  assert.equal(f.events.at(-1).data.matchId, 7);
  f.room.humans = false;
  f.service.disconnect(f.game);
  assert.equal(f.events.at(-1).data.matchId, null);
});

test('another active human keeps the match available after the first leaves', async () => {
  const f = fixture(); f.service.registerMatch(7, [{ name: 'Owner' }, { name: 'Friend' }]);
  const friend = { ...f.game, id: 'friend', data: { user: { name: 'Friend', user_id: 2 } } };
  f.service.joinGame(f.game, 7); f.service.joinGame(friend, 7);
  f.service.gameActivity(f.game, 7); f.service.gameActivity(friend, 7);
  await f.service.lobbyPing(f.lobby);
  f.service.disconnect(f.game);
  assert.equal(f.events.at(-1).data.matchId, 7);
  f.service.disconnect(friend);
  assert.equal(f.events.at(-1).data.matchId, null);
});
