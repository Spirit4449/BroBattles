function createShopViews({ createShopError, catalogProvider, rotationService, db }) {
  async function markViewed({ userId, rotations = {}, offerIds = [] }) {
    if (
      !Array.isArray(offerIds) ||
      offerIds.length > 200 ||
      !rotations ||
      typeof rotations !== "object" ||
      Array.isArray(rotations)
    ) {
      throw createShopError(400, "invalid_views", "Invalid viewed shop content.");
    }
    const catalog = catalogProvider();
    const knownOffers = new Set((catalog.offers || []).map((offer) => offer.id));
    const views = [];
    for (const id of new Set(offerIds)) {
      if (typeof id !== "string" || !knownOffers.has(id))
        throw createShopError(400, "invalid_views", "Unknown shop item.");
      views.push(["offer", id]);
    }
    const current = await rotationService.getBoth();
    for (const [section, cycleKey] of Object.entries(rotations)) {
      if (!["sales", "dailies"].includes(section) || typeof cycleKey !== "string") {
        throw createShopError(400, "invalid_views", "Unknown shop rotation.");
      }
      // An older screen must never acknowledge a refresh the player has not seen.
      if (current[section].cycleKey === cycleKey)
        views.push(["rotation", `${section}:${cycleKey}`]);
    }
    if (views.length) {
      await db.runQuery(
        `INSERT IGNORE INTO shop_views (user_id, view_kind, view_key) VALUES ${views.map(() => "(?, ?, ?)").join(", ")}`,
        views.flatMap(([kind, key]) => [Number(userId), kind, key]),
      );
    }
    return { success: true };
  }

  return { markViewed };
}

module.exports = { createShopViews };
