const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("../../helpers/profileIconsCatalog");
const {
  syncProfileIconOwnershipForUser,
  unlockProfileIconForUser,
} = require("../../helpers/profileIconOwnership");

function getGemCost(icon) {
  return Math.max(0, Number(icon?.cost?.gems) || 0);
}

function registerProfileIconsRoutes({ app, db, requireCurrentUser }) {
  app.get("/profile-icons/catalog", (_req, res) => {
    const catalog = getProfileIconsCatalog();
    return res.json({ success: true, catalog });
  });

  app.get("/profile-icons/owned", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const sync = await syncProfileIconOwnershipForUser(db, user);
      return res.json({
        success: true,
        ownedIconIds: sync.ownedIconIds || [],
        selectedProfileIconId: sync.selectedProfileIconId || null,
      });
    } catch (error) {
      console.error("[profile-icons] /profile-icons/owned error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/profile-icons/select", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const iconId = String(req.body?.iconId || "").trim();
      if (!iconId) {
        return res
          .status(400)
          .json({ success: false, error: "iconId is required" });
      }

      const icon = getProfileIconById(iconId);
      if (!icon) {
        return res
          .status(404)
          .json({ success: false, error: "Unknown iconId" });
      }

      const sync = await syncProfileIconOwnershipForUser(db, user);
      const owns = new Set((sync.ownedIconIds || []).map(String));
      if (!owns.has(iconId)) {
        return res
          .status(403)
          .json({ success: false, error: "Profile icon is not unlocked" });
      }

      await db.setUserSelectedProfileIconId(user.user_id, iconId);
      return res.json({
        success: true,
        selectedProfileIconId: iconId,
      });
    } catch (error) {
      console.error("[profile-icons] /profile-icons/select error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/profile-icons/buy", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const iconId = String(req.body?.iconId || "").trim();
      if (!iconId) {
        return res
          .status(400)
          .json({ success: false, error: "iconId is required" });
      }

      const icon = getProfileIconById(iconId);
      if (!icon) {
        return res
          .status(404)
          .json({ success: false, error: "Unknown iconId" });
      }

      if (icon?.limited === true) {
        return res.status(400).json({
          success: false,
          error: "Limited icons cannot be purchased.",
        });
      }

      const sync = await syncProfileIconOwnershipForUser(db, user);
      const owns = new Set((sync.ownedIconIds || []).map(String));
      if (owns.has(iconId)) {
        return res.json({
          success: true,
          owned: true,
          iconId,
          gems: Number(user.gems) || 0,
        });
      }

      const gemCost = getGemCost(icon);

      const txResult = await db.withTransaction(async (_conn, q) => {
        const userRows = await q(
          "SELECT gems, selected_profile_icon_id FROM users WHERE user_id = ? FOR UPDATE",
          [user.user_id],
        );
        if (!userRows[0]) {
          return { ok: false, reason: "missing_user" };
        }

        const currentGems = Number(userRows[0].gems) || 0;
        if (currentGems < gemCost) {
          return { ok: false, reason: "insufficient", gems: currentGems };
        }

        const unlocked = await unlockProfileIconForUser(
          { runQuery: q },
          user.user_id,
          iconId,
          "purchase",
        );
        if (!unlocked?.success) {
          return { ok: false, reason: unlocked?.reason || "unlock_failed" };
        }

        const nextGems = currentGems - gemCost;
        await q("UPDATE users SET gems = ? WHERE user_id = ?", [
          nextGems,
          user.user_id,
        ]);

        const selectedProfileIconId =
          String(userRows[0].selected_profile_icon_id || "").trim() || null;
        if (!selectedProfileIconId) {
          await q(
            "UPDATE users SET selected_profile_icon_id = ? WHERE user_id = ?",
            [iconId, user.user_id],
          );
        }

        return {
          ok: true,
          gems: nextGems,
          selectedProfileIconId: selectedProfileIconId || iconId,
        };
      });

      if (!txResult?.ok) {
        if (txResult?.reason === "insufficient") {
          return res.status(400).json({
            success: false,
            error: "Not enough gems for this icon.",
            gems: txResult.gems,
          });
        }
        if (txResult?.reason === "missing_user") {
          return res
            .status(404)
            .json({ success: false, error: "User not found" });
        }
        return res.status(409).json({
          success: false,
          error: "Unable to unlock profile icon right now.",
        });
      }

      return res.json({
        success: true,
        iconId,
        owned: true,
        gems: txResult.gems,
        selectedProfileIconId: txResult.selectedProfileIconId,
      });
    } catch (error) {
      console.error("[profile-icons] /profile-icons/buy error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerProfileIconsRoutes };
