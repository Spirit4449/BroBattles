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

async function distributeMatchRewards(room, winnerTeam) {
  if (!room.rewardStats) room.rewardStats = new Map();
  const summary = [];
  const updates = [];

  for (const playerData of room.players.values()) {
    const bucket = ensureRewardBucket(room, playerData) || {
      username: playerData.name,
      team: playerData.team,
      hits: 0,
      damage: 0,
      kills: 0,
    };
    const reward = calculateRewards(room, bucket, winnerTeam, playerData.team);
    summary.push({
      username: bucket.username,
      team: bucket.team,
      hits: bucket.hits,
      damage: bucket.damage,
      kills: bucket.kills,
      coinsAwarded: reward.coins,
      gemsAwarded: reward.gems,
    });
    if ((reward.coins > 0 || reward.gems > 0) && playerData.user_id) {
      updates.push(
        room.db
          .runQuery(
            "UPDATE users SET coins = coins + ?, gems = gems + ? WHERE user_id = ?",
            [reward.coins, reward.gems, playerData.user_id],
          )
          .catch((e) => {
            console.warn(
              `[GameRoom ${room.matchId}] Failed to update rewards for ${playerData.name}`,
              e?.message,
            );
          }),
      );
    }
  }

  if (updates.length) await Promise.all(updates);
  return summary;
}

function calculateRewards(room, bucket, winnerTeam, playerTeam) {
  const hits = bucket?.hits || 0;
  const damage = bucket?.damage || 0;
  const kills = bucket?.kills || 0;
  const dropCoins = bucket?.dropCoins || 0;
  const dropGems = bucket?.dropGems || 0;
  const isWinner = winnerTeam && playerTeam && winnerTeam === playerTeam;

  const baseCoins = 40;
  const coinFromHits = hits * 3;
  const coinFromDamage = Math.floor(damage / 150);
  const coinFromKills = kills * 30;
  const winBonus = winnerTeam == null ? 10 : isWinner ? 40 : 15;
  let coins =
    baseCoins + coinFromHits + coinFromDamage + coinFromKills + winBonus;
  let gems = 0;
  if (isWinner) gems += 20;
  if (kills >= 1) gems += 10;
  if (kills >= 2) gems += 30;
  if (damage >= 10000) gems += 20;
  if (damage >= 15000) gems += 15;

  const overrides = (() => {
    try {
      if (room.runtimeConfig && typeof room.runtimeConfig.get === "function") {
        return room.runtimeConfig.get() || {};
      }
      return room.runtimeConfig || {};
    } catch (_) {
      return {};
    }
  })();

  const rewardMultipliers = overrides?.rewardMultipliers || {};
  const coinMultiplier = Number(rewardMultipliers.coins) || 1;
  const gemMultiplier = Number(rewardMultipliers.gems) || 1;
  if (Number.isFinite(coinMultiplier) && coinMultiplier > 0) {
    coins *= coinMultiplier;
  }
  if (Number.isFinite(gemMultiplier) && gemMultiplier > 0) {
    gems *= gemMultiplier;
  }

  const minCoins = Number(overrides?.rewardFloor) || 5;
  const maxCoins = Number(overrides?.rewardCeiling) || 500;
  coins = Math.max(minCoins, Math.min(maxCoins, Math.round(coins)));
  coins += Math.max(0, Math.round(dropCoins));
  gems += Math.max(0, Math.round(dropGems));

  return { coins, gems };
}

module.exports = {
  ensureRewardBucket,
  recordCombatStat,
  distributeMatchRewards,
  calculateRewards,
};
