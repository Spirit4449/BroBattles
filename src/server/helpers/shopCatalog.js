const fs = require("fs");
const path = require("path");
const {
  getPlayerCardById,
  getPlayerCardsCatalog,
} = require("./playerCardsCatalog");
const {
  getProfileIconById,
  getProfileIconsCatalog,
} = require("./profileIconsCatalog");
const { getSkinById, getSkinsCatalog } = require("./skinsCatalog");

const CATALOG_PATH = path.resolve(__dirname, "../../shared/shopCatalog.json");
const PUBLIC_PATH = path.resolve(__dirname, "../../../public");
const CURRENCIES = new Set(["coins", "gems"]);
const PRICE_TYPES = new Set(["virtual", "money"]);
const PURCHASE_LIMITS = new Set(["lifetime", "unlimited"]);
let lastValidationErrors = [];

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

function loadRawCatalog() {
  delete require.cache[CATALOG_PATH];
  const raw = require(CATALOG_PATH);
  return raw && typeof raw === "object" ? raw : {};
}

function validateGrant(grant, location, errors) {
  const kind = String(grant?.kind || "");
  if (kind === "currency") {
    if (!CURRENCIES.has(String(grant?.currency || ""))) {
      errors.push(`${location}: unknown currency`);
    }
    if (!Number.isInteger(Number(grant?.amount)) || Number(grant?.amount) <= 0) {
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
      if (!Number.isInteger(Number(price.amount)) || Number(price.amount) <= 0) {
        errors.push(`${at}: invalid virtual price`);
      }
    } else if (
      String(price.currency || "").toLowerCase() !== "usd" ||
      !Number.isInteger(Number(price.amountCents)) ||
      Number(price.amountCents) < 50
    ) {
      errors.push(`${at}: invalid USD price`);
    }
    const grants = Array.isArray(offer?.grants) ? offer.grants : [];
    if (!grants.length) errors.push(`${at}: at least one grant is required`);
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
      if (!rewardId) {
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

  const referencedSales = [
    ...(raw?.rotation?.sales?.pinnedOfferIds || []),
    ...(raw?.rotation?.sales?.promotedOfferIds || []),
  ];
  for (const offerId of referencedSales) {
    if (!seen.has(String(offerId))) {
      errors.push(`rotation.sales references unknown offer ${String(offerId)}`);
    }
  }
  return errors;
}

function getShopCatalog() {
  let raw;
  try {
    raw = loadRawCatalog();
  } catch (error) {
    lastValidationErrors = [error?.message || "Unable to load shop catalog"];
    console.error("[shop] failed to load catalog", error);
    return { version: 1, timezone: "America/New_York", sections: [], offers: [] };
  }
  lastValidationErrors = validateCatalog(raw);
  if (lastValidationErrors.length) {
    console.error("[shop] catalog validation failed", lastValidationErrors);
  }
  const invalidOfferIndexes = new Set(
    lastValidationErrors
      .map((message) => message.match(/offers\[(\d+)\]/)?.[1])
      .filter((value) => value != null)
      .map(Number),
  );
  const invalidDailyIndexes = new Set(
    lastValidationErrors
      .map((message) => message.match(/daily reward (\d+)/)?.[1])
      .filter((value) => value != null)
      .map(Number),
  );
  return {
    ...raw,
    timezone: lastValidationErrors.some((error) =>
      error.startsWith("timezone "),
    )
      ? "America/New_York"
      : raw.timezone,
    rotation: {
      ...(raw?.rotation || {}),
      dailies: {
        ...(raw?.rotation?.dailies || {}),
        rewards: (
          Array.isArray(raw?.rotation?.dailies?.rewards)
            ? raw.rotation.dailies.rewards
            : []
        ).filter((_reward, index) => !invalidDailyIndexes.has(index)),
      },
    },
    offers: (Array.isArray(raw?.offers) ? raw.offers : []).filter(
      (_offer, index) => !invalidOfferIndexes.has(index),
    ),
  };
}

function getShopCatalogErrors() {
  getShopCatalog();
  return [...lastValidationErrors];
}

function getShopOfferById(offerId) {
  const id = String(offerId || "").trim();
  return (
    getShopCatalog().offers.find((offer) => String(offer?.id || "") === id) ||
    null
  );
}

function findOfferForGrant(kind, id) {
  const normalizedKind = String(kind || "");
  const normalizedId = String(id || "");
  return (
    getShopCatalog().offers.find((offer) => {
      if (offer?.kind === "bundle") return false;
      return (offer?.grants || []).some(
        (grant) =>
          String(grant?.kind || "") === normalizedKind &&
          String(grant?.id || "") === normalizedId,
      );
    }) || null
  );
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
  validateCatalog,
};
