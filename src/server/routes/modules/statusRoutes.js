const { buildStatusPayload } = require("../../services/statusPayloadService");
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
      const payload = await buildStatusPayload({
        db,
        getOrCreateCurrentUser,
        isGuest,
        isAdminUser,
        req,
        res,
      });
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
