const trophyCatalog = require("../../shared/trophySystem.catalog.json");

const MODE_RANGES = trophyCatalog?.modeTrophyRanges || {};
const WEIGHTS = trophyCatalog?.performanceWeights || {};
const LOSS_RANGE_SCALE = Math.max(
  0.1,
  Math.min(1, Number(trophyCatalog?.lossRangeScale) || 0.5),
);
const LOSS_PERFORMANCE_MITIGATION = Math.max(
  0,
  Math.min(0.9, Number(trophyCatalog?.lossPerformanceMitigation) || 0.35),
);

function getModeTrophyRange(modeId) {
  const key = String(modeId || "").trim();
  const entry = MODE_RANGES[key] || MODE_RANGES.default || { min: 20, max: 30 };
  const min = Math.max(1, Number(entry.min) || 20);
  const max = Math.max(min, Number(entry.max) || min);
  return { min, max };
}

function resolveMatchModeId(matchData = {}) {
  const modeId = String(matchData?.modeId || "").trim();
  if (modeId) return modeId;
  return "duels";
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function buildPerformanceMaxima(rewardBuckets) {
  const stats = Array.isArray(rewardBuckets) ? rewardBuckets : [];
  return {
    hits: Math.max(1, ...stats.map((entry) => Number(entry?.hits) || 0)),
    damage: Math.max(1, ...stats.map((entry) => Number(entry?.damage) || 0)),
    kills: Math.max(1, ...stats.map((entry) => Number(entry?.kills) || 0)),
  };
}

function getPerformanceScore(bucket, maxima) {
  const hitsRatio = clamp01(
    (Number(bucket?.hits) || 0) / Math.max(1, maxima?.hits || 1),
  );
  const damageRatio = clamp01(
    (Number(bucket?.damage) || 0) / Math.max(1, maxima?.damage || 1),
  );
  const killsRatio = clamp01(
    (Number(bucket?.kills) || 0) / Math.max(1, maxima?.kills || 1),
  );

  const damageWeight = Number(WEIGHTS.damage) || 0.55;
  const killsWeight = Number(WEIGHTS.kills) || 0.3;
  const hitsWeight = Number(WEIGHTS.hits) || 0.15;

  return clamp01(
    damageRatio * damageWeight +
      killsRatio * killsWeight +
      hitsRatio * hitsWeight,
  );
}

function lerp(min, max, t) {
  return min + (max - min) * clamp01(t);
}

function calculateTrophyDelta({
  modeId,
  winnerTeam,
  playerTeam,
  bucket,
  maxima,
  currentTrophies,
}) {
  const range = getModeTrophyRange(modeId);
  const score = getPerformanceScore(bucket, maxima);
  const isWinner = winnerTeam && playerTeam && winnerTeam === playerTeam;

  const gain = Math.round(lerp(range.min, range.max, score));

  if (winnerTeam == null) {
    return {
      trophiesDelta: Math.max(0, Math.round(gain * 0.55)),
      performanceScore: score,
    };
  }

  if (isWinner) {
    return { trophiesDelta: gain, performanceScore: score };
  }

  const lossMin = Math.max(1, Math.round(range.min * LOSS_RANGE_SCALE));
  const lossMax = Math.max(lossMin, Math.round(range.max * LOSS_RANGE_SCALE));
  const mitigated = 1 - score * LOSS_PERFORMANCE_MITIGATION;
  const rawLoss = Math.round(lerp(lossMin, lossMax, clamp01(mitigated)));
  const cappedLoss = Math.min(
    Math.max(0, Number(currentTrophies) || 0),
    rawLoss,
  );

  return {
    trophiesDelta: -cappedLoss,
    performanceScore: score,
  };
}

function buildTrophyRewardTrack() {
  const track = trophyCatalog?.rewardTrack || {};
  const step = Math.max(25, Number(track.step) || 100);
  const maxTrophies = Math.max(step, Number(track.maxTrophies) || 2000);
  const rewardPattern = Array.isArray(track.rewardPattern)
    ? track.rewardPattern
    : [];
  const majorMilestones = track?.majorMilestones || {};
  const tiers = [];

  for (
    let trophiesRequired = step;
    trophiesRequired <= maxTrophies;
    trophiesRequired += step
  ) {
    const key = String(trophiesRequired);
    const major = majorMilestones[key];
    const pattern = rewardPattern.length
      ? rewardPattern[
          (Math.floor(trophiesRequired / step) - 1) % rewardPattern.length
        ]
      : null;

    const source = major || pattern;
    const rewards = Array.isArray(source?.rewards)
      ? source.rewards.map((entry, idx) => ({
          kind: String(entry?.kind || "currency"),
          currency: entry?.currency ? String(entry.currency) : null,
          amount: Math.max(0, Number(entry?.amount) || 0),
          itemId: entry?.itemId ? String(entry.itemId) : null,
          name: String(entry?.name || `Reward ${idx + 1}`),
          image: String(entry?.image || "/assets/coin.webp"),
        }))
      : [];

    tiers.push({
      tierId: `trophy-tier-${trophiesRequired}`,
      trophiesRequired,
      title: String(
        source?.title || `Tier ${Math.floor(trophiesRequired / step)}`,
      ),
      rewards,
    });
  }

  return tiers;
}

function getTrophyTierById(tierId) {
  const wanted = String(tierId || "").trim();
  if (!wanted) return null;
  return (
    buildTrophyRewardTrack().find((tier) => tier.tierId === wanted) || null
  );
}

function summarizeCurrencyRewards(rewards) {
  let coins = 0;
  let gems = 0;

  for (const reward of Array.isArray(rewards) ? rewards : []) {
    if (String(reward?.kind || "") !== "currency") continue;
    const amount = Math.max(0, Number(reward?.amount) || 0);
    const currency = String(reward?.currency || "");
    if (currency === "coins") coins += amount;
    if (currency === "gems") gems += amount;
  }

  return { coins, gems };
}

module.exports = {
  resolveMatchModeId,
  buildPerformanceMaxima,
  calculateTrophyDelta,
  buildTrophyRewardTrack,
  getTrophyTierById,
  summarizeCurrencyRewards,
};
