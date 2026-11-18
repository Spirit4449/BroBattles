const { MATCH_REWARDS } = require("../../../shared/combat/matchConfig");
const { idlePartiesForMatch } = require("./matchLifecycleService");
const {
  resolveMatchModeId,
  buildPerformanceMaxima,
  calculateTrophyDelta,
} = require("../trophies/trophySystem");
const { applyWinStreakRewards } = require("../../../shared/winStreakRewards.cjs");
const { getCurrentWinStreak, recordMatchOutcome } = require("./battleLog");

async function settleMatchResult(db, record) {
  return db.withTransaction(async (_conn, q) => {
    // Serialize completion against every retry before calculating or crediting rewards.
    const matches = await q("SELECT status FROM matches WHERE match_id = ? FOR UPDATE", [
      record.matchId,
    ]);
    const committed = await q("SELECT summary FROM match_reward_commits WHERE match_id = ?", [
      record.matchId,
    ]);
    if (committed[0])
      return typeof committed[0].summary === "string"
        ? JSON.parse(committed[0].summary)
        : committed[0].summary;
    if (!matches[0] || matches[0].status !== "live")
      throw new Error("Match is not eligible for rewards");
    const summary = await applyRewards(record, q);
    await recordMatchOutcome(
      { runQuery: q },
      record,
      record.winnerTeam,
      summary,
    );
    await q("INSERT INTO match_reward_commits (match_id, summary) VALUES (?, ?)", [
      record.matchId,
      JSON.stringify(summary),
    ]);
    await idlePartiesForMatch(q, record.matchId);
    return summary;
  });
}

async function applyRewards(record, q) {
  const { winnerTeam } = record;
  const stats = new Map(record.rewards || []);
  const modeId = resolveMatchModeId(record.matchData || {});
  const userIdToTrophies = new Map();
  const participantUserIds = record.players
    .filter((player) => !player.isBot)
    .map((player) => Number(player?.user_id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (participantUserIds.length) {
    const placeholders = participantUserIds.map(() => "?").join(",");
    const rows = await q(
      `SELECT user_id, COALESCE(trophies, 0) AS trophies FROM users WHERE user_id IN (${placeholders}) ORDER BY user_id FOR UPDATE`,
      participantUserIds,
    );
    for (const row of rows || [])
      userIdToTrophies.set(Number(row.user_id), Math.max(0, Number(row.trophies) || 0));
    if (userIdToTrophies.size !== new Set(participantUserIds).size)
      throw new Error("Reward participant missing");
  }

  const buckets = record.players.map((player) => ({
    hits: 0,
    damage: 0,
    kills: 0,
    ...stats.get(player.name),
    username: player.name,
    team: player.team,
  }));
  const maxima = buildPerformanceMaxima(buckets);
  const summary = [];

  for (const [index, playerData] of record.players.entries()) {
    const bucket = buckets[index];
    // A human who never joined still stood in the match as a ghost: the result
    // moves their trophies, but they earn no coins or gems.
    const noShow = !playerData.isBot && playerData._neverJoined === true;
    const reward = noShow
      ? { coins: 0, gems: 0 }
      : calculateRewards(record, bucket, winnerTeam, playerData.team);
    const currentTrophies = userIdToTrophies.get(Number(playerData?.user_id)) || 0;
    const trophyInfo = calculateTrophyDelta({
      modeId,
      winnerTeam,
      playerTeam: playerData.team,
      bucket,
      maxima,
      currentTrophies,
    });
    const before = playerData.isBot
      ? 0
      : await getCurrentWinStreak({ runQuery: q }, playerData.user_id);
    const isDraw = winnerTeam == null || winnerTeam === "draw";
    const isWin = !isDraw && winnerTeam === playerData.team;
    // A no-show's win neither extends the streak nor earns its bonus; a loss still ends it.
    const after = playerData.isBot
      ? 0
      : isDraw
        ? before
        : isWin
          ? noShow
            ? before
            : before + 1
          : 0;
    const base = {
      coins: reward.coins,
      gems: reward.gems,
      trophies: Number(trophyInfo.trophiesDelta) || 0,
    };
    const boosted = applyWinStreakRewards(base, isWin && !noShow ? after : 0);
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
      ...(!playerData.isBot
        ? {
            winStreakBefore: before,
            winStreakAfter: after,
            winStreakBaseRewards: base,
            winStreakBonuses: boosted.bonuses,
          }
        : {}),
    });
    if (playerData.user_id && !playerData.isBot) {
      const result = await q(
        "UPDATE users SET coins = COALESCE(coins, 0) + ?, gems = COALESCE(gems, 0) + ?, trophies = GREATEST(0, COALESCE(trophies, 0) + ?), trophy_peak = GREATEST(COALESCE(trophy_peak, 0), trophies), highest_win_streak = GREATEST(COALESCE(highest_win_streak, 0), ?) WHERE user_id = ?",
        [totals.coins, totals.gems, totals.trophies, after, playerData.user_id],
      );
      if (result.affectedRows !== 1) throw new Error("Reward participant update failed");
    }
  }

  return summary;
}

function calculateRewards(record, bucket, winnerTeam, playerTeam) {
  const hits = bucket?.hits || 0;
  const damage = bucket?.damage || 0;
  const kills = bucket?.kills || 0;
  const dropCoins = bucket?.dropCoins || 0;
  const dropGems = bucket?.dropGems || 0;
  const isWinner = winnerTeam && playerTeam && winnerTeam === playerTeam;

  const tuning = MATCH_REWARDS;
  const outcomeCoins =
    winnerTeam == null ? tuning.drawCoins : isWinner ? tuning.winCoins : tuning.lossCoins;
  let coins =
    tuning.participationCoins +
    outcomeCoins +
    Math.floor(hits / tuning.hitsPerCoin) +
    Math.floor(damage / tuning.damagePerCoin) +
    kills * tuning.coinsPerKill;
  let gems = isWinner ? tuning.winGems : 0;
  for (const milestone of tuning.gemKillMilestones) if (kills >= milestone) gems++;
  for (const milestone of tuning.gemDamageMilestones) if (damage >= milestone) gems++;

  const overrides = (() => {
    try {
      if (record.runtimeConfig && typeof record.runtimeConfig.get === "function") {
        return record.runtimeConfig.get() || {};
      }
      return record.runtimeConfig || {};
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

  const coinFloor = Number(overrides?.rewardFloor ?? tuning.coinFloor);
  const minCoins = Number.isFinite(coinFloor) ? Math.max(0, coinFloor) : tuning.coinFloor;
  const maxCoins = Number(overrides?.rewardCeiling) || tuning.coinCeiling;
  coins = Math.max(minCoins, Math.min(maxCoins, Math.round(coins)));
  gems = Math.max(0, Math.round(gems));
  coins += Math.max(0, Math.round(dropCoins));
  gems += Math.max(0, Math.round(dropGems));

  return { coins, gems };
}

function snapshotResult(room, winnerTeam) {
  const players = [...room.players.values()].map((p) => ({
    name: p.name,
    user_id: p.user_id,
    team: p.team,
    char_class: p.char_class,
    isBot: !!p.isBot,
    _neverJoined: p._neverJoined === true,
    profile_icon_id: p.profile_icon_id,
  }));
  return {
    matchId: room.matchId,
    matchData: {
      modeId: room.matchData?.modeId,
      modeVariantId: room.matchData?.modeVariantId,
      map: room.matchData?.map,
    },
    winnerTeam,
    players,
    rewards: [...(room.rewardStats || [])].map(([key, bucket]) => [key, { ...bucket }]),
    runtimeConfig: room.runtimeConfig?.get ? room.runtimeConfig.get() : room.runtimeConfig,
  };
}

module.exports = { snapshotResult, settleMatchResult, applyRewards, calculateRewards };
