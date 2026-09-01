const {
  getSkinsCatalog,
  getCharacterSkins,
  getSkinById,
  normalizeSelectedSkinMap,
} = require("../../helpers/skinsCatalog");
const {
  syncSkinOwnershipForUser,
} = require("../../helpers/skinOwnership");

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

function registerSkinsRoutes({ app, db, requireCurrentUser, shopService }) {
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

      const shopOffer = shopService?.findOfferForGrant?.("skin", skinId);
      if (shopOffer) {
        const idempotencyKey =
          String(req.body?.idempotencyKey || "").trim() ||
          `legacy-skin:${user.user_id}:${skinId}:${Date.now()}`;
        const result = await shopService.purchaseVirtual({
          userId: user.user_id,
          offerId: shopOffer.id,
          idempotencyKey,
        });
        return res.json({
          ...result,
          skinId,
          owned: true,
          coins: result?.wallet?.coins,
          gems: result?.wallet?.gems,
        });
      }

      return res.status(409).json({
        success: false,
        error: "This skin is not currently for sale in the Shop.",
      });
    } catch (error) {
      console.error("[skins] /skins/buy error", error);
      if (Number(error?.status) >= 400 && Number(error?.status) < 600) {
        return res.status(Number(error.status)).json({
          success: false,
          code: error.code || "shop_error",
          error: error.message || "Unable to purchase skin",
          wallet: error.wallet || undefined,
        });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerSkinsRoutes };
