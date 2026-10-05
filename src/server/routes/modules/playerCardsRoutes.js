const {
  getPlayerCardById,
  getPlayerCardsCatalog,
} = require("../../services/cosmetics/playerCardsCatalog");
const {
  syncPlayerCardOwnershipForUser,
} = require("../../services/cosmetics/playerCardOwnership");
const { authedRoute, sendShopError, purchaseGrantFromShop } = require("../routeHelpers");

function registerPlayerCardsRoutes({ app, db, requireCurrentUser, shopService }) {
  app.get("/player-cards/catalog", (_req, res) => {
    const catalog = getPlayerCardsCatalog();
    return res.json({ success: true, catalog });
  });

  app.get("/player-cards/owned", authedRoute(requireCurrentUser, "[cards] /player-cards/owned", async (_req, res, user) => {
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

  app.post("/player-cards/select", authedRoute(requireCurrentUser, "[cards] /player-cards/select", async (req, res, user) => {
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

  app.post("/player-cards/buy", authedRoute(requireCurrentUser, "[cards] /player-cards/buy", async (req, res, user) => {
    const cardId = resolveCardId(req, res);
    if (!cardId) return undefined;

    const purchase = await purchaseGrantFromShop({
      shopService, req, user, grantType: "card", grantId: cardId, idempotencyPrefix: "legacy-card",
    });
    if (purchase) return res.json({ ...purchase, cardId });

    const cardState = await syncPlayerCardOwnershipForUser(db, user);
    if (new Set((cardState.ownedCardIds || []).map(String)).has(cardId)) {
      return res.json({ success: true, owned: true, cardId });
    }
    return res.status(409).json({
      success: false,
      error: "This card is not currently for sale in the Shop.",
    });
  }, { onError: (error, res) => sendShopError(res, error, "Unable to purchase card") }));
}

module.exports = { registerPlayerCardsRoutes };
