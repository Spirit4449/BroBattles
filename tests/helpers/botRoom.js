const { GameRoom } = require('../../src/server/core/gameRoom');
const { difficultyForTrophies } = require('../../src/server/core/bots/config');
const { tickActiveAttacks } = require('../../src/shared/combat/runtime/attackRuntimeManager.js');
const { standOn } = require('../../src/server/core/bots/navigation');
const { observe } = require('../../src/server/core/bots/perception');
const effects = require('../../src/shared/combat/runtime/effects/effectManager');
const { tickMovingPlatforms } = require('../../src/server/core/gameRoom/movingPlatforms');

function makeRoom({ characters = ['ninja', 'ozzy'], map = 1, trophies = 1000, seed = 1, mapData = null } = {}) {
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
  room.status = 'active'; room.loopStartWallTime = Date.now(); room.checkVictoryCondition = () => {};
  room.broadcastSnapshot = () => {}; room.DEV_TIMING_DIAG = false; room._netTestEnabled = true;
  room._requiredUserIds.clear();
  function tick(now) { room.tickId++; room.simulationMono = (room.simulationMono || 0) + room.FIXED_DT_MS; tickMovingPlatforms(room, room.simulationMono); room.processTick(); tickActiveAttacks(room, now); require('../../src/shared/combat/runtime/characterCombatRegistry.js').tick(room); room._tickPowerupEffects(); room.processRegen(); }
  function place(p, x, surface = room.geometry.colliders.find((p) => p.collision.up)) {
    Object.assign(p, standOn(surface, p.char_class, x));
  }
  return { room, players: [...room.players.values()], events, queries, tick, place };
}

function makeBotBehaviorRoom(t, characters = ['ozzy', 'ninja'], trophies = 1000) {
  let now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(console, 'log', () => {});
  const h = makeRoom({ characters, trophies, seed: 17 });
  t.after(() => h.room.cleanup());
  const p = h.players[0], brain = h.room.botControllers.get(p.participantId);
  for (const id of h.room.botControllers.keys()) if (id !== p.participantId) h.room.botControllers.delete(id);
  h.players.forEach((player, i) => h.place(player, 1000 + i * 250));
  h.room._lastPowerupSpawnAt = now;
  const snapshot = () => observe(h.room, p, now, brain.projectileSamples);
  const think = () => brain.think(snapshot(), effects.getModifiers(p, now), now);
  function advance(frames, pickups = false) {
    for (let i = 0; i < frames; i++) {
      now += 1000 / 60;
      h.tick(now);
      if (pickups) h.room._tickPowerups();
    }
  }
  return { ...h, p, brain, snapshot, think, advance, now: () => now };
}

module.exports = { makeRoom, makeBotBehaviorRoom };
