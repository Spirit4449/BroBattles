function getSaleOfferIds(catalog, rotation) {
  const config = catalog?.rotation?.sales || {};
  const pinned = [...new Set(config.pinnedOfferIds || [])];
  const promoted = [...new Set(config.promotedOfferIds || [])].filter(id => !pinned.includes(id));
  const offset = promoted.length ? Math.abs(Number(rotation.ordinal) || 0) % promoted.length : 0;
  const count = Math.min(Math.max(0, Number(config.promotedCount) || 0), promoted.length);
  return [...new Set([
    ...pinned,
    ...Array.from({ length: count }, (_, index) => promoted[(offset + index) % promoted.length]),
  ])];
}

// Columns in the shop grid at desktop width; a rotating section shows `rows` of them.
const ROTATION_COLUMNS = 3;
const DEFAULT_ROTATION_ROWS = 2;

// Any section other than Sales with `rotation: "sales"` rotates weekly on the
// Sales schedule: each week shows the next rows × 3 of its offers, in catalog
// order, skipping offers currently promoted in Sales.
function isRotatingSection(section) {
  return !!section && section.rotation === "sales" && section.id !== "sales";
}

function getSectionRotationSize(section) {
  return (Number(section?.rows) || DEFAULT_ROTATION_ROWS) * ROTATION_COLUMNS;
}

function getRotatingOfferIds(catalog, rotation, sectionId, saleIds = getSaleOfferIds(catalog, rotation)) {
  const section = (catalog?.sections || []).find(entry => entry?.id === sectionId);
  const onSale = new Set(saleIds);
  const offers = (catalog?.offers || []).filter(offer => offer?.section === sectionId && !onSale.has(offer.id));
  if (!isRotatingSection(section)) return offers.map(offer => offer.id);
  const size = getSectionRotationSize(section);
  const count = Math.min(size, offers.length);
  const offset = offers.length ? Math.abs(Number(rotation?.ordinal) || 0) * size % offers.length : 0;
  return Array.from({ length: count }, (_, index) => offers[(offset + index) % offers.length].id);
}

// Whether a catalog offer is in the shop for the given sales rotation.
function isOfferInRotation(catalog, offer, rotation) {
  const saleIds = getSaleOfferIds(catalog, rotation);
  if (saleIds.includes(offer?.id)) return true;
  if (offer?.section === "sales") return false;
  const section = (catalog?.sections || []).find(entry => entry?.id === offer?.section);
  return !isRotatingSection(section) || getRotatingOfferIds(catalog, rotation, section.id, saleIds).includes(offer.id);
}

function getProfileOfferIds(catalog, rotation) {
  return getRotatingOfferIds(catalog, rotation, "profile");
}

function getSalePrice(offer, catalog) {
  const percent = offer.saleDiscountPercent ?? (offer.kind === "bundle" ? 0 : Number(catalog?.rotation?.sales?.discountPercent) || 0);
  if (offer?.price?.type !== "virtual" || percent <= 0) return offer.price;
  const original = Number(offer.price.amount);
  return { ...offer.price, amount: Math.max(1, original - Math.max(1, Math.round(original * percent / 100))) };
}

function getBundleValue(offer, offerByGrant, ownership = null) {
  if (offer?.kind !== "bundle" || offer.price?.type !== "virtual") return null;
  let cosmeticAmount = 0;
  const bonusCurrencies = {};
  for (const grant of offer.grants || []) {
    if (grant.kind === "currency") {
      bonusCurrencies[grant.currency] = (bonusCurrencies[grant.currency] || 0) + Number(grant.amount || 0);
      continue;
    }
    if (ownership && ownsGrant(ownership, grant)) continue;
    const standalone = offerByGrant.get(`${grant.kind}:${grant.id}`);
    if (standalone?.price?.type !== "virtual" || standalone.price.currency !== offer.price.currency) return null;
    cosmeticAmount += Number(standalone.price.amount);
  }
  return {
    cosmeticPrice: { ...offer.price, amount: cosmeticAmount },
    bonusCurrencies,
  };
}

function buildOfferIndexes(catalog) {
  const offerById = new Map();
  const offerByGrant = new Map();
  for (const offer of catalog.offers || []) {
    offerById.set(offer.id, offer);
    if (offer.kind !== "item" || offer.grants?.length !== 1) continue;
    const grant = offer.grants[0];
    if (grant.kind !== "currency") offerByGrant.set(`${grant.kind}:${grant.id}`, offer);
  }
  return { offerById, offerByGrant };
}

function ownsGrant(ownership, grant) {
  const collections = { skin: "skins", card: "cards", profileIcon: "profileIcons", title: "titles" };
  return ownership?.[collections[grant?.kind]]?.has(String(grant.id)) || false;
}

module.exports = { isRotatingSection, getSectionRotationSize, getRotatingOfferIds, isOfferInRotation, getProfileOfferIds, getSaleOfferIds, getSalePrice, getBundleValue, buildOfferIndexes, ownsGrant };
