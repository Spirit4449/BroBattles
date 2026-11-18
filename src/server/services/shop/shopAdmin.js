const { getCosmeticCatalogs, getShopCatalogErrors } = require("./shopCatalog");

function createShopAdmin({ rotationService, buildSections, db }) {
  // What a new player (owning nothing) sees for the given catalog, `weeks` and
  // `days` after the current rotations. Used by the admin store preview, so a
  // draft can be checked before it is published.
  async function buildAdminPreview(catalog, { weeks = 0, days = 0 } = {}) {
    const current = await rotationService.getBoth();
    const shift = (rotation, by) => ({
      ...rotation,
      ordinal: (Number(rotation.ordinal) || 0) + by,
      cycleKey: `${rotation.cycleKey}:preview${by}`,
    });
    const rotations = {
      ...current,
      sales: shift(current.sales, weeks),
      dailies: shift(current.dailies, days),
    };
    const empty = {
      skins: new Set(),
      cards: new Set(),
      profileIcons: new Set(),
      titles: new Set(),
    };
    const sections = buildSections({
      catalog,
      cosmetics: getCosmeticCatalogs(),
      rotations,
      ownership: empty,
      redemptionSet: new Set(),
      paymentsEnabled: true,
    });
    return { sectionMeta: catalog.sections || [], sections, rotations: current };
  }

  async function getAdminStatus() {
    const rotations = await rotationService.getBoth();
    const recentOrders = await db.runQuery(
      "SELECT order_id, user_id, offer_id, status, amount_cents, currency, created_at, fulfilled_at FROM shop_orders ORDER BY created_at DESC LIMIT 12",
    );
    return {
      rotations,
      catalogErrors: getShopCatalogErrors(),
      recentOrders,
    };
  }

  return { buildAdminPreview, getAdminStatus };
}

module.exports = { createShopAdmin };
