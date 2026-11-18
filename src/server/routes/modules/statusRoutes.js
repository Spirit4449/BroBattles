const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { asyncRoute, authedRoute } = require("../http");
const { buildStatusPayload } = require("../../services/match/statusPayloadService");
const {
  setBanHoldCookies,
  getBanHoldFromRequest,
} = require("../../services/auth/banHold");
const { normalizeSelection } = require("../../services/match/gameSelectionCatalog");

function registerStatusRoutes({
  app,
  db,
  getOrCreateCurrentUser,
  requireCurrentUser,
  isGuest,
  isAdminUser,
}) {
  app.post(API_PATHS.STATUS, asyncRoute("[status] /status", async (req, res) => {
    const hold = await getBanHoldFromRequest(req, { db, res });
    if (hold) {
      return res.status(403).json({
        success: false,
        banned: true,
        message: String(hold.reason || "Your account has been banned."),
      });
    }

    const payload = await buildStatusPayload({
      db,
      getOrCreateCurrentUser,
      isGuest,
      isAdminUser,
      req,
      res,
    });
    if (payload?.banned) {
      setBanHoldCookies({
        req,
        res,
        userId: payload.userId,
        expiresAt: payload.banExpiresAt,
        reason: String(payload?.message || "Your account has been banned."),
      });
      return res.status(403).json({ success: false, banned: true, message: payload.message });
    }
    res.json(payload);
  }, { messageField: "message" }));

  app.post(API_PATHS.SELECTION_PREFERENCES, authedRoute(requireCurrentUser, "[status] /selection-preferences", async (req, res, user) => {
    const selection = normalizeSelection(
      req.body?.selection || req.body || {},
    );
    await db.setUserPreferredSelection(user.user_id, selection);

    return res.json({
      success: true,
      selection,
    });
  }, { fallback: "Failed to save selection preferences" }));
}

module.exports = { registerStatusRoutes };
