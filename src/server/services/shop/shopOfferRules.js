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
  const collections = { skin: "skins", card: "cards", profileIcon: "profileIcons" };
  return ownership?.[collections[grant?.kind]]?.has(String(grant.id)) || false;
}

module.exports = { getSaleOfferIds, getSalePrice, getBundleValue, buildOfferIndexes, ownsGrant };
