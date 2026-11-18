const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("../../services/cosmetics/profileIconsCatalog");
const {
  syncProfileIconOwnershipForUser,
} = require("../../services/cosmetics/profileIconOwnership");
const { authedRoute } = require("../http");

function registerProfileIconsRoutes({ app, db, requireCurrentUser }) {
  app.get(API_PATHS.PROFILE_ICONS_CATALOG, (_req, res) => {
    const catalog = getProfileIconsCatalog();
    return res.json({ success: true, catalog });
  });

  app.get(API_PATHS.PROFILE_ICONS_OWNED, authedRoute(requireCurrentUser, "[profile-icons] /profile-icons/owned", async (_req, res, user) => {
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

  app.post(API_PATHS.PROFILE_ICONS_SELECT, authedRoute(requireCurrentUser, "[profile-icons] /profile-icons/select", async (req, res, user) => {
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
}

module.exports = { registerProfileIconsRoutes };
