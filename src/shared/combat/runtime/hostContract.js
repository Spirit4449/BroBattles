// GameRoom, its editor subclass and the deterministic character preview all
// host the same combat simulation. Optional terrain, tracing and mode hooks
// are feature-detected where used. Attack/effect registries keep per-host
// state so concurrent matches never share projectiles or deduplication maps.
/**
 * @typedef {object} CombatHost
 * @property {Map} players Participant records keyed by socket or participant ID.
 * @property {object} geometry Contains world bounds and collision geometry.
 * @property {number} tickId Monotonic simulation tick.
 * @property {number} simulationMono Monotonic simulation timestamp in milliseconds.
 * @property {function} broadcast
 * @property {function} broadcastSnapshot
 * @property {function} scheduleAction
 * @property {function} handleHit
 * @property {function} getAttackMaxDist
 * @property {function} getHistoricalPosition
 * @property {function} recordCombatStat
 * @property {function} applyKnockback
 * @property {function} applyPowerupToPlayer
 * @property {function} broadcastHealthUpdate
 * @property {function} maybeBroadcastHealth
 * @property {function} handlePlayerDeath
 * @property {function} checkVictoryCondition
 */
const requiredMethods = [
  'broadcast', 'broadcastSnapshot', 'scheduleAction', 'handleHit',
  'getAttackMaxDist', 'getHistoricalPosition', 'recordCombatStat',
  'applyKnockback', 'applyPowerupToPlayer', 'broadcastHealthUpdate',
  'maybeBroadcastHealth', 'handlePlayerDeath', 'checkVictoryCondition',
];

function assertHost(host) {
  for (const method of requiredMethods) {
    if (typeof host[method] !== 'function') throw new TypeError('Combat host must implement ' + method);
  }
  if (!(host.players instanceof Map) || !host.geometry?.world) {
    throw new TypeError('Combat host requires participants and world geometry');
  }
}

module.exports = { assertHost };
