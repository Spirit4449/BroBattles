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

function getUserCharacterLevel(user, character) {
  let levels = user?.char_levels || {};
  if (typeof levels === "string") {
    try {
      levels = JSON.parse(levels || "{}");
    } catch (_) {
      levels = {};
    }
  }
  return Math.max(0, Number(levels?.[character]) || 0);
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
      if (getUserCharacterLevel(user, character) < 1) {
        return res.status(403).json({
          success: false,
          error: "Unlock this character before selecting one of its skins.",
        });
      }

      const sync = await syncSkinOwnershipForUser(db, user);
      const owns = new Set((sync.ownedSkinIds || []).map(String));
      if (!owns.has(skinId)) {
        return res
          .status(403)
          .json({ success: false, error: "Skin is not unlocked" });
      }

      const activateCharacter = req.body?.activateCharacter === true;
      let savedMap;
      if (typeof db.withTransaction === "function") {
        savedMap = await db.withTransaction(async (_conn, q) => {
          const rows = await q(
            "SELECT selected_skin_id_by_char FROM users WHERE user_id = ? FOR UPDATE",
            [user.user_id],
          );
          const nextMap = normalizeSelectedSkinMap(
            rows?.[0]?.selected_skin_id_by_char,
          );
          nextMap[character] = skinId;
          if (activateCharacter) {
            // Save the active character and skin together. This prevents a fast
            // Ready click from capturing only half of the new selection.
            await q(
              "UPDATE users SET char_class = ?, selected_skin_id_by_char = ? WHERE user_id = ?",
              [character, JSON.stringify(nextMap), user.user_id],
            );
          } else {
            await q(
              "UPDATE users SET selected_skin_id_by_char = ? WHERE user_id = ?",
              [JSON.stringify(nextMap), user.user_id],
            );
          }
          return nextMap;
        });
      } else {
        savedMap = normalizeSelectedSkinMap(
          sync.selectedSkinIdByCharacter || user.selected_skin_id_by_char,
        );
        savedMap[character] = skinId;
        if (activateCharacter) {
          await db.runQuery(
            "UPDATE users SET char_class = ?, selected_skin_id_by_char = ? WHERE user_id = ?",
            [character, JSON.stringify(savedMap), user.user_id],
          );
        } else {
          await db.setUserSelectedSkinMap(user.user_id, savedMap);
        }
      }

      return res.json({
        success: true,
        selectedSkinIdByCharacter: savedMap,
        activeCharacter: activateCharacter ? character : user.char_class,
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
      if (skin.available === false) {
        return res.status(400).json({
          success: false,
          error: "This skin is not currently available.",
        });
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
        const ownedRows = await q(
          "SELECT 1 AS ok FROM user_skins WHERE user_id = ? AND skin_id = ? LIMIT 1",
          [user.user_id, skinId],
        );
        if (ownedRows.length) {
          return {
            ok: true,
            alreadyOwned: true,
            gems: currentGems,
            selectedSkinIdByCharacter: normalizeSelectedSkinMap(
              userRows[0].selected_skin_id_by_char,
            ),
          };
        }
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
        if (!unlocked.inserted) {
          return {
            ok: true,
            alreadyOwned: true,
            gems: currentGems,
            selectedSkinIdByCharacter: normalizeSelectedSkinMap(
              userRows[0].selected_skin_id_by_char,
            ),
          };
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
