const test = require("node:test");
const assert = require("node:assert/strict");

const {
  calculateRewards,
} = require("../src/server/core/gameRoom/rewardManager");

function rewards(bucket, winnerTeam = "team1", playerTeam = "team1", runtimeConfig = null) {
  return calculateRewards({ runtimeConfig }, bucket, winnerTeam, playerTeam);
}

test("performance taper preserves result rewards while reducing combat scaling", () => {
  assert.deepEqual(
    rewards({ hits: 3, damage: 670, kills: 1 }),
    { coins: 35, gems: 2 },
  );
  assert.deepEqual(
    rewards({ hits: 3, damage: 420, kills: 0 }, "team1", "team2"),
    { coins: 18, gems: 0 },
  );
  assert.deepEqual(
    rewards({ hits: 0, damage: 0, kills: 0 }, null, "team1"),
    { coins: 18, gems: 0 },
  );
});

test("high-performance gem milestones use the tapered whole-number values", () => {
  assert.deepEqual(
    rewards({ hits: 10, damage: 2670, kills: 3 }),
    { coins: 57, gems: 5 },
  );
});

test("collected drops retain their full value after the reward taper", () => {
  assert.deepEqual(
    rewards({
      hits: 3,
      damage: 670,
      kills: 1,
      dropCoins: 7,
      dropGems: 3,
    }),
    { coins: 42, gems: 5 },
  );
});

test("runtime multipliers round core rewards before adding whole collected drops", () => {
  const runtimeConfig = {
    get() {
      return {
        rewardMultipliers: { coins: 0.5, gems: 0.5 },
        rewardFloor: 5,
        rewardCeiling: 500,
      };
    },
  };

  assert.deepEqual(
    rewards(
      {
        hits: 3,
        damage: 670,
        kills: 1,
        dropCoins: 7,
        dropGems: 3,
      },
      "team1",
      "team1",
      runtimeConfig,
    ),
    { coins: 25, gems: 4 },
  );
});

test("the coin ceiling still applies before collected drops", () => {
  assert.deepEqual(
    rewards({
      hits: 1000,
      damage: 1000000,
      kills: 100,
      dropCoins: 8,
    }),
    { coins: 158, gems: 5 },
  );
});


test('streak tiers combine currency bonuses at their configured thresholds', () => {
  const { WIN_STREAK_TIERS, winStreakMultipliers, applyWinStreakRewards } = require('../src/shared/winStreakRewards.cjs');
  const base = { trophies: 29, coins: 111, gems: 27 };
  for (const tier of WIN_STREAK_TIERS) {
    const result = applyWinStreakRewards(base, tier.streak);
    assert.equal(result.totals[tier.currency], Math.round(base[tier.currency] * tier.multiplier));
    assert.equal(result.bonuses[tier.currency], result.totals[tier.currency] - base[tier.currency]);
    const previous = winStreakMultipliers(tier.streak - 1);
    assert.ok(previous[tier.currency] < tier.multiplier);
  }
  const top = WIN_STREAK_TIERS.at(-1);
  const active = winStreakMultipliers(top.streak);
  assert.equal(active.trophies, top.multiplier, 'trophies use the configured top tier');
  assert.ok(active.coins > 1 && active.gems > 1, 'other unlocked currencies stay active');
  assert.deepEqual(applyWinStreakRewards(base, 0).totals, base);
  assert.equal(applyWinStreakRewards({ trophies: -14, coins: 0, gems: 0 }, top.streak).totals.trophies, -14);
});

test('a human who never joined moves trophies but earns no coins, gems or streak', async () => {
  const { applyMatchRewards } = require('../src/server/core/gameRoom/rewardManager');
  const updates = new Map();
  const q = async (sql, params) => {
    if (sql.startsWith('SELECT user_id')) return params.map((user_id) => ({ user_id, trophies: 400 }));
    // Both players won their last two matches on team1.
    if (sql.includes('FROM match_participants')) return params.length > 2 ? [] :
      [{ match_id: 2, winner_team: 'team1', team: 'team1' }, { match_id: 1, winner_team: 'team1', team: 'team1' }];
    if (sql.startsWith('UPDATE users')) { updates.set(params.at(-1), params); return { affectedRows: 1 }; }
    throw new Error(`unexpected query: ${sql}`);
  };
  const player = (user_id, name, extra = {}) => ({ user_id, name, team: 'team1', isBot: false, ...extra });
  const room = { matchData: { mode: 1 }, players: new Map([
    ['a', player(1, 'Played')],
    ['offline:2', player(2, 'NoShow', { _neverJoined: true })],
  ]) };
  const summary = await applyMatchRewards(room, 'team1', q);
  const played = summary.find((s) => s.username === 'Played');
  const noShow = summary.find((s) => s.username === 'NoShow');
  assert.ok(played.coinsAwarded > 0);
  assert.equal(noShow.coinsAwarded, 0);
  assert.equal(noShow.gemsAwarded, 0);
  assert.ok(noShow.trophiesDelta > 0, 'the win still moves trophies');
  assert.equal(noShow.trophiesDelta, noShow.winStreakBaseRewards.trophies, 'no streak bonus');
  assert.equal(noShow.winStreakAfter, noShow.winStreakBefore, 'the streak does not grow');
  assert.equal(played.winStreakAfter, played.winStreakBefore + 1);
  assert.deepEqual(updates.get(2).slice(0, 2), [0, 0]);
});
