const {
  LEVEL_CAP,
  upgradePrice,
  unlockPrice,
} = require("../../lib/characterStats");
const { unlockProfileIconForUser } = require("../helpers/profileIconOwnership");

function registerEconomyRoutes({ app, db, auth }) {
  app.post("/upgrade", async (req, res) => {
    try {
      const user = await auth.requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const username = user.name;
      const character = req.body.character;

      if (
        typeof character !== "string" ||
        !/^[a-zA-Z0-9_:-]{1,32}$/.test(character)
      ) {
        return res.status(400).json({ error: "Invalid character key" });
      }

      const jsonPath = `$.${character}`;

      const result = await db.withTransaction(async (conn, q) => {
        const rows = await q(
          "SELECT coins, JSON_EXTRACT(char_levels, ?) AS lvl FROM users WHERE name = ? FOR UPDATE",
          [jsonPath, username],
        );
        if (rows.length === 0) {
          return { status: 404, body: { error: "User not found" } };
        }

        const dbCoins = Number(rows[0].coins);
        const dbLevel = rows[0].lvl == null ? 0 : Number(rows[0].lvl);

        if (dbLevel >= LEVEL_CAP) {
          return { status: 409, body: { error: "Level cap reached" } };
        }

        const price = upgradePrice(dbLevel);
        if (!Number.isFinite(price) || price < 0) {
          return { status: 500, body: { error: "Pricing error" } };
        }
        if (dbCoins < price) {
          return { status: 403, body: { error: "Not enough coins" } };
        }

        const ok = await q(
          `UPDATE users
             SET coins = coins - ?,
                 char_levels = JSON_SET(char_levels, ?, ?)
           WHERE name = ?
             AND coins >= ?
             AND COALESCE(JSON_EXTRACT(char_levels, ?), 0) = ?`,
          [price, jsonPath, dbLevel + 1, username, price, jsonPath, dbLevel],
        );
        if (!ok || !ok.affectedRows) {
          return { status: 409, body: { error: "Upgrade conflict, retry" } };
        }

        return {
          status: 200,
          body: { success: true, newLevel: dbLevel + 1, spent: price },
        };
      });

      if (!result || typeof result.status !== "number") {
        throw new Error("Unexpected upgrade result");
      }
      if (result.status !== 200)
        return res.status(result.status).json(result.body);

      console.log(
        `${username} upgrade ${character} to level ${result.body.newLevel} for ${result.body.spent} coins`,
      );
      return res.status(200).json(result.body);
    } catch (err) {
      console.error("[economy] upgrade error", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/buy", async (req, res) => {
    try {
      const user = await auth.requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const username = user.name;
      const character = req.body.character;

      if (
        typeof character !== "string" ||
        !/^[a-zA-Z0-9_:-]{1,32}$/.test(character)
      ) {
        return res.status(400).json({ error: "Invalid character key" });
      }

      const price = unlockPrice(character);
      if (price === undefined) {
        return res.status(400).json({ error: "Character cannot be unlocked" });
      }
      if (!Number.isFinite(price) || price < 0) {
        return res.status(500).json({ error: "Pricing error" });
      }

      const jsonPath = `$.${character}`;
      const result = await db.withTransaction(async (conn, q) => {
        const ok = await q(
          `UPDATE users
              SET gems = gems - ?,
                  char_levels = JSON_SET(COALESCE(char_levels, JSON_OBJECT()), ?, 1)
            WHERE name = ?
              AND gems >= ?
              AND IFNULL(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, ?)) AS UNSIGNED), 0) < 1`,
          [price, jsonPath, username, price, jsonPath],
        );

        if (!ok || !ok.affectedRows) {
          const rows = await q(
            `SELECT gems,
                    IFNULL(CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, ?)) AS UNSIGNED), 0) AS lvl
               FROM users WHERE name = ?`,
            [jsonPath, username],
          );
          if (!rows.length)
            return { status: 404, body: { error: "User not found" } };
          const { gems, lvl } = rows[0];
          if (lvl >= 1)
            return {
              status: 409,
              body: { error: "Character already unlocked" },
            };
          if (Number(gems) < price)
            return { status: 403, body: { error: "Not enough gems" } };
          return {
            status: 409,
            body: { error: "Unlock conflict, please retry" },
          };
        }

        const after = await q(
          `SELECT gems,
                  CAST(JSON_UNQUOTE(JSON_EXTRACT(char_levels, ?)) AS UNSIGNED) AS lvl
             FROM users WHERE name = ?`,
          [jsonPath, username],
        );
        const newGems = after[0]?.gems;
        const newLevel = after[0]?.lvl ?? 1;

        return {
          status: 200,
          body: {
            success: true,
            character,
            newLevel,
            spent: price,
            gems: newGems,
          },
        };
      });

      if (!result || typeof result.status !== "number") {
        throw new Error("Unexpected buy result");
      }
      if (result.status !== 200)
        return res.status(result.status).json(result.body);

      try {
        await unlockProfileIconForUser(
          db,
          user.user_id,
          character,
          "character_unlock",
        );
      } catch (error) {
        console.warn(
          `[economy] profile icon unlock skipped for ${character}:`,
          error?.message || error,
        );
      }

      console.log(`${username} unlocked ${character} for ${price} gems`);
      return res.status(200).json(result.body);
    } catch (err) {
      console.error("[economy] buy error", err);
      return res.status(500).json({ error: "Internal error" });
    }
  });
}

module.exports = { registerEconomyRoutes };
