const { buildStatusPayload } = require("../../services/statusPayloadService");

function registerStatusRoutes({
  app,
  db,
  getOrCreateCurrentUser,
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
}

module.exports = { registerStatusRoutes };
