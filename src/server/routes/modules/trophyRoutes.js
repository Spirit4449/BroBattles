const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { asyncRoute, authedRoute } = require("../http");
const { httpError } = require("../../services/httpError");

const { createLeaderboardService, findLeaderboardPlayer, PUBLIC_STANDINGS_LIMIT, LEADERBOARD_MAX_PLAYERS } = require("../../services/trophies/leaderboardService");
const { frame } = require("../../services/site/siteContent");
const { renderLeaderboardPage } = require("../../services/site/leaderboardPage");
const { adjustWallet, toWallet } = require("../../services/economy/walletService");
const { parseCharacterLevels } = require("../../../shared/characters/characterStats.js");
const {
  buildTrophyRewardTrack,
  getTrophyTierById,
  summarizeCurrencyRewards,
} = require("../../services/trophies/trophySystem");

function parseLeaderboardLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(LEADERBOARD_MAX_PLAYERS, Math.max(1, Math.floor(n)));
}

async function getClaimedTierIds(db, userId) {
  const rows = await db.runQuery("SELECT tier_id FROM user_trophy_reward_claims WHERE user_id = ?", [userId]);
  return new Set(rows.map(row => String(row.tier_id)).filter(Boolean));
}

function registerTrophyRoutes({ app, db, requireCurrentUser }) {
  const getLeaderboard = createLeaderboardService(db);
  app.get("/leaderboard", asyncRoute("[trophies] public leaderboard", async (req, res) => {
    const username = typeof req.query.username === "string" ? req.query.username.trim() : "";
    let rows;
    try {
      rows = username ? await findLeaderboardPlayer(db, username) : await getLeaderboard(PUBLIC_STANDINGS_LIMIT);
    } catch (error) {
      console.error("[trophies] Could not load public standings", error);
      res.status(503);
    }
    res.send(frame("Leaderboard", "Bro Battles trophy standings and match wins.", renderLeaderboardPage(rows, username), "/leaderboard"));
  }));

  app.get(API_PATHS.LEADERBOARD_TROPHIES, asyncRoute("[trophies] /leaderboard/trophies", async (req, res) => {
    const limit = parseLeaderboardLimit(req.query?.limit);
    const leaderboard = await getLeaderboard(limit);
    return res.json({ success: true, leaderboard });
  }));

  app.get(API_PATHS.TROPHIES_PROGRESSION, authedRoute(requireCurrentUser, "[trophies] /trophies/progression", async (req, res, user) => {
    const userRows = await db.runQuery(
      "SELECT user_id, name, char_levels, coins, gems, trophy_peak, COALESCE(trophies, 0) AS trophies FROM users WHERE user_id = ? LIMIT 1",
      [user.user_id],
    );
    const userRow = userRows[0];
    if (!userRow) {
      return res
        .status(404)
        .json({ success: false, error: "User not found" });
    }

    const claimedTierIds = await getClaimedTierIds(db, user.user_id);
    const trophies = Number(userRow.trophies) || 0;
    let availableClaimCount = 0;
    const tiers = buildTrophyRewardTrack().map((tier) => {
      const claimed = claimedTierIds.has(tier.tierId);
      const unlocked = Math.max(trophies, Number(userRow.trophy_peak) || 0) >= tier.trophiesRequired;
      if (unlocked && !claimed) availableClaimCount += 1;
      return {
        ...tier,
        claimed,
        unlocked,
        canClaim: unlocked && !claimed,
        progressRatio: Math.max(
          0,
          Math.min(1, trophies / Math.max(1, tier.trophiesRequired)),
        ),
      };
    });

    return res.json({
      success: true,
      player: {
        userId: Number(userRow.user_id),
        username: String(userRow.name || ""),
        trophies,
        trophyPeak: Math.max(trophies, Number(userRow.trophy_peak) || 0),
        char_levels: parseCharacterLevels(userRow.char_levels),
        ...toWallet(userRow),
      },
      availableClaimCount,
      tiers,
    });
  }));

  app.post(API_PATHS.TROPHIES_CLAIM, authedRoute(requireCurrentUser, "[trophies] /trophies/claim", async (req, res, user) => {
    const tierId = String(req.body?.tierId || "").trim();
    const tier = getTrophyTierById(tierId);
    if (!tier) {
      return res
        .status(400)
        .json({ success: false, error: "Unknown reward tier" });
    }

    const { reward, userSnapshot } = await db.withTransaction(
      async (_conn, q) => {
        const rows = await q(
          "SELECT user_id, char_levels, trophy_peak, COALESCE(trophies, 0) AS trophies FROM users WHERE user_id = ? FOR UPDATE",
          [user.user_id],
        );
        const row = rows[0];
        if (!row) throw new Error("User not found");

        const trophies = Number(row.trophies) || 0;
        if (Math.max(trophies, Number(row.trophy_peak) || 0) < Number(tier.trophiesRequired || 0)) {
          throw httpError(400, "Tier not unlocked yet");
        }

        const claimInsert = await q(
          "INSERT IGNORE INTO user_trophy_reward_claims (user_id, tier_id) VALUES (?, ?)",
          [user.user_id, tier.tierId],
        );
        if (!claimInsert || Number(claimInsert.affectedRows) === 0) {
          throw httpError(409, "Tier already claimed");
        }

        await require("../../services/trophies/trophyRewardGrants").grantTrophyItems(q, user.user_id, tier.rewards);
        const reward = summarizeCurrencyRewards(tier.rewards);
        await adjustWallet(q, user.user_id, reward);

        const refreshedRows = await q(
          "SELECT COALESCE(trophies, 0) AS trophies, trophy_peak, char_levels, coins, gems FROM users WHERE user_id = ? LIMIT 1",
          [user.user_id],
        );

        return {
          reward,
          userSnapshot: refreshedRows[0] || {
            trophies,
            coins: 0,
            gems: 0,
          },
        };
      },
    );

    return res.json({
      success: true,
      tier,
      reward,
      grants: tier.rewards,
      player: {
        trophies: Number(userSnapshot.trophies) || 0,
        trophyPeak: Number(userSnapshot.trophy_peak) || 0,
        char_levels: parseCharacterLevels(userSnapshot.char_levels),
        ...toWallet(userSnapshot),
      },
    });
  }, {}));
}

module.exports = {
  registerTrophyRoutes,
};
