// Compatibility for room-based callers. Durable results and transaction logic
// live together in services/match.
const { ensureRewardBucket, recordCombatStat } = require('./combatStats');
const { settleMatchResult, snapshotResult, applyRewards, calculateRewards } = require('../../services/match/rewardSettlement');

function distributeMatchRewards(room, winnerTeam) {
  return settleMatchResult(room.db, snapshotResult(room, winnerTeam));
}
function applyMatchRewards(room, winnerTeam, query) {
  return applyRewards(snapshotResult(room, winnerTeam), query);
}
module.exports = { ensureRewardBucket, recordCombatStat, distributeMatchRewards, applyMatchRewards, calculateRewards };
