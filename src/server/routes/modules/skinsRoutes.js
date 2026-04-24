const {
  getSkinsCatalog,
  getCharacterSkins,
  getSkinById,
  normalizeSelectedSkinMap,
} = require("../../helpers/skinsCatalog");
const {
  syncSkinOwnershipForUser,
  unlockSkinForUser,
} = require("../../helpers/skinOwnership");

function getGemCost(skin) {
  return Math.max(0, Number(skin?.price?.gems) || 0);
}

function registerSkinsRoutes({ app, db, requireCurrentUser }) {
  app.get("/skins/catalog", (_req, res) => {
    return res.json({ success: true, catalog: getSkinsCatalog() });
  });

  app.get("/skins/owned", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const sync = await syncSkinOwnershipForUser(db, user);
      return res.json({
        success: true,
        ownedSkinIds: sync.ownedSkinIds || [],
        selectedSkinIdByCharacter: sync.selectedSkinIdByCharacter || {},
      });
    } catch (error) {
      console.error("[skins] /skins/owned error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/skins/select", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const character = String(req.body?.character || "")
        .trim()
        .toLowerCase();
      const skinId = String(req.body?.skinId || "").trim();
      if (!character || !skinId) {
        return res
          .status(400)
          .json({ success: false, error: "character and skinId are required" });
      }

      const skin = getSkinById(skinId);
      if (!skin || String(skin.character || "") !== character) {
        return res.status(404).json({ success: false, error: "Unknown skin" });
      }

      const sync = await syncSkinOwnershipForUser(db, user);
      const owns = new Set((sync.ownedSkinIds || []).map(String));
      if (!owns.has(skinId)) {
        return res
          .status(403)
          .json({ success: false, error: "Skin is not unlocked" });
      }

      const currentMap = normalizeSelectedSkinMap(
        sync.selectedSkinIdByCharacter || user.selected_skin_id_by_char,
      );
      currentMap[character] = skinId;

      await db.setUserSelectedSkinMap(user.user_id, currentMap);

      return res.json({
        success: true,
        selectedSkinIdByCharacter: currentMap,
      });
    } catch (error) {
      console.error("[skins] /skins/select error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/skins/buy", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }

      const character = String(req.body?.character || "")
        .trim()
        .toLowerCase();
      const skinId = String(req.body?.skinId || "").trim();
      if (!character || !skinId) {
        return res
          .status(400)
          .json({ success: false, error: "character and skinId are required" });
      }

      const skin = getSkinById(skinId);
      if (!skin || String(skin.character || "") !== character) {
        return res.status(404).json({ success: false, error: "Unknown skin" });
      }

      const limited = !!skin?.unlockMethod?.limited;
      if (limited) {
        return res.status(400).json({
          success: false,
          error: "This skin cannot be purchased directly.",
        });
      }

      const sync = await syncSkinOwnershipForUser(db, user);
      const owns = new Set((sync.ownedSkinIds || []).map(String));
      if (owns.has(skinId)) {
        return res.json({
          success: true,
          owned: true,
          skinId,
          gems: Number(user.gems) || 0,
        });
      }

      const gemCost = getGemCost(skin);

      const txResult = await db.withTransaction(async (_conn, q) => {
        const userRows = await q(
          "SELECT gems, selected_skin_id_by_char FROM users WHERE user_id = ? FOR UPDATE",
          [user.user_id],
        );
        if (!userRows[0]) return { ok: false, reason: "missing_user" };

        const currentGems = Number(userRows[0].gems) || 0;
        if (currentGems < gemCost) {
          return { ok: false, reason: "insufficient", gems: currentGems };
        }

        const unlocked = await unlockSkinForUser(
          { runQuery: q },
          user.user_id,
          skinId,
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

        const selectedMap = normalizeSelectedSkinMap(
          userRows[0].selected_skin_id_by_char,
        );
        selectedMap[character] = skinId;
        await q(
          "UPDATE users SET selected_skin_id_by_char = ? WHERE user_id = ?",
          [JSON.stringify(selectedMap), user.user_id],
        );

        return {
          ok: true,
          gems: nextGems,
          selectedSkinIdByCharacter: selectedMap,
        };
      });

      if (!txResult?.ok) {
        if (txResult?.reason === "insufficient") {
          return res
            .status(400)
            .json({
              success: false,
              error: "Not enough gems for this skin.",
              gems: txResult.gems,
            });
        }
        if (txResult?.reason === "missing_user") {
          return res
            .status(404)
            .json({ success: false, error: "User not found" });
        }
        return res
          .status(409)
          .json({ success: false, error: "Unable to unlock skin right now." });
      }

      return res.json({
        success: true,
        skinId,
        owned: true,
        gems: txResult.gems,
        selectedSkinIdByCharacter: txResult.selectedSkinIdByCharacter,
      });
    } catch (error) {
      console.error("[skins] /skins/buy error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerSkinsRoutes };
