const { buildOfferIndexes } = require("./shopOfferRules");
const fs = require("fs");
const path = require("path");
const { createCatalogLoader, deepFreeze } = require("../../lib/catalogLoader");
const cards = require("../cosmetics/playerCardsCatalog");
const profileIcons = require("../cosmetics/profileIconsCatalog");
const skins = require("../cosmetics/skinsCatalog");

const { getPlayerCardById, getPlayerCardsCatalog } = cards;
const { getProfileIconById, getProfileIconsCatalog } = profileIcons;
const { getSkinById, getSkinsCatalog } = skins;

const CATALOG_PATH = path.resolve(__dirname, "../../../shared/catalogs/shopCatalog.json");
const PUBLIC_PATH = path.resolve(__dirname, "../../../../public");
const CURRENCIES = new Set(["coins", "gems"]);
const PRICE_TYPES = new Set(["virtual", "money"]);
const PURCHASE_LIMITS = new Set(["lifetime", "unlimited"]);
const FALLBACK_TIMEZONE = "America/New_York";

const rawLoader = createCatalogLoader({
  name: "shop",
  filePath: CATALOG_PATH,
  fallback: () => ({ version: 1, timezone: FALLBACK_TIMEZONE, sections: [], offers: [] }),
});

// Validation (including banner existence checks) is cached per combination of
// shop + cosmetic catalog versions, so a cosmetic reload revalidates grants.
let validated = null;

function validateBanner(value, location, errors) {
  const banner = String(value || "");
  if (!/^\/assets\/shop\/banners\/[a-z0-9-]+\.webp$/.test(banner)) {
    errors.push(`${location}: invalid shop banner path`);
    return;
  }
  if (!fs.existsSync(path.join(PUBLIC_PATH, banner))) {
    errors.push(`${location}: shop banner asset is missing`);
  }
}

function validateGrant(grant, location, errors) {
  const kind = String(grant?.kind || "");
  if (kind === "currency") {
    if (!CURRENCIES.has(String(grant?.currency || ""))) {
      errors.push(`${location}: unknown currency`);
    }
    if (!Number.isSafeInteger(grant?.amount) || Number(grant?.amount) <= 0) {
      errors.push(`${location}: currency amount must be a positive integer`);
    }
    return;
  }
  if (kind === "skin" && !getSkinById(grant?.id)) {
    errors.push(`${location}: unknown skin ${String(grant?.id || "")}`);
    return;
  }
  if (kind === "card" && !getPlayerCardById(grant?.id)) {
    errors.push(`${location}: unknown card ${String(grant?.id || "")}`);
    return;
  }
  if (kind === "profileIcon" && !getProfileIconById(grant?.id)) {
    errors.push(`${location}: unknown profile icon ${String(grant?.id || "")}`);
    return;
  }
  if (!["currency", "skin", "card", "profileIcon"].includes(kind)) {
    errors.push(`${location}: unsupported grant kind ${kind || "(empty)"}`);
  }
}

function validateCatalog(raw) {
  const errors = [];
  try {
    new Intl.DateTimeFormat("en-US", {
      timeZone: String(raw?.timezone || ""),
    }).format(new Date());
  } catch (_) {
    errors.push("timezone must be a valid IANA timezone");
  }
  const sections = new Set(
    (Array.isArray(raw?.sections) ? raw.sections : []).map((entry) =>
      String(entry?.id || ""),
    ),
  );
  if (!Array.isArray(raw?.sections) || !raw.sections.length) errors.push("sections must not be empty");
  const sectionIds = new Set();
  for (const section of Array.isArray(raw?.sections) ? raw.sections : []) {
    if (!/^[a-z][a-z0-9-]*$/.test(section?.id || "") || sectionIds.has(section.id)) errors.push("sections must have unique valid ids");
    sectionIds.add(section?.id);
    if (!section?.name || typeof section.name !== "string") errors.push("sections require a name");
    if (!/^\/assets\/shop\/icons\/[a-z0-9-]+\.(webp|svg)$/.test(section?.icon || "") || !fs.existsSync(path.join(PUBLIC_PATH, String(section?.icon || "")))) errors.push("sections require a local shop icon");
    if (section?.rotation != null && !["sales", "dailies"].includes(section.rotation)) errors.push("sections have an unsupported rotation");
  }
  if (!sections.has("sales") || !sections.has("dailies")) errors.push("sections require sales and dailies");
  if (!Array.isArray(raw?.offers)) errors.push("offers must be an array");
  const seen = new Set();
  const offers = Array.isArray(raw?.offers) ? raw.offers : [];

  for (const [index, offer] of offers.entries()) {
    const id = String(offer?.id || "").trim();
    const at = `offers[${index}]${id ? ` (${id})` : ""}`;
    if (!id) errors.push(`${at}: id is required`);
    if (id && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
      errors.push(`${at}: invalid id`);
    }
    if (seen.has(id)) errors.push(`${at}: duplicate id`);
    seen.add(id);
    if (id !== offer?.id) errors.push(`${at}: id must not contain whitespace`);
    if (!["item", "bundle", "currency-pack"].includes(offer?.kind)) errors.push(`${at}: unsupported offer kind`);
    if (!offer?.name || typeof offer.name !== "string") errors.push(`${at}: name is required`);
    if (offer?.section === "dailies") errors.push(`${at}: use rotation.dailies.rewards for daily offers`);
    if (offer?.saleDiscountPercent != null && (!Number.isInteger(offer.saleDiscountPercent) || offer.saleDiscountPercent < 0 || offer.saleDiscountPercent > 90)) errors.push(`${at}: saleDiscountPercent must be an integer from 0 to 90`);
    if (!sections.has(String(offer?.section || ""))) {
      errors.push(`${at}: unknown section`);
    }
    const price = offer?.price || {};
    if (!PRICE_TYPES.has(String(price.type || ""))) {
      errors.push(`${at}: invalid price type`);
    } else if (price.type === "virtual") {
      if (!CURRENCIES.has(String(price.currency || ""))) {
        errors.push(`${at}: invalid virtual currency`);
      }
      if (!Number.isSafeInteger(price.amount) || Number(price.amount) <= 0) {
        errors.push(`${at}: invalid virtual price`);
      }
    } else if (
      String(price.currency || "").toLowerCase() !== "usd" ||
      !Number.isSafeInteger(price.amountCents) ||
      Number(price.amountCents) < 50
    ) {
      errors.push(`${at}: invalid USD price`);
    }
    const grants = Array.isArray(offer?.grants) ? offer.grants : [];
    if (!grants.length) errors.push(`${at}: at least one grant is required`);
    if (offer?.kind === "item" && (grants.length !== 1 || grants[0]?.kind === "currency")) errors.push(`${at}: item offers require one cosmetic; use bundle for multiple grants`);
    if (offer?.kind === "currency-pack" && grants.some(grant => grant?.kind !== "currency")) errors.push(`${at}: currency-pack must grant currency only`);
    const grantKeys = grants.map(grant => `${grant?.kind}:${grant?.id || grant?.currency}`);
    if (new Set(grantKeys).size !== grantKeys.length) errors.push(`${at}: duplicate grants must be combined`);
    if (price.type === "money" && (offer?.purchaseLimit !== "unlimited" || offer?.eligibility != null)) errors.push(`${at}: real-money offers require unlimited purchases and no eligibility rules`);
    grants.forEach((grant, grantIndex) =>
      validateGrant(grant, `${at}.grants[${grantIndex}]`, errors),
    );
    if (
      price.type === "money" &&
      grants.some((grant) => String(grant?.kind || "") !== "currency")
    ) {
      errors.push(`${at}: real-money offers must grant currency only`);
    }
    if (!PURCHASE_LIMITS.has(String(offer?.purchaseLimit || ""))) {
      errors.push(`${at}: invalid purchase limit`);
    }
    validateBanner(offer?.banner, `${at}.banner`, errors);
    if (offer?.eligibility?.requiresNotOwned) {
      const required = offer.eligibility.requiresNotOwned;
      if (required.kind === "currency" || !grants.some(grant => grant?.kind === required.kind && grant?.id === required.id)) errors.push(`${at}: requiresNotOwned must reference an included cosmetic`);
      validateGrant(
        offer.eligibility.requiresNotOwned,
        `${at}.eligibility.requiresNotOwned`,
        errors,
      );
    }
  }

  const dailyRewards = raw?.rotation?.dailies?.rewards;
  if (!Array.isArray(dailyRewards) || !dailyRewards.length) {
    errors.push("rotation.dailies.rewards must not be empty");
  } else {
    const seenDailyIds = new Set();
    dailyRewards.forEach((reward, rewardIndex) => {
      const grants = Array.isArray(reward?.grants) ? reward.grants : [];
      const rewardId = String(reward?.id || "").trim();
      if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(rewardId) || rewardId !== reward?.id || seen.has(rewardId)) {
        errors.push(`daily reward ${rewardIndex}: id is required`);
      }
      if (seenDailyIds.has(rewardId)) {
        errors.push(`daily reward ${rewardIndex}: duplicate id`);
      }
      seenDailyIds.add(rewardId);
      if (!grants.length) {
        errors.push(`daily reward ${rewardIndex}: at least one grant is required`);
      }
      validateBanner(
        reward?.banner,
        `daily reward ${rewardIndex}.banner`,
        errors,
      );
      grants.forEach((grant, grantIndex) =>
        validateGrant(
          grant,
          `daily reward ${rewardIndex}.grants[${grantIndex}]`,
          errors,
        ),
      );
    });
  }

  const sales = raw?.rotation?.sales || {};
  const referencedSales = [];
  for (const key of ["pinnedOfferIds", "promotedOfferIds"]) {
    if (!Array.isArray(sales[key])) errors.push(`rotation.sales.${key} must be an array`);
    else referencedSales.push(...sales[key]);
  }
  if (new Set(referencedSales).size !== referencedSales.length) errors.push("rotation.sales references duplicate offers");
  if (!Number.isSafeInteger(sales.promotedCount) || sales.promotedCount < 0) errors.push("rotation.sales.promotedCount must be a nonnegative integer");
  const discountPercent = raw?.rotation?.sales?.discountPercent;
  if (!Number.isInteger(discountPercent) || discountPercent < 0 || discountPercent > 90) {
    errors.push("rotation.sales.discountPercent must be an integer from 0 to 90");
  }
  for (const offerId of referencedSales) {
    if (!seen.has(String(offerId))) {
      errors.push(`rotation.sales references unknown offer ${String(offerId)}`);
    } else if (offers.find((offer) => offer?.id === offerId)?.price?.type !== "virtual") {
      errors.push(`rotation.sales offer ${String(offerId)} must have a virtual price`);
    }
  }
  const standaloneKeys = new Set();
  for (const [index, offer] of offers.entries()) {
    if (offer?.section === "sales" && !referencedSales.includes(offer.id)) errors.push(`offers[${index}]: sales offer must be pinned or promoted`);
    if (offer?.kind !== "item" || offer.grants?.length !== 1) continue;
    const grant = offer.grants[0];
    const key = `${grant?.kind}:${grant?.id}`;
    if (standaloneKeys.has(key)) errors.push(`offers[${index}]: duplicate standalone cosmetic offer`);
    standaloneKeys.add(key);
  }
  return errors;
}

function buildValidatedCatalog(raw, errors) {
  if (!errors.length) return { ...raw };
  return {
    version: raw?.version,
    timezone: FALLBACK_TIMEZONE,
    sections: [],
    offers: [],
    rotation: { dailies: { rewards: [] }, sales: { pinnedOfferIds: [], promotedOfferIds: [], promotedCount: 0, discountPercent: 0 } },
  };
}

function loadValidatedCatalog() {
  const shop = rawLoader.snapshot();
  const versions = [
    shop.generation || 0,
    skins.getCatalogVersion(),
    cards.getCatalogVersion(),
    profileIcons.getCatalogVersion(),
  ];
  const key = versions.join(":");
  if (validated?.key === key) return validated;

  let result;
  if (shop.error) {
    // The loader already logged the failure; keep the unvalidated fallback.
    result = {
      catalog: shop.catalog,
      errors: [shop.error?.message || "Unable to load shop catalog"],
      ...buildOfferIndexes(shop.catalog),
    };
  } else {
    const errors = validateCatalog(shop.catalog);
    if (errors.length) {
      console.error("[shop] catalog validation failed", errors);
    }
    const catalog = deepFreeze(buildValidatedCatalog(shop.catalog, errors));
    result = { catalog, errors, ...buildOfferIndexes(catalog) };
  }
  // Never cache a result built while any catalog was failing to load.
  validated = versions.includes(0) ? null : { key, ...result };
  return result;
}

function getShopCatalog() {
  return loadValidatedCatalog().catalog;
}

function getShopCatalogErrors() {
  return [...loadValidatedCatalog().errors];
}

function getShopOfferById(offerId) {
  const id = String(offerId || "").trim();
  return loadValidatedCatalog().offerById.get(id) || null;
}

function findOfferForGrant(kind, id) {
  const key = `${String(kind || "")}:${String(id || "")}`;
  return loadValidatedCatalog().offerByGrant.get(key) || null;
}

// Drops every cached catalog (shop and cosmetics) so the next access rereads
// the JSON files and revalidates the shop, e.g. after editing them in dev.
function invalidateCatalog() {
  rawLoader.invalidate();
  skins.invalidateSkinsCatalog();
  cards.invalidatePlayerCardsCatalog();
  profileIcons.invalidateProfileIconsCatalog();
  validated = null;
}

function getCosmeticCatalogs() {
  return {
    skins: getSkinsCatalog(),
    cards: getPlayerCardsCatalog(),
    profileIcons: getProfileIconsCatalog(),
  };
}

module.exports = {
  findOfferForGrant,
  getCosmeticCatalogs,
  getShopCatalog,
  getShopCatalogErrors,
  getShopOfferById,
  invalidateCatalog,
  validateCatalog,
};
