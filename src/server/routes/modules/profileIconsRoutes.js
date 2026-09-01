const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("../../helpers/profileIconsCatalog");
const {
  syncProfileIconOwnershipForUser,
} = require("../../helpers/profileIconOwnership");

function registerProfileIconsRoutes({ app, db, requireCurrentUser, shopService }) {
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

      const shopOffer = shopService?.findOfferForGrant?.("profileIcon", iconId);
      if (shopOffer) {
        const idempotencyKey =
          String(req.body?.idempotencyKey || "").trim() ||
          `legacy-icon:${user.user_id}:${iconId}:${Date.now()}`;
        const result = await shopService.purchaseVirtual({
          userId: user.user_id,
          offerId: shopOffer.id,
          idempotencyKey,
        });
        return res.json({
          ...result,
          iconId,
          owned: true,
          coins: result?.wallet?.coins,
          gems: result?.wallet?.gems,
        });
      }

      return res.status(409).json({
        success: false,
        error: "This profile icon is earned through progression, not purchased.",
      });
    } catch (error) {
      console.error("[profile-icons] /profile-icons/buy error", error);
      if (Number(error?.status) >= 400 && Number(error?.status) < 600) {
        return res.status(Number(error.status)).json({
          success: false,
          code: error.code || "shop_error",
          error: error.message || "Unable to purchase profile icon",
          wallet: error.wallet || undefined,
        });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerProfileIconsRoutes };
