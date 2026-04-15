const { buildStatusPayload } = require("../../services/statusPayloadService");
const { setBanHoldCookies, getBanHoldFromRequest } = require("../../helpers/banHold");
const {
  normalizeSelection,
} = require("../../helpers/gameSelectionCatalog");

function registerStatusRoutes({
  app,
  db,
  getOrCreateCurrentUser,
  requireCurrentUser,
  isGuest,
  isAdminUser,
}) {
  app.post("/status", async (req, res) => {
    try {
      const hold = getBanHoldFromRequest(req);
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
          reason: String(payload?.message || "Your account has been banned."),
        });
        try {
          res.clearCookie("user_id", req.app.locals?.SIGNED_COOKIE_OPTS || {});
          res.clearCookie("display_name", req.app.locals?.DISPLAY_COOKIE_OPTS || {});
        } catch (_) {}
        return res.status(403).json(payload);
      }
      res.json(payload);
    } catch (e) {
      console.error(e);
      res
        .status(500)
        .json({ success: false, message: "Internal server error" });
    }
  });

  app.post("/selection-preferences", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }

      const selection = normalizeSelection(req.body?.selection || req.body || {});
      await db.setUserPreferredSelection(user.user_id, selection);

      return res.json({
        success: true,
        selection,
      });
    } catch (error) {
      console.error("[status] failed to save selection preferences", error);
      return res.status(500).json({
        success: false,
        error: error?.message || "Failed to save selection preferences",
      });
    }
  });
}

module.exports = { registerStatusRoutes };
