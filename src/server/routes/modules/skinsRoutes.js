const { httpError } = require("../../services/httpError");
const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { getCharacterLevel } = require("../../../shared/characters/characterStats.js");
const {
  getSkinsCatalog,
  getSkinById,
  normalizeSelectedSkinMap,
} = require("../../services/cosmetics/skinsCatalog");
const {
  syncSkinOwnershipForUser,
} = require("../../services/cosmetics/skinOwnership");
const { authedRoute } = require("../http");

function registerSkinsRoutes({ app, db, requireCurrentUser }) {
  app.get("/skins/catalog", (_req, res) => {
    return res.json({ success: true, catalog: getSkinsCatalog() });
  });

  app.get(API_PATHS.SKINS_OWNED, authedRoute(requireCurrentUser, "[skins] /skins/owned", async (_req, res, user) => {
    const sync = await syncSkinOwnershipForUser(db, user);
    return res.json({
      success: true,
      ownedSkinIds: sync.ownedSkinIds || [],
      selectedSkinIdByCharacter: sync.selectedSkinIdByCharacter || {},
    });
  }));

  app.post(API_PATHS.SKINS_SELECT, authedRoute(requireCurrentUser, "[skins] /skins/select", async (req, res, user) => {
    const character = String(req.body?.character || "")
      .trim()
      .toLowerCase();
    const skinId = String(req.body?.skinId || "").trim();
    const activateCharacter = req.body?.activateCharacter === true;
    if (!character || !skinId) {
      return res
        .status(400)
        .json({ success: false, error: "character and skinId are required" });
    }

    const skin = getSkinById(skinId);
    if (!skin || String(skin.character || "") !== character) {
      return res.status(404).json({ success: false, error: "Unknown skin" });
    }
    if (getCharacterLevel(user, character) < 1) {
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

    if (activateCharacter) {
      const statusRows = await db.runQuery(
        "SELECT status FROM users WHERE user_id = ? LIMIT 1",
        [user.user_id],
      );
      if (
        String(statusRows?.[0]?.status || "").trim().toLowerCase() ===
        "ready"
      ) {
        return res.status(409).json({
          success: false,
          error: "Unready before changing your character or skin.",
        });
      }
    }

    const savedMap = await db.withTransaction(async (_conn, q) => {
      const rows = await q(
        "SELECT selected_skin_id_by_char, status FROM users WHERE user_id = ? FOR UPDATE",
        [user.user_id],
      );
      if (
        activateCharacter &&
        String(rows?.[0]?.status || "").trim().toLowerCase() === "ready"
      ) {
        throw httpError(409, "Unready before changing your character or skin.");
      }
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

    return res.json({
      success: true,
      selectedSkinIdByCharacter: savedMap,
    });
  }));
}

module.exports = { registerSkinsRoutes };
