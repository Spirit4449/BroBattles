const WIN_STREAK_TIERS = Object.freeze([
  { streak: 3, currency: 'coins', multiplier: 1.25, label: '+25% coins' },
  { streak: 6, currency: 'gems', multiplier: 1.15, label: '+15% gems' },
  { streak: 9, currency: 'trophies', multiplier: 2, label: '2× trophies' },
].map(Object.freeze));

function winStreakMultipliers(streak) {
  const multipliers = { trophies: 1, coins: 1, gems: 1 };
  for (const tier of WIN_STREAK_TIERS) {
    if (streak >= tier.streak) multipliers[tier.currency] = Math.max(multipliers[tier.currency], tier.multiplier);
  }
  return multipliers;
}

function applyWinStreakRewards(base, streak) {
  const multipliers = winStreakMultipliers(streak);
  const totals = {}, bonuses = {};
  for (const currency of Object.keys(multipliers)) {
    const amount = Number(base[currency]) || 0;
    totals[currency] = amount > 0 ? Math.round(amount * multipliers[currency]) : amount;
    bonuses[currency] = totals[currency] - amount;
  }
  return { totals, bonuses, multipliers };
}

module.exports = { WIN_STREAK_TIERS, winStreakMultipliers, applyWinStreakRewards };
