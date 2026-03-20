const {
  getPlayerCardById,
  getPlayerCardsCatalog,
} = require("../../helpers/playerCardsCatalog");

function registerPlayerCardsRoutes({ app, db, requireCurrentUser }) {
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

      const ownedCardIds = await db.getUserOwnedCardIds(user.user_id);
      const selectedCardId = await db.getUserSelectedCardId(user.user_id);

      return res.json({
        success: true,
        ownedCardIds,
        selectedCardId,
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

      const alreadyOwned = await db.userOwnsCard(user.user_id, cardId);
      if (alreadyOwned) {
        return res.json({ success: true, owned: true, cardId });
      }

      const coinCost = Math.max(0, Number(card?.cost?.coins) || 0);
      const gemCost = Math.max(0, Number(card?.cost?.gems) || 0);

      const txResult = await db.withTransaction(async (_conn, q) => {
        const rows = await q(
          "SELECT coins, gems FROM users WHERE user_id = ? FOR UPDATE",
          [user.user_id],
        );
        if (!rows[0]) {
          throw new Error("User not found");
        }
        const coins = Number(rows[0].coins) || 0;
        const gems = Number(rows[0].gems) || 0;

        if (coins < coinCost || gems < gemCost) {
          return { ok: false, reason: "insufficient", coins, gems };
        }

        const insertResult = await q(
          "INSERT IGNORE INTO user_cards (user_id, card_id, source) VALUES (?, ?, 'purchase')",
          [user.user_id, cardId],
        );

        const boughtNow = Number(insertResult?.affectedRows) > 0;
        if (!boughtNow) {
          return { ok: true, coins, gems, owned: true };
        }

        const nextCoins = coins - coinCost;
        const nextGems = gems - gemCost;

        await q("UPDATE users SET coins = ?, gems = ? WHERE user_id = ?", [
          nextCoins,
          nextGems,
          user.user_id,
        ]);

        const selectedRows = await q(
          "SELECT selected_card_id FROM users WHERE user_id = ? LIMIT 1",
          [user.user_id],
        );
        if (!selectedRows[0]?.selected_card_id) {
          await q("UPDATE users SET selected_card_id = ? WHERE user_id = ?", [
            cardId,
            user.user_id,
          ]);
        }

        return { ok: true, coins: nextCoins, gems: nextGems, owned: true };
      });

      if (!txResult?.ok && txResult?.reason === "insufficient") {
        return res.status(400).json({
          success: false,
          error: "Not enough coins/gems for this card.",
          coins: txResult.coins,
          gems: txResult.gems,
        });
      }

      return res.json({
        success: true,
        cardId,
        owned: true,
        coins: txResult?.coins,
        gems: txResult?.gems,
      });
    } catch (error) {
      console.error("[cards] /player-cards/buy error", error);
      return res
        .status(500)
        .json({ success: false, error: "Internal server error" });
    }
  });
}

module.exports = { registerPlayerCardsRoutes };
