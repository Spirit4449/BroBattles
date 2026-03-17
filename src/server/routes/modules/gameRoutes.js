const { buildGameDataForMatch } = require("../../services/gameDataService");

function registerGameRoutes({ app, db, requireCurrentUser }) {
  app.post("/gamedata", async (req, res) => {
    console.log("Fetching game data for match:", req.body);
    try {
      const result = await buildGameDataForMatch({
        db,
        requireCurrentUser,
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
}

module.exports = { registerGameRoutes };
