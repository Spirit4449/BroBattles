const {
  getRotatingOfferIds,
  isRotatingSection,
  getSaleOfferIds,
  getSalePrice,
  getBundleValue,
  buildOfferIndexes,
  ownsGrant,
} = require("./shopOfferRules");
const { getCosmeticCatalogs } = require("./shopCatalog");

function createShopPresenter({ currencyAsset, titleCase }) {
  function getOfferState(offer, ownership, redemptionSet, paymentsEnabled) {
    const grants = Array.isArray(offer?.grants) ? offer.grants : [];
    const purchased =
      offer.purchaseLimit === "lifetime" && redemptionSet.has(`lifetime:${offer.id}`);
    const owned = grants.length > 0 && grants.every((grant) => ownsGrant(ownership, grant));
    const requiredNotOwned = offer?.eligibility?.requiresNotOwned;
    const blockedByOwnership = requiredNotOwned ? ownsGrant(ownership, requiredNotOwned) : false;
    let reason = null;
    if (owned) reason = "Already in your collection";
    if (blockedByOwnership) reason = "The featured cosmetic is already in your collection";
    if (purchased) reason = "Already purchased";
    if (offer?.price?.type === "money" && !paymentsEnabled) {
      reason = "Card checkout is coming soon";
    }
    return {
      owned,
      purchased,
      available: !reason,
      reason,
    };
  }

  function resolveGrantDisplay(grant, cosmetics) {
    if (grant?.kind === "currency") {
      const currency = String(grant.currency || "coins");
      return {
        kind: "currency",
        currency,
        amount: Number(grant.amount) || 0,
        name: currency === "gems" ? "Gems" : "Coins",
        image: currencyAsset(currency),
      };
    }
    if (grant?.kind === "title") {
      const title = cosmetics?.titles?.titles?.find((item) => item.id === grant.id);
      if (title) return { ...title, kind: "title", image: "/assets/shop/icons/profile-v2.webp" };
    }
    if (grant?.kind === "skin") {
      const characters = cosmetics?.skins?.characters || {};
      for (const [character, entry] of Object.entries(characters)) {
        const skin = (entry?.skins || []).find(
          (item) => String(item?.id || "") === String(grant.id || ""),
        );
        if (skin) {
          return {
            kind: "skin",
            id: skin.id,
            character,
            name: skin.name,
            image: skin.assetUrl,
            rarity: skin.rarity,
          };
        }
      }
    }
    if (grant?.kind === "card") {
      const card = (cosmetics?.cards?.cards || []).find(
        (item) => String(item?.id || "") === String(grant.id || ""),
      );
      if (card) {
        return {
          kind: "card",
          id: card.id,
          name: card.name,
          image: card.assetUrl,
          shopImage: card.shopAssetUrl || null,
          rarity: card.rarity,
        };
      }
    }
    if (grant?.kind === "profileIcon") {
      const icon = (cosmetics?.profileIcons?.icons || []).find(
        (item) => String(item?.id || "") === String(grant.id || ""),
      );
      if (icon) {
        return {
          kind: "profileIcon",
          id: icon.id,
          name: icon.name,
          image: icon.assetUrl,
          rarity: icon.rarity,
        };
      }
    }
    return {
      kind: String(grant?.kind || "item"),
      id: String(grant?.id || ""),
      name: titleCase(grant?.id || grant?.kind || "Item"),
      image: "/assets/icons/lock.webp",
    };
  }

  function describeGrants(grants) {
    const cosmetics = getCosmeticCatalogs();
    return grants.map((grant) => resolveGrantDisplay(grant, cosmetics));
  }

  function serializeOffer(offer, cosmetics, ownership, redemptionSet, paymentsEnabled, extra = {}) {
    return {
      id: offer.id,
      kind: offer.kind,
      name: offer.name,
      description: offer.description,
      rarity: offer.rarity || "common",
      badge: offer.badge || null,
      banner: offer.banner || null,
      price: offer.price,
      grants: (offer.grants || []).map((grant) => resolveGrantDisplay(grant, cosmetics)),
      state: getOfferState(offer, ownership, redemptionSet, paymentsEnabled),
      ...extra,
    };
  }

  // Player-facing section contents for one rotation; shared by the shop and the
  // admin preview so both always agree on what is shown and at what price.
  function buildSections({
    catalog,
    cosmetics,
    rotations,
    ownership,
    redemptionSet,
    paymentsEnabled,
  }) {
    const { offerById, offerByGrant } = buildOfferIndexes(catalog);

    const dailyRewards = catalog?.rotation?.dailies?.rewards || [];
    const daily = dailyRewards.length
      ? dailyRewards[Math.abs(Number(rotations.dailies.ordinal) || 0) % dailyRewards.length]
      : null;
    const dailyClaimed = daily
      ? redemptionSet.has(`${rotations.dailies.cycleKey}:${daily.id}`)
      : false;
    const dailyOffer = daily
      ? {
          id: daily.id,
          kind: "daily",
          name: daily.name,
          description: daily.description,
          rarity: daily.rarity || "common",
          banner: daily.banner || null,
          price: { type: "free", currency: null, amount: 0 },
          grants: (daily.grants || []).map((grant) => resolveGrantDisplay(grant, cosmetics)),
          state: {
            owned: false,
            claimed: dailyClaimed,
            available: !dailyClaimed,
            reason: dailyClaimed ? "Claimed today" : null,
          },
        }
      : null;

    const saleIds = getSaleOfferIds(catalog, rotations.sales);
    const sales = saleIds
      .map((id) => offerById.get(String(id)))
      .filter(Boolean)
      .map((offer) => {
        const salePrice = getSalePrice(offer, catalog);
        const bundleValue = getBundleValue(offer, offerByGrant, ownership);
        return serializeOffer(offer, cosmetics, ownership, redemptionSet, paymentsEnabled, {
          featured: true,
          price: salePrice,
          originalPrice:
            salePrice.amount < offer.price.amount
              ? offer.price
              : bundleValue?.cosmeticPrice || offer.price,
          bundleValue,
          discountPercent:
            salePrice.amount >= offer.price.amount
              ? null
              : Math.round(((offer.price.amount - salePrice.amount) * 100) / offer.price.amount),
        });
      });

    const rotatingIds = new Map(
      (catalog.sections || [])
        .filter(isRotatingSection)
        .map((section) => [
          section.id,
          new Set(getRotatingOfferIds(catalog, rotations.sales, section.id, saleIds)),
        ]),
    );
    const sections = Object.fromEntries(
      (catalog.sections || []).map((section) => [section.id, []]),
    );
    for (const offer of catalog.offers || []) {
      if (
        saleIds.includes(offer.id) ||
        offer.section === "sales" ||
        (rotatingIds.has(offer.section) && !rotatingIds.get(offer.section).has(offer.id))
      )
        continue;
      const bundleValue = getBundleValue(offer, offerByGrant, ownership);
      sections[offer.section]?.push(
        serializeOffer(offer, cosmetics, ownership, redemptionSet, paymentsEnabled, {
          offerId: offer.id,
          bundleValue,
          originalPrice: bundleValue?.cosmeticPrice || null,
        }),
      );
    }
    sections.sales = sales;
    sections.dailies = dailyOffer ? [dailyOffer] : [];
    return sections;
  }

  return { describeGrants, buildSections };
}

module.exports = { createShopPresenter };
