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
    rewards({ hits: 3, damage: 4000, kills: 1 }),
    { coins: 131, gems: 27 },
  );
  assert.deepEqual(
    rewards({ hits: 3, damage: 2500, kills: 0 }, "team1", "team2"),
    { coins: 73, gems: 0 },
  );
  assert.deepEqual(
    rewards({ hits: 0, damage: 0, kills: 0 }, null, "team1"),
    { coins: 50, gems: 0 },
  );
});

test("high-performance gem milestones use the tapered whole-number values", () => {
  assert.deepEqual(
    rewards({ hits: 10, damage: 16000, kills: 3 }),
    { coins: 255, gems: 86 },
  );
});

test("collected drops retain their full value after the reward taper", () => {
  assert.deepEqual(
    rewards({
      hits: 3,
      damage: 4000,
      kills: 1,
      dropCoins: 7,
      dropGems: 3,
    }),
    { coins: 138, gems: 30 },
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
        damage: 4000,
        kills: 1,
        dropCoins: 7,
        dropGems: 3,
      },
      "team1",
      "team1",
      runtimeConfig,
    ),
    { coins: 73, gems: 17 },
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
    { coins: 508, gems: 86 },
  );
});
