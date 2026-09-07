const { buildGameDataForMatch } = require("../../services/gameDataService");

function registerGameRoutes({
  app,
  db,
  requireCurrentUser,
  isAdminUser,
  abuseControl,
}) {
  app.post("/gamedata", async (req, res) => {
    console.log("Fetching game data for match:", req.body);
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
