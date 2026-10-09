const {
  resolveMatchModeId,
  buildPerformanceMaxima,
  calculateTrophyDelta,
} = require("../../services/trophies/trophySystem");
const { applyWinStreakRewards } = require("../../../shared/winStreakRewards.cjs");
const { getCurrentWinStreak } = require("../../services/match/battleLog");

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
  return room.db.withTransaction(async (_conn, q) => {
    // Serialize completion against every retry before calculating or crediting rewards.
    const matches = await q("SELECT status FROM matches WHERE match_id = ? FOR UPDATE", [room.matchId]);
    const committed = await q("SELECT summary FROM match_reward_commits WHERE match_id = ?", [room.matchId]);
    if (committed[0]) return typeof committed[0].summary === "string" ? JSON.parse(committed[0].summary) : committed[0].summary;
    if (!matches[0] || matches[0].status !== "live") throw new Error("Match is not eligible for rewards");
    const summary = await applyMatchRewards(room, winnerTeam, q);
    await require("../../services/match/battleLog").recordMatchOutcome({ runQuery: q, strictResults: true }, room, winnerTeam, summary);
    await q("INSERT INTO match_reward_commits (match_id, summary) VALUES (?, ?)", [room.matchId, JSON.stringify(summary)]);
    await q("UPDATE parties p JOIN match_participants mp ON mp.party_id = p.party_id SET p.status = 'idle' WHERE mp.match_id = ?", [room.matchId]);
    return summary;
  });
}

async function applyMatchRewards(room, winnerTeam, q) {
  if (!room.rewardStats) room.rewardStats = new Map();
  const modeId = resolveMatchModeId(room.matchData || {});
  const userIdToTrophies = new Map();
  const participantUserIds = Array.from(room.players.values())
    .filter((player) => !player.isBot)
    .map((player) => Number(player?.user_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (participantUserIds.length) {
    const placeholders = participantUserIds.map(() => "?").join(",");
    const rows = await q(
      `SELECT user_id, COALESCE(trophies, 0) AS trophies FROM users WHERE user_id IN (${placeholders}) ORDER BY user_id FOR UPDATE`,
      participantUserIds);
    for (const row of rows || []) userIdToTrophies.set(Number(row.user_id), Math.max(0, Number(row.trophies) || 0));
    if (userIdToTrophies.size !== new Set(participantUserIds).size) throw new Error("Reward participant missing");
  }

  const buckets = [];
  for (const playerData of room.players.values()) {
    const bucket = ensureRewardBucket(room, playerData);
    if (!bucket) continue;
    buckets.push(bucket);
  }
  const maxima = buildPerformanceMaxima(buckets);
  const summary = [];

  for (const playerData of room.players.values()) {
    const bucket = ensureRewardBucket(room, playerData) || {
      username: playerData.name,
      team: playerData.team,
      hits: 0,
      damage: 0,
      kills: 0,
    };
    const reward = calculateRewards(room, bucket, winnerTeam, playerData.team);
    const currentTrophies =
      userIdToTrophies.get(Number(playerData?.user_id)) || 0;
    const trophyInfo = calculateTrophyDelta({
      modeId,
      winnerTeam,
      playerTeam: playerData.team,
      bucket,
      maxima,
      currentTrophies,
    });
    const before = playerData.isBot ? 0 : await getCurrentWinStreak({ runQuery: q }, playerData.user_id);
    const isDraw = winnerTeam == null || winnerTeam === 'draw';
    const isWin = !isDraw && winnerTeam === playerData.team;
    const after = playerData.isBot ? 0 : isDraw ? before : isWin ? before + 1 : 0;
    const base = { coins: reward.coins, gems: reward.gems, trophies: Number(trophyInfo.trophiesDelta) || 0 };
    const boosted = applyWinStreakRewards(base, isWin ? after : 0);
    const totals = boosted.totals;
    summary.push({
      username: bucket.username,
      team: bucket.team,
      hits: bucket.hits,
      damage: bucket.damage,
      kills: bucket.kills,
      coinsAwarded: playerData.isBot ? 0 : totals.coins,
      gemsAwarded: playerData.isBot ? 0 : totals.gems,
      trophiesDelta: playerData.isBot ? 0 : totals.trophies,
      trophiesAwarded: playerData.isBot ? 0 : Math.max(0, totals.trophies),
      trophiesLost: playerData.isBot ? 0 : Math.max(0, -totals.trophies),
      ...(!playerData.isBot ? { winStreakBefore: before, winStreakAfter: after,
        winStreakBaseRewards: base, winStreakBonuses: boosted.bonuses } : {}),
    });
    if (playerData.user_id && !playerData.isBot) {
      const result = await q(
        "UPDATE users SET coins = COALESCE(coins, 0) + ?, gems = COALESCE(gems, 0) + ?, trophies = GREATEST(0, COALESCE(trophies, 0) + ?), trophy_peak = GREATEST(COALESCE(trophy_peak, 0), trophies), highest_win_streak = GREATEST(COALESCE(highest_win_streak, 0), ?) WHERE user_id = ?",
        [totals.coins, totals.gems, totals.trophies, after, playerData.user_id]);
      if (result.affectedRows !== 1) throw new Error("Reward participant update failed");
    }
  }

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
  // Keep the participation and outcome rewards approachable while tapering the
  // performance faucet that lets already-strong players compound upgrades.
  const coinFromHits = hits * 2;
  const coinFromDamage = Math.floor(damage / 200);
  const coinFromKills = kills * 25;
  const winBonus = winnerTeam == null ? 10 : isWinner ? 40 : 15;
  let coins =
    baseCoins + coinFromHits + coinFromDamage + coinFromKills + winBonus;
  let gems = 0;
  if (isWinner) gems += 18;
  if (kills >= 1) gems += 9;
  if (kills >= 2) gems += 27;
  if (damage >= 10000) gems += 18;
  if (damage >= 15000) gems += 14;

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
  gems = Math.max(0, Math.round(gems));
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
