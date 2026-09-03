const { GameRoom } = require('../../src/server/core/gameRoom');
const { difficultyForTrophies } = require('../../src/server/core/bots/config');
const { tickActiveAttacks } = require('../../src/server/core/gameRoom/attackRuntimeManager');
const { standOn } = require('../../src/server/core/bots/navigation');

function makeRoom({ characters = ['ninja', 'wizard'], map = 1, trophies = 1000, seed = 1 } = {}) {
  const events = [], queries = [];
  const io = { sockets: { sockets: new Map() }, to: (channel) => ({ emit: (type, payload) => events.push({ channel, type, payload }), compress() { return this; } }) };
  const db = { runQuery: async (sql, params) => { queries.push({ sql, params }); return []; } };
  const players = characters.map((char_class, i) => ({ participantId: `bot:test:${i}`, user_id: null, name: `Player${i}`, team: i % 2 ? 'team2' : 'team1', char_class,
    isBot: true, level: 1, trophies, seed: seed + i, difficulty: difficultyForTrophies(trophies) }));
  const room = new GameRoom(1, { mode: 1, modeId: 'duels', modeVariantId: 'duels-1v1', map, players }, { io, db });
  room.status = 'active'; room._loopStartWallTime = Date.now(); room._checkVictoryCondition = () => {};
  room.broadcastSnapshot = () => {}; room.DEV_TIMING_DIAG = false; room._netTestEnabled = true;
  room._requiredUserIds.clear();
  function tick(now) { room.processTick(); tickActiveAttacks(room, now); room._tickPowerupEffects(); room.processRegen(); }
  function place(p, x, surface = room.geometry.colliders.find((p) => p.collision.up)) {
    Object.assign(p, standOn(surface, p.char_class, x));
  }
  return { room, players: [...room.players.values()], events, queries, tick, place };
}
module.exports = { makeRoom };
