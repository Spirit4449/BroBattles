const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { buildGameDataForMatch } = require("../../services/match/gameDataService");

function registerGameRoutes({
  app,
  db,
  requireCurrentUser,
  isAdminUser,
  abuseControl,
}) {
  app.post(API_PATHS.GAMEDATA, async (req, res) => {
    try {
      const result = await buildGameDataForMatch({
        db,
        requireCurrentUser,
        isAdminUser,
        abuseControl,
        req,
        res,
      });
      if (result.handled) return;
      if (!result.ok) {
        return res.status(result.statusCode || 400).json(result.payload || {});
      }
      return res.json(result.payload);
    } catch (error) {
      console.error("gamedata error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

  app.post("/api/admin/map-editor/save-file", (_req, res) => res.status(410).json({error: "Use the standalone /map-editor and versioned /api/admin/maps API."}));
}
module.exports = { registerGameRoutes };
