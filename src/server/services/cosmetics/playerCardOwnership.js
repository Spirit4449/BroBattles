const { getPlayerCardsCatalog } = require("./playerCardsCatalog");

async function syncPlayerCardOwnershipForUser(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  const catalog = getPlayerCardsCatalog();
  const defaultCardId = String(catalog?.defaultCardId || "").trim() || null;
  if (!userId) {
    return { ownedCardIds: [], selectedCardId: defaultCardId };
  }

  try {
    return await db.withTransaction(async (_conn, q) => {
      const userRows = await q(
        "SELECT selected_card_id FROM users WHERE user_id = ? FOR UPDATE",
        [userId],
      );
      if (!userRows[0]) {
        return { ownedCardIds: [], selectedCardId: null };
      }
      if (defaultCardId) {
        await q(
          "INSERT IGNORE INTO user_cards (user_id, card_id, source) VALUES (?, ?, 'default')",
          [userId, defaultCardId],
        );
      }
      const ownedRows = await q(
        "SELECT card_id FROM user_cards WHERE user_id = ?",
        [userId],
      );
      const validIds = new Set(
        (catalog?.cards || []).map((card) => String(card?.id || "")),
      );
      const ownedCardIds = ownedRows
        .map((row) => String(row.card_id || ""))
        .filter((id) => id && validIds.has(id));
      const owned = new Set(ownedCardIds);
      let selectedCardId =
        String(userRows[0].selected_card_id || "").trim() || null;
      if (!selectedCardId || !owned.has(selectedCardId)) {
        selectedCardId =
          (defaultCardId && owned.has(defaultCardId) && defaultCardId) ||
          ownedCardIds[0] ||
          null;
        if (selectedCardId) {
          await q(
            "UPDATE users SET selected_card_id = ? WHERE user_id = ?",
            [selectedCardId, userId],
          );
        }
      }
      return { ownedCardIds, selectedCardId };
    });
  } catch (error) {
    if (
      error?.code === "ER_NO_SUCH_TABLE" ||
      error?.code === "ER_BAD_FIELD_ERROR"
    ) {
      return {
        ownedCardIds: defaultCardId ? [defaultCardId] : [],
        selectedCardId: defaultCardId,
        schemaMissing: true,
      };
    }
    throw error;
  }
}

module.exports = { syncPlayerCardOwnershipForUser };
