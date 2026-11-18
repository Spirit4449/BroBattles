function ensureRewardBucket(room, playerData) {
  if (!playerData || !playerData.name) return null;
  if (!room.rewardStats) room.rewardStats = new Map();
  let bucket = room.rewardStats.get(playerData.name);
  if (!bucket) {
    bucket = {
      username: playerData.name,
      userId: playerData.user_id,
      team: playerData.team,
      hits: 0,
      damage: 0,
      kills: 0,
      dropCoins: 0,
      dropGems: 0,
    };
    room.rewardStats.set(playerData.name, bucket);
  } else {
    bucket.userId = playerData.user_id;
    bucket.team = playerData.team;
    bucket.dropCoins = Number(bucket.dropCoins) || 0;
    bucket.dropGems = Number(bucket.dropGems) || 0;
  }
  return bucket;
}

function recordCombatStat(room, playerData, delta = {}) {
  const bucket = ensureRewardBucket(room, playerData);
  if (!bucket) return;
  if (delta.hits) bucket.hits += Math.max(0, delta.hits);
  if (delta.damage) bucket.damage += Math.max(0, Math.round(delta.damage));
  if (delta.kills) bucket.kills += Math.max(0, delta.kills);
}

module.exports = { ensureRewardBucket, recordCombatStat };
