const {
  getPlayerCardById,
  getPlayerCardsCatalog,
} = require("../../helpers/playerCardsCatalog");
const {
  syncPlayerCardOwnershipForUser,
} = require("../../helpers/playerCardOwnership");

function registerPlayerCardsRoutes({ app, db, requireCurrentUser, shopService }) {
  app.get("/player-cards/catalog", (req, res) => {
    const catalog = getPlayerCardsCatalog();
    return res.json({ success: true, catalog });
  });

  app.get("/player-cards/owned", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user)
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });

      const cardState = await syncPlayerCardOwnershipForUser(db, user);

      return res.json({
        success: true,
        ownedCardIds: cardState.ownedCardIds || [],
        selectedCardId: cardState.selectedCardId || null,
      });
    } catch (error) {
      console.error("[cards] /player-cards/owned error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/player-cards/select", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user)
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });

      const cardId = String(req.body?.cardId || "").trim();
      if (!cardId) {
        return res
          .status(400)
          .json({ success: false, error: "cardId is required" });
      }

      const card = getPlayerCardById(cardId);
      if (!card) {
        return res
          .status(404)
          .json({ success: false, error: "Unknown cardId" });
      }

      const ownsCard = await db.userOwnsCard(user.user_id, cardId);
      if (!ownsCard) {
        return res
          .status(403)
          .json({ success: false, error: "Card is not owned by this user" });
      }

      await db.setUserSelectedCardId(user.user_id, cardId);

      return res.json({
        success: true,
        selectedCardId: cardId,
      });
    } catch (error) {
      console.error("[cards] /player-cards/select error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });

  app.post("/player-cards/buy", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user)
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });

      const cardId = String(req.body?.cardId || "").trim();
      if (!cardId) {
        return res
          .status(400)
          .json({ success: false, error: "cardId is required" });
      }

      const card = getPlayerCardById(cardId);
      if (!card) {
        return res
          .status(404)
          .json({ success: false, error: "Unknown cardId" });
      }

      const shopOffer = shopService?.findOfferForGrant?.("card", cardId);
      if (shopOffer) {
        const idempotencyKey =
          String(req.body?.idempotencyKey || "").trim() ||
          `legacy-card:${user.user_id}:${cardId}:${Date.now()}`;
        const result = await shopService.purchaseVirtual({
          userId: user.user_id,
          offerId: shopOffer.id,
          idempotencyKey,
        });
        return res.json({
          ...result,
          cardId,
          owned: true,
          coins: result?.wallet?.coins,
          gems: result?.wallet?.gems,
        });
      }

      const cardState = await syncPlayerCardOwnershipForUser(db, user);
      if (new Set((cardState.ownedCardIds || []).map(String)).has(cardId)) {
        return res.json({ success: true, owned: true, cardId });
      }
      return res.status(409).json({
        success: false,
        error: "This card is not currently for sale in the Shop.",
      });
    } catch (error) {
      console.error("[cards] /player-cards/buy error", error);
      if (Number(error?.status) >= 400 && Number(error?.status) < 600) {
        return res.status(Number(error.status)).json({
          success: false,
          code: error.code || "shop_error",
          error: error.message || "Unable to purchase card",
          wallet: error.wallet || undefined,
        });
      }
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerPlayerCardsRoutes };
