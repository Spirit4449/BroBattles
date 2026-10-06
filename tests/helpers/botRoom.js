const { GameRoom } = require('../../src/server/core/gameRoom');
const { difficultyForTrophies } = require('../../src/server/core/bots/config');
const { tickActiveAttacks } = require('../../src/server/core/gameRoom/attackRuntimeManager');
const { standOn } = require('../../src/server/core/bots/navigation');
const { tickMovingPlatforms } = require('../../src/server/core/gameRoom/movingPlatforms');

function makeRoom({ characters = ['ninja', 'wizard'], map = 1, trophies = 1000, seed = 1, mapData = null } = {}) {
  const events = [], queries = [];
  const io = { sockets: { sockets: new Map() }, to: (channel) => ({ emit: (type, payload) => events.push({ channel, type, payload }), compress() { return this; } }) };
  const db = { runQuery: async (sql, params) => { queries.push({ sql, params }); return []; } };
  const players = characters.map((char_class, i) => ({ participantId: `bot:test:${i}`, user_id: null, name: `Player${i}`, team: i % 2 ? 'team2' : 'team1', char_class,
    isBot: true, level: 1, trophies, seed: seed + i, difficulty: difficultyForTrophies(trophies) }));
  // Navigation assertions use the checked-in geometry, independent of local editor saves.
  const { mapDefaults } = require('../../src/shared/maps');
  const { mapSummary } = require('../../src/shared/maps/mapDocument');
  const { schemaVersion, ...document } = structuredClone(mapDefaults.find(entry => entry.id === Number(map)));
  const arena = require('../../src/shared/maps/arenas').mapArena(document);
  const editorMapSnapshot = { mapId: map, revision: 'test-default', metadata: mapSummary(document), map: structuredClone(mapData || document) };
  const room = new GameRoom(1, { mode: arena.playersPerTeam, modeId: arena.modeId, modeVariantId: arena.modeVariantId, map, players, editorMapSnapshot }, { io, db });
  room.status = 'active'; room._loopStartWallTime = Date.now(); room._checkVictoryCondition = () => {};
  room.broadcastSnapshot = () => {}; room.DEV_TIMING_DIAG = false; room._netTestEnabled = true;
  room._requiredUserIds.clear();
  function tick(now) { room._tickId++; room._simulationMono = (room._simulationMono || 0) + room.FIXED_DT_MS; tickMovingPlatforms(room, room._simulationMono); room.processTick(); tickActiveAttacks(room, now); require('../../src/server/core/gameRoom/characterCombatRegistry').tick(room); room._tickPowerupEffects(); room.processRegen(); }
  function place(p, x, surface = room.geometry.colliders.find((p) => p.collision.up)) {
    Object.assign(p, standOn(surface, p.char_class, x));
  }
  return { room, players: [...room.players.values()], events, queries, tick, place };
}
module.exports = { makeRoom };
