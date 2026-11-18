const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const {
  getPlayerCardById,
  getPlayerCardsCatalog,
} = require("../../services/cosmetics/playerCardsCatalog");
const {
  syncPlayerCardOwnershipForUser,
} = require("../../services/cosmetics/playerCardOwnership");
const { authedRoute } = require("../http");

function registerPlayerCardsRoutes({ app, db, requireCurrentUser }) {
  app.get(API_PATHS.PLAYER_CARDS_CATALOG, (_req, res) => {
    const catalog = getPlayerCardsCatalog();
    return res.json({ success: true, catalog });
  });

  app.get(API_PATHS.PLAYER_CARDS_OWNED, authedRoute(requireCurrentUser, "[cards] /player-cards/owned", async (_req, res, user) => {
    const cardState = await syncPlayerCardOwnershipForUser(db, user);
    return res.json({
      success: true,
      ownedCardIds: cardState.ownedCardIds || [],
      selectedCardId: cardState.selectedCardId || null,
    });
  }));

  // Validates `cardId` against the catalog; answers the request and returns
  // null when it is missing or unknown.
  function resolveCardId(req, res) {
    const cardId = String(req.body?.cardId || "").trim();
    if (!cardId) {
      res.status(400).json({ success: false, error: "cardId is required" });
      return null;
    }
    if (!getPlayerCardById(cardId)) {
      res.status(404).json({ success: false, error: "Unknown cardId" });
      return null;
    }
    return cardId;
  }

  app.post(API_PATHS.PLAYER_CARDS_SELECT, authedRoute(requireCurrentUser, "[cards] /player-cards/select", async (req, res, user) => {
    const cardId = resolveCardId(req, res);
    if (!cardId) return undefined;
    if (!(await db.userOwnsCard(user.user_id, cardId))) {
      return res
        .status(403)
        .json({ success: false, error: "Card is not owned by this user" });
    }
    await db.setUserSelectedCardId(user.user_id, cardId);
    return res.json({ success: true, selectedCardId: cardId });
  }));
}

module.exports = { registerPlayerCardsRoutes };
