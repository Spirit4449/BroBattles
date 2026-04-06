const {
  buildTrophyRewardTrack,
  getTrophyTierById,
  summarizeCurrencyRewards,
} = require("../../helpers/trophySystem");

function parseLimit(value, fallback = 50, max = 200) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

async function getClaimedTierIds(db, userId) {
  try {
    const rows = await db.runQuery(
      "SELECT tier_id FROM user_trophy_reward_claims WHERE user_id = ?",
      [userId],
    );
    return new Set(
      rows.map((row) => String(row.tier_id || "")).filter(Boolean),
    );
  } catch (error) {
    if (error?.code === "ER_NO_SUCH_TABLE") {
      throw new Error(
        "Missing user_trophy_reward_claims table. Apply migrations/2026-04-06_trophy_reward_claims.sql first.",
      );
    }
    throw error;
  }
}

function registerTrophyRoutes({ app, db, requireCurrentUser }) {
  app.get("/leaderboard/trophies", async (req, res) => {
    try {
      const limit = parseLimit(req.query?.limit, 50, 200);
      let rows = [];
      try {
        rows = await db.runQuery(
          `SELECT u.user_id AS userId,
                  u.name AS username,
                  u.char_class AS charClass,
                  COALESCE(u.trophies, 0) AS trophies,
                  (
                    SELECT COUNT(*)
                    FROM match_participants mp
                    JOIN matches m ON m.match_id = mp.match_id
                    WHERE mp.user_id = u.user_id
                      AND m.status = 'completed'
                      AND m.winner_team = mp.team
                  ) AS wins,
                  (
                    SELECT COUNT(*)
                    FROM match_participants mp
                    WHERE mp.user_id = u.user_id
                  ) AS totalMatches
             FROM users u
            WHERE u.name NOT LIKE 'BOT %'
            ORDER BY COALESCE(u.trophies, 0) DESC, u.updated_at DESC, u.name ASC
            LIMIT ?`,
          [limit],
        );
      } catch (innerError) {
        if (innerError?.code !== "ER_BAD_FIELD_ERROR") throw innerError;
        rows = await db.runQuery(
          `SELECT u.user_id AS userId,
                  u.name AS username,
                  u.char_class AS charClass,
                  COALESCE(u.trophies, 0) AS trophies,
                  0 AS wins,
                  (
                    SELECT COUNT(*)
                    FROM match_participants mp
                    WHERE mp.user_id = u.user_id
                  ) AS totalMatches
             FROM users u
            WHERE u.name NOT LIKE 'BOT %'
            ORDER BY COALESCE(u.trophies, 0) DESC, u.updated_at DESC, u.name ASC
            LIMIT ?`,
          [limit],
        );
      }

      const leaderboard = rows.map((row, index) => ({
        rank: index + 1,
        userId: Number(row.userId),
        username: String(row.username || "Unknown"),
        charClass: String(row.charClass || "ninja"),
        trophies: Number(row.trophies) || 0,
        wins: Number(row.wins) || 0,
        totalMatches: Number(row.totalMatches) || 0,
      }));

      return res.json({ success: true, leaderboard });
    } catch (error) {
      console.error("[trophies] /leaderboard/trophies error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.get("/trophies/progression", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const userRows = await db.runQuery(
        "SELECT user_id, name, coins, gems, COALESCE(trophies, 0) AS trophies FROM users WHERE user_id = ? LIMIT 1",
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
        const unlocked = trophies >= tier.trophiesRequired;
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
          coins: Number(userRow.coins) || 0,
          gems: Number(userRow.gems) || 0,
        },
        availableClaimCount,
        tiers,
      });
    } catch (error) {
      const message = String(error?.message || "");
      const status = message.includes("Missing user_trophy_reward_claims")
        ? 503
        : 500;
      if (status === 500) {
        console.error("[trophies] /trophies/progression error", error);
      }
      return res.status(status).json({
        success: false,
        error: message || "Internal server error",
      });
    }
  });

  app.post("/trophies/claim", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

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
            "SELECT user_id, COALESCE(trophies, 0) AS trophies FROM users WHERE user_id = ? LIMIT 1",
            [user.user_id],
          );
          const row = rows[0];
          if (!row) throw new Error("User not found");

          const trophies = Number(row.trophies) || 0;
          if (trophies < Number(tier.trophiesRequired || 0)) {
            const err = new Error("Tier not unlocked yet");
            err.httpStatus = 400;
            throw err;
          }

          const claimInsert = await q(
            "INSERT IGNORE INTO user_trophy_reward_claims (user_id, tier_id) VALUES (?, ?)",
            [user.user_id, tier.tierId],
          );
          if (!claimInsert || Number(claimInsert.affectedRows) === 0) {
            const err = new Error("Tier already claimed");
            err.httpStatus = 409;
            throw err;
          }

          const reward = summarizeCurrencyRewards(tier.rewards);
          if (reward.coins > 0 || reward.gems > 0) {
            await q(
              "UPDATE users SET coins = coins + ?, gems = gems + ? WHERE user_id = ?",
              [reward.coins, reward.gems, user.user_id],
            );
          }

          const refreshedRows = await q(
            "SELECT COALESCE(trophies, 0) AS trophies, coins, gems FROM users WHERE user_id = ? LIMIT 1",
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
        player: {
          trophies: Number(userSnapshot.trophies) || 0,
          coins: Number(userSnapshot.coins) || 0,
          gems: Number(userSnapshot.gems) || 0,
        },
      });
    } catch (error) {
      const message = String(error?.message || "");
      const status =
        Number(error?.httpStatus) ||
        (error?.code === "ER_NO_SUCH_TABLE" ? 503 : 0) ||
        (message.includes("Missing user_trophy_reward_claims") ? 503 : 500);
      if (status === 500) {
        console.error("[trophies] /trophies/claim error", error);
      }
      return res.status(status).json({
        success: false,
        error: message || "Internal server error",
      });
    }
  });
}

module.exports = {
  registerTrophyRoutes,
};
