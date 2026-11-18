const { createShopPresenter } = require("./shopPresenter");
const { createShopRedemptions } = require("./shopRedemptions");
const { createShopViews } = require("./shopViews");
const { createShopAdmin } = require("./shopAdmin");
const { httpError } = require("../httpError");
const { toWallet } = require("../economy/walletService");

const {
  getCosmeticCatalogs,
  getShopCatalog,
  getShopOfferById,
} = require("./shopCatalog");
const { createShopRotationService, DEFAULT_SHOP_TIMEZONE } = require("./shopRotationService");
const { syncSkinOwnershipForUser } = require("../cosmetics/skinOwnership");
const {
  syncProfileIconOwnershipForUser,
} = require("../cosmetics/profileIconOwnership");
const {
  syncPlayerCardOwnershipForUser,
} = require("../cosmetics/playerCardOwnership");

function normalizeIdempotencyKey(raw) {
  const value = String(raw || "").trim();
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(value)) return null;
  return value;
}

function currencyAsset(currency) {
  return currency === "gems" ? "/assets/icons/gem.webp" : "/assets/icons/coin.webp";
}

function titleCase(value) {
  return String(value || "")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createShopError(status, code, message, detail = {}) {
  return httpError(status, message, { code, details: detail });
}

function createShopService({ db, catalogProvider = getShopCatalog }) {
  const rotationService = createShopRotationService({
    db,
    getTimeZone: () => catalogProvider().timezone || DEFAULT_SHOP_TIMEZONE,
  });

  async function getFreshUser(userId, runner = db.runQuery) {
    const rows = await runner(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [Number(userId)],
    );
    return rows[0] || null;
  }

  async function getOwnership(user) {
    const titleState = await require("../cosmetics/titleOwnership").getTitleOwnership(db, user);
    const [skinState, iconState, cardState] = await Promise.all([
      syncSkinOwnershipForUser(db, user),
      syncProfileIconOwnershipForUser(db, user),
      syncPlayerCardOwnershipForUser(db, user),
    ]);
    return {
      titles: new Set(titleState.ownedTitleIds),
      skins: new Set((skinState?.ownedSkinIds || []).map(String)),
      cards: new Set((cardState?.ownedCardIds || []).map(String)),
      profileIcons: new Set((iconState?.ownedIconIds || []).map(String)),
    };
  }

  async function buildBootstrap(user, { paymentsEnabled = false, publishableKey = null } = {}) {
    const freshUser = (await getFreshUser(user.user_id)) || user;
    const catalog = catalogProvider();
    const cosmetics = getCosmeticCatalogs();
    const [rotations, ownership, redemptionRows, viewedRows] = await Promise.all([
      rotationService.getBoth(),
      getOwnership(freshUser),
      db.runQuery(
        "SELECT offer_id, limit_key, status FROM shop_redemptions WHERE user_id = ? AND status = 'fulfilled'",
        [freshUser.user_id],
      ),
      db.runQuery("SELECT view_kind, view_key FROM shop_views WHERE user_id = ?", [freshUser.user_id]),
    ]);
    const redemptionSet = new Set(
      (redemptionRows || []).map(
        (row) => `${String(row.limit_key || "")}:${String(row.offer_id || "")}`,
      ),
    );
    const sections = buildSections({ catalog, cosmetics, rotations, ownership, redemptionSet, paymentsEnabled });

    const viewed = new Set(viewedRows.map(row => `${row.view_kind}:${row.view_key}`));
    const notifications = { sections: {}, hasNew: false };
    for (const meta of catalog.sections || []) {
      const items = sections[meta.id] || [];
      for (const item of items) {
        item.isNew = item.kind !== "daily" && item.state.available && !item.state.owned && !item.state.purchased
          && !viewed.has(`offer:${item.id}`);
      }
      const cycleKey = rotations[meta.id]?.cycleKey || null;
      const refreshed = !!cycleKey && !viewed.has(`rotation:${meta.id}:${cycleKey}`);
      const offerIds = items.filter(item => item.isNew).map(item => item.id);
      notifications.sections[meta.id] = { cycleKey, refreshed, offerIds, hasNew: refreshed || offerIds.length > 0 };
      notifications.hasNew ||= notifications.sections[meta.id].hasNew;
    }
    return {
      success: true,
      notifications,
      serverNow: new Date().toISOString(),
      wallet: toWallet(freshUser),
      account: { guest: !!freshUser.expires_at },
      payment: {
        enabled: !!paymentsEnabled,
        publishableKey: paymentsEnabled ? publishableKey : null,
      },
      rotations,
      sectionMeta: catalog.sections,
      sections,
    };
  }

  const { describeGrants, buildSections } = createShopPresenter({ currencyAsset, titleCase });
  const { applyGrants, purchaseVirtual, claimDaily } = createShopRedemptions({ normalizeIdempotencyKey, createShopError, db, describeGrants, catalogProvider, rotationService });
  const { markViewed } = createShopViews({ createShopError, catalogProvider, rotationService, db });
  const { buildAdminPreview, getAdminStatus } = createShopAdmin({ rotationService, buildSections, db });

  return {
    applyGrants,
    describeGrants,
    buildBootstrap,
    markViewed,
    claimDaily,
    createShopError,
    getAdminStatus,
    buildAdminPreview,
    getFreshUser,
    getShopOfferById,
    normalizeIdempotencyKey,
    purchaseVirtual,
    rotationService,
  };
}

module.exports = { createShopService, createShopError, normalizeIdempotencyKey };
