const { resolveOwnedSelection, loadOwnedIds, grantCosmetic } = require("./cosmeticCollections");
const { getPlayerCardsCatalog } = require("./playerCardsCatalog");

async function syncPlayerCardOwnershipForUser(db, userRow) {
  const userId = Number(userRow?.user_id) || 0;
  const catalog = getPlayerCardsCatalog();
  const defaultCardId = String(catalog?.defaultCardId || "").trim() || null;
  if (!userId) {
    return { ownedCardIds: [], selectedCardId: defaultCardId };
  }

  return await db.withTransaction(async (_conn, q) => {
    const userRows = await q(
      "SELECT selected_card_id FROM users WHERE user_id = ? FOR UPDATE",
      [userId],
    );
    if (!userRows[0]) {
      return { ownedCardIds: [], selectedCardId: null };
    }
    if (defaultCardId) {
      await grantCosmetic(q, userId, "card", defaultCardId, "default");
    }
    const ownedIds = await loadOwnedIds(q, userId, "card");
    const validIds = new Set(
      (catalog?.cards || []).map((card) => String(card?.id || "")),
    );
    const ownedCardIds = ownedIds.filter(id => validIds.has(id));
    const owned = new Set(ownedCardIds);
    const selected = String(userRows[0].selected_card_id || "").trim();
    const selectedCardId = resolveOwnedSelection(selected, owned, defaultCardId);
    if (selected !== selectedCardId) {
      if (selectedCardId) {
        await q(
          "UPDATE users SET selected_card_id = ? WHERE user_id = ?",
          [selectedCardId, userId],
        );
      }
    }
    return { ownedCardIds, selectedCardId };
  });
}

module.exports = { syncPlayerCardOwnershipForUser };
