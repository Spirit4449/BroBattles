const { getTitlesCatalog, getTitleById } = require("../../services/cosmetics/titlesCatalog");
const { getTitleOwnership } = require("../../services/cosmetics/titleOwnership");
const { authedRoute } = require("../routeHelpers");
function registerTitlesRoutes({ app, db, requireCurrentUser }) {
  app.get("/titles/catalog", (_req, res) => res.json({ success: true, catalog: getTitlesCatalog() }));
  app.get("/titles/owned", authedRoute(requireCurrentUser, "[titles] owned", async (_req, res, user) =>
    res.json({ success: true, ...await getTitleOwnership(db, user) })));
  app.post("/titles/select", authedRoute(requireCurrentUser, "[titles] select", async (req, res, user) => {
    const titleId = req.body?.titleId;
    if (titleId !== null && (typeof titleId !== "string" || !getTitleById(titleId))) {
      return res.status(400).json({ success: false, error: "Unknown title" });
    }
    const state = await getTitleOwnership(db, user);
    if (state.schemaMissing) return res.status(503).json({ success: false, error: "Titles are temporarily unavailable" });
    if (titleId !== null && !state.ownedTitleIds.includes(titleId)) {
      return res.status(403).json({ success: false, error: "You do not own this title" });
    }
    await db.runQuery("UPDATE users SET selected_title_id = ? WHERE user_id = ?", [titleId, user.user_id]);
    return res.json({ success: true, selectedTitleId: titleId });
  }));
}
module.exports = { registerTitlesRoutes };
