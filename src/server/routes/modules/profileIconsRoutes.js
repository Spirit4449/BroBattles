const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("../../services/cosmetics/profileIconsCatalog");
const {
  syncProfileIconOwnershipForUser,
} = require("../../services/cosmetics/profileIconOwnership");
const { authedRoute, sendShopError, purchaseGrantFromShop } = require("../routeHelpers");

function registerProfileIconsRoutes({ app, db, requireCurrentUser, shopService }) {
  app.get("/profile-icons/catalog", (_req, res) => {
    const catalog = getProfileIconsCatalog();
    return res.json({ success: true, catalog });
  });

  app.get("/profile-icons/owned", authedRoute(requireCurrentUser, "[profile-icons] /profile-icons/owned", async (_req, res, user) => {
    const sync = await syncProfileIconOwnershipForUser(db, user);
    return res.json({
      success: true,
      ownedIconIds: sync.ownedIconIds || [],
      selectedProfileIconId: sync.selectedProfileIconId || null,
    });
  }));

  // Validates `iconId` and returns the user's synced ownership, or null after
  // answering the request.
  async function resolveIcon(req, res, user) {
    const iconId = String(req.body?.iconId || "").trim();
    if (!iconId) {
      res.status(400).json({ success: false, error: "iconId is required" });
      return null;
    }
    if (!getProfileIconById(iconId)) {
      res.status(404).json({ success: false, error: "Unknown iconId" });
      return null;
    }
    const sync = await syncProfileIconOwnershipForUser(db, user);
    return { iconId, owned: new Set((sync.ownedIconIds || []).map(String)).has(iconId) };
  }

  app.post("/profile-icons/select", authedRoute(requireCurrentUser, "[profile-icons] /profile-icons/select", async (req, res, user) => {
    const icon = await resolveIcon(req, res, user);
    if (!icon) return undefined;
    if (!icon.owned) {
      return res
        .status(403)
        .json({ success: false, error: "Profile icon is not unlocked" });
    }
    await db.setUserSelectedProfileIconId(user.user_id, icon.iconId);
    return res.json({ success: true, selectedProfileIconId: icon.iconId });
  }));

  app.post("/profile-icons/buy", authedRoute(requireCurrentUser, "[profile-icons] /profile-icons/buy", async (req, res, user) => {
    const icon = await resolveIcon(req, res, user);
    if (!icon) return undefined;
    const { iconId } = icon;
    if (icon.owned) {
      return res.json({ success: true, owned: true, iconId, gems: Number(user.gems) || 0 });
    }

    const purchase = await purchaseGrantFromShop({
      shopService, req, user, grantType: "profileIcon", grantId: iconId, idempotencyPrefix: "legacy-icon",
    });
    if (purchase) return res.json({ ...purchase, iconId });

    return res.status(409).json({
      success: false,
      error: "This profile icon is earned through progression, not purchased.",
    });
  }, { onError: (error, res) => sendShopError(res, error, "Unable to purchase profile icon") }));
}

module.exports = { registerProfileIconsRoutes };
