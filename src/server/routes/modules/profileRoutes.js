const bcrypt = require("bcrypt");

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,14}$/;
const MIN_PW = 6;
const MAX_PW = 32;

function registerProfileRoutes({ app, db, requireCurrentUser }) {
  app.get("/profile/data", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const ownedCardIds = await db.getUserOwnedCardIds(user.user_id);
      const selectedCardId = await db.getUserSelectedCardId(user.user_id);
      const matchesRows = await db.runQuery(
        "SELECT COUNT(*) AS total FROM match_participants WHERE user_id = ?",
        [user.user_id],
      );

      let charLevels = {};
      try {
        charLevels =
          typeof user.char_levels === "string"
            ? JSON.parse(user.char_levels || "{}")
            : user.char_levels || {};
      } catch (_) {
        charLevels = {};
      }

      const levelValues = Object.values(charLevels)
        .map((n) => Number(n) || 0)
        .filter((n) => n > 0);
      const avgLevel =
        levelValues.length > 0
          ? Math.round(
              (levelValues.reduce((a, b) => a + b, 0) / levelValues.length) *
                100,
            ) / 100
          : 1;

      return res.json({
        success: true,
        profile: {
          userId: user.user_id,
          username: user.name,
          guest: !!user.expires_at,
          coins: Number(user.coins) || 0,
          gems: Number(user.gems) || 0,
          trophies: Number(user.trophies) || 0,
          charClass: user.char_class || "ninja",
          charLevels,
          avgCharLevel: avgLevel,
          totalMatches: Number(matchesRows?.[0]?.total) || 0,
          selectedCardId,
          ownedCardIds,
        },
      });
    } catch (error) {
      console.error("[profile] /profile/data error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/profile/change-username", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const next = String(req.body?.username || "").trim();
      if (!USERNAME_RE.test(next)) {
        return res.status(400).json({
          success: false,
          error: "Username must be 3-14 chars: letters, numbers, _ . - only.",
        });
      }
      if (next === String(user.name || "")) {
        return res.json({ success: true, username: next });
      }

      await db.withTransaction(async (_conn, q) => {
        await q("UPDATE users SET name = ? WHERE user_id = ?", [
          next,
          user.user_id,
        ]);
        await q("UPDATE party_members SET name = ? WHERE name = ?", [
          next,
          user.name,
        ]);
      });

      res.cookie(
        "display_name",
        next,
        req.app.locals?.DISPLAY_COOKIE_OPTS || {},
      );
      return res.json({ success: true, username: next });
    } catch (error) {
      if (error && (error.code === "ER_DUP_ENTRY" || error.errno === 1062)) {
        return res
          .status(409)
          .json({ success: false, error: "Username is already taken." });
      }
      console.error("[profile] /profile/change-username error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/profile/change-password", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      if (user.expires_at) {
        return res.status(400).json({
          success: false,
          error: "Guest accounts cannot change password. Sign up first.",
        });
      }

      const currentPassword = String(req.body?.currentPassword || "");
      const newPassword = String(req.body?.newPassword || "");

      if (!currentPassword || !newPassword) {
        return res
          .status(400)
          .json({ success: false, error: "Both passwords are required." });
      }
      if (newPassword.length < MIN_PW || newPassword.length > MAX_PW) {
        return res.status(400).json({
          success: false,
          error: `Password must be ${MIN_PW}-${MAX_PW} characters.`,
        });
      }

      const rows = await db.runQuery(
        "SELECT password FROM users WHERE user_id = ? LIMIT 1",
        [user.user_id],
      );
      const existingHash = rows[0]?.password || "";
      const ok = await bcrypt.compare(currentPassword, existingHash);
      if (!ok) {
        return res
          .status(401)
          .json({ success: false, error: "Current password is incorrect." });
      }

      const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
      const nextHash = await bcrypt.hash(newPassword, rounds);
      await db.runQuery("UPDATE users SET password = ? WHERE user_id = ?", [
        nextHash,
        user.user_id,
      ]);

      return res.json({ success: true });
    } catch (error) {
      console.error("[profile] /profile/change-password error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerProfileRoutes };
