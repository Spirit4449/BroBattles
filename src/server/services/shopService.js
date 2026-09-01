const {
  findOfferForGrant,
  getCosmeticCatalogs,
  getShopCatalog,
  getShopCatalogErrors,
  getShopOfferById,
} = require("../helpers/shopCatalog");
const { createShopRotationService } = require("./shopRotationService");
const { syncSkinOwnershipForUser } = require("../helpers/skinOwnership");
const {
  syncProfileIconOwnershipForUser,
} = require("../helpers/profileIconOwnership");
const {
  syncPlayerCardOwnershipForUser,
} = require("../helpers/playerCardOwnership");

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function normalizeIdempotencyKey(raw) {
  const value = String(raw || "").trim();
  if (!/^[a-zA-Z0-9:_-]{8,96}$/.test(value)) return null;
  return value;
}

function currencyAsset(currency) {
  return currency === "gems" ? "/assets/gem.webp" : "/assets/coin.webp";
}

function titleCase(value) {
  return String(value || "")
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createShopError(status, code, message, detail = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  Object.assign(error, detail);
  return error;
}

function createShopService({ db }) {
  const initialCatalog = getShopCatalog();
  const rotationService = createShopRotationService({
    db,
    timeZone: initialCatalog.timezone || "America/New_York",
  });

  async function getFreshUser(userId, runner = db.runQuery) {
    const rows = await runner(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [Number(userId)],
    );
    return rows[0] || null;
  }

  async function getOwnership(user) {
    const [skinState, iconState, cardState] = await Promise.all([
      syncSkinOwnershipForUser(db, user),
      syncProfileIconOwnershipForUser(db, user),
      syncPlayerCardOwnershipForUser(db, user),
    ]);
    return {
      skins: new Set((skinState?.ownedSkinIds || []).map(String)),
      cards: new Set((cardState?.ownedCardIds || []).map(String)),
      profileIcons: new Set((iconState?.ownedIconIds || []).map(String)),
    };
  }

  async function getOwnershipWithRunner(q, userId) {
    const [skinRows, cardRows, iconRows] = await Promise.all([
      q("SELECT skin_id FROM user_skins WHERE user_id = ?", [userId]),
      q("SELECT card_id FROM user_cards WHERE user_id = ?", [userId]),
      q("SELECT icon_id FROM user_profile_icons WHERE user_id = ?", [userId]),
    ]);
    return {
      skins: new Set((skinRows || []).map((row) => String(row.skin_id))),
      cards: new Set((cardRows || []).map((row) => String(row.card_id))),
      profileIcons: new Set((iconRows || []).map((row) => String(row.icon_id))),
    };
  }

  function ownsGrant(ownership, grant) {
    if (grant?.kind === "skin") return ownership.skins.has(String(grant.id));
    if (grant?.kind === "card") return ownership.cards.has(String(grant.id));
    if (grant?.kind === "profileIcon") {
      return ownership.profileIcons.has(String(grant.id));
    }
    return false;
  }

  function getOfferState(offer, ownership, redemptionSet, paymentsEnabled) {
    const grants = Array.isArray(offer?.grants) ? offer.grants : [];
    const ownable = grants.filter((grant) => grant.kind !== "currency");
    const owned = ownable.length > 0 && ownable.every((grant) => ownsGrant(ownership, grant));
    const requiredNotOwned = offer?.eligibility?.requiresNotOwned;
    const blockedByOwnership = requiredNotOwned
      ? ownsGrant(ownership, requiredNotOwned)
      : false;
    let reason = null;
    if (blockedByOwnership) reason = "The featured skin is already in your collection";
    if (redemptionSet.has(`lifetime:${offer.id}`)) reason = "Already in your collection";
    if (offer?.price?.type === "money" && !paymentsEnabled) {
      reason = "Card checkout is coming soon";
    }
    return {
      owned,
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
      image: "/assets/lock.webp",
    };
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
      grants: (offer.grants || []).map((grant) =>
        resolveGrantDisplay(grant, cosmetics),
      ),
      state: getOfferState(
        offer,
        ownership,
        redemptionSet,
        paymentsEnabled,
      ),
      ...extra,
    };
  }

  function buildCatalogOnlyTiles(cosmetics, ownership, offerByGrant) {
    const skins = [];
    for (const [character, entry] of Object.entries(
      cosmetics?.skins?.characters || {},
    )) {
      for (const skin of entry?.skins || []) {
        if (skin?.showInPicker === false) continue;
        const id = String(skin?.id || "");
        const offer = offerByGrant.get(`skin:${id}`);
        if (!offer || id === String(entry?.defaultSkinId || "")) continue;
        skins.push({
          id: `browse-skin-${id}`,
          kind: "browse-item",
          itemKind: "skin",
          itemId: id,
          name: skin.name === "Default" ? `${titleCase(character)} Default` : skin.name,
          description: offer?.description || `A ${skin.rarity || "common"} ${titleCase(character)} skin.`,
          rarity: skin.rarity || "common",
          banner: offer.banner || null,
          grants: [resolveGrantDisplay({ kind: "skin", id }, cosmetics)],
          offerId: offer?.id || null,
          price: offer?.price || null,
          state: {
            owned: ownership.skins.has(id),
            available: !!offer && !ownership.skins.has(id),
            reason: ownership.skins.has(id)
              ? "Owned"
              : skin?.unlockMethod?.type === "shop"
                ? "Available in Shop"
                : `Unlock through ${titleCase(skin?.unlockMethod?.type || "progression")}`,
          },
        });
      }
    }

    const profile = [];
    for (const card of cosmetics?.cards?.cards || []) {
      const id = String(card?.id || "");
      const offer = offerByGrant.get(`card:${id}`);
      if (!offer) continue;
      profile.push({
        id: `browse-card-${id}`,
        kind: "browse-item",
        itemKind: "card",
        itemId: id,
        name: card.name,
        description: offer?.description || "A player card for your profile loadout.",
        rarity: card.rarity || "common",
        banner: offer.banner || null,
        grants: [resolveGrantDisplay({ kind: "card", id }, cosmetics)],
        offerId: offer?.id || null,
        price: offer?.price || null,
        state: {
          owned: ownership.cards.has(id),
          available: !!offer && !ownership.cards.has(id),
          reason: ownership.cards.has(id) ? "Owned" : offer ? "Available in Shop" : "Progression reward",
        },
      });
    }
    for (const icon of cosmetics?.profileIcons?.icons || []) {
      const id = String(icon?.id || "");
      const offer = offerByGrant.get(`profileIcon:${id}`);
      if (!offer) continue;
      const unlock = icon?.unlock || {};
      let unlockText = "Progression reward";
      if (unlock.type === "character") unlockText = `Unlock ${titleCase(unlock.character)}`;
      if (unlock.type === "trophies") unlockText = `Reach ${Number(unlock.min) || 0} trophies`;
      profile.push({
        id: `browse-icon-${id}`,
        kind: "browse-item",
        itemKind: "profileIcon",
        itemId: id,
        name: icon.name,
        description: "A profile icon earned through progression.",
        rarity: icon.rarity || "common",
        banner: offer.banner || null,
        grants: [resolveGrantDisplay({ kind: "profileIcon", id }, cosmetics)],
        offerId: offer.id,
        price: offer.price,
        state: {
          owned: ownership.profileIcons.has(id),
          available: !ownership.profileIcons.has(id),
          reason: ownership.profileIcons.has(id) ? "Owned" : unlockText,
        },
      });
    }
    return { skins, profile };
  }

  async function buildBootstrap(user, { paymentsEnabled = false, publishableKey = null } = {}) {
    const freshUser = (await getFreshUser(user.user_id)) || user;
    const catalog = getShopCatalog();
    const cosmetics = getCosmeticCatalogs();
    const [rotations, ownership, redemptionRows] = await Promise.all([
      rotationService.getBoth(),
      getOwnership(freshUser),
      db.runQuery(
        "SELECT offer_id, limit_key, status FROM shop_redemptions WHERE user_id = ? AND status = 'fulfilled'",
        [freshUser.user_id],
      ),
    ]);
    const redemptionSet = new Set(
      (redemptionRows || []).map(
        (row) => `${String(row.limit_key || "")}:${String(row.offer_id || "")}`,
      ),
    );
    const offerById = new Map(
      (catalog.offers || []).map((offer) => [String(offer.id), offer]),
    );
    const offerByGrant = new Map();
    for (const offer of catalog.offers || []) {
      if (offer.kind === "bundle") continue;
      for (const grant of offer.grants || []) {
        if (grant.kind !== "currency") {
          offerByGrant.set(`${grant.kind}:${grant.id}`, offer);
        }
      }
    }

    const dailyRewards = catalog?.rotation?.dailies?.rewards || [];
    const daily = dailyRewards.length
      ? dailyRewards[
          Math.abs(Number(rotations.dailies.ordinal) || 0) % dailyRewards.length
        ]
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
          grants: (daily.grants || []).map((grant) =>
            resolveGrantDisplay(grant, cosmetics),
          ),
          state: {
            owned: false,
            claimed: dailyClaimed,
            available: !dailyClaimed,
            reason: dailyClaimed ? "Claimed today" : null,
          },
        }
      : null;

    const salesConfig = catalog?.rotation?.sales || {};
    const promotedIds = Array.isArray(salesConfig.promotedOfferIds)
      ? salesConfig.promotedOfferIds
      : [];
    const promotedCount = Math.max(0, Number(salesConfig.promotedCount) || 0);
    const salesOffset = promotedIds.length
      ? Math.abs(Number(rotations.sales.ordinal) || 0) % promotedIds.length
      : 0;
    const rotatedPromotions = [];
    for (let index = 0; index < Math.min(promotedCount, promotedIds.length); index += 1) {
      rotatedPromotions.push(promotedIds[(salesOffset + index) % promotedIds.length]);
    }
    const saleIds = [
      ...new Set([
        ...(salesConfig.pinnedOfferIds || []),
        ...rotatedPromotions,
      ]),
    ];
    const sales = saleIds
      .map((id) => offerById.get(String(id)))
      .filter(Boolean)
      .map((offer) =>
        serializeOffer(
          offer,
          cosmetics,
          ownership,
          redemptionSet,
          paymentsEnabled,
          { featured: true },
        ),
      );

    const browse = buildCatalogOnlyTiles(cosmetics, ownership, offerByGrant);
    const currency = (catalog.offers || [])
      .filter((offer) => offer.section === "currency")
      .map((offer) =>
        serializeOffer(
          offer,
          cosmetics,
          ownership,
          redemptionSet,
          paymentsEnabled,
        ),
      );

    return {
      success: true,
      serverNow: new Date().toISOString(),
      timezone: rotations.timezone,
      wallet: {
        coins: Number(freshUser.coins) || 0,
        gems: Number(freshUser.gems) || 0,
      },
      account: { guest: !!freshUser.expires_at },
      payment: {
        enabled: !!paymentsEnabled,
        publishableKey: paymentsEnabled ? publishableKey : null,
      },
      rotations,
      sections: {
        sales,
        dailies: dailyOffer ? [dailyOffer] : [],
        skins: browse.skins,
        profile: browse.profile,
        currency,
      },
    };
  }

  async function addLedgerEntry(q, userId, currency, amount, sourceType, sourceId) {
    if (!amount) return;
    await q(
      "INSERT IGNORE INTO shop_currency_ledger (user_id, currency, amount, source_type, source_id) VALUES (?, ?, ?, ?, ?)",
      [userId, currency, amount, sourceType, sourceId],
    );
  }

  async function applyGrants(q, userId, grants, source, sourceId) {
    const totals = { coins: 0, gems: 0 };
    for (const grant of grants || []) {
      if (grant.kind === "currency") {
        const currency = grant.currency === "gems" ? "gems" : "coins";
        totals[currency] += Math.max(0, Math.round(Number(grant.amount) || 0));
      } else if (grant.kind === "skin") {
        await q(
          "INSERT IGNORE INTO user_skins (user_id, skin_id, source) VALUES (?, ?, ?)",
          [userId, String(grant.id), source],
        );
      } else if (grant.kind === "card") {
        await q(
          "INSERT IGNORE INTO user_cards (user_id, card_id, source) VALUES (?, ?, ?)",
          [userId, String(grant.id), source],
        );
      } else if (grant.kind === "profileIcon") {
        await q(
          "INSERT IGNORE INTO user_profile_icons (user_id, icon_id, source) VALUES (?, ?, ?)",
          [userId, String(grant.id), source],
        );
      }
    }
    if (totals.coins || totals.gems) {
      await q(
        "UPDATE users SET coins = coins + ?, gems = gems + ? WHERE user_id = ?",
        [totals.coins, totals.gems, userId],
      );
      await addLedgerEntry(q, userId, "coins", totals.coins, `${source}_grant`, sourceId);
      await addLedgerEntry(q, userId, "gems", totals.gems, `${source}_grant`, sourceId);
    }
    return totals;
  }

  async function redeem({ userId, offer, grants, price, limitKey, kind, idempotencyKey }) {
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    if (!normalizedKey) {
      throw createShopError(400, "invalid_idempotency_key", "A valid idempotency key is required.");
    }
    return db.withTransaction(async (_conn, q) => {
      const userRows = await q(
        "SELECT * FROM users WHERE user_id = ? FOR UPDATE",
        [userId],
      );
      const currentUser = userRows[0];
      if (!currentUser) throw createShopError(404, "missing_user", "User not found.");

      const duplicateRows = await q(
        "SELECT * FROM shop_redemptions WHERE user_id = ? AND (idempotency_key = ? OR (offer_id = ? AND limit_key = ?)) LIMIT 1",
        [userId, normalizedKey, offer.id, limitKey],
      );
      if (duplicateRows[0]) {
        if (
          String(duplicateRows[0].idempotency_key || "") === normalizedKey &&
          String(duplicateRows[0].offer_id || "") !== String(offer.id || "")
        ) {
          throw createShopError(
            409,
            "idempotency_conflict",
            "That idempotency key was already used for a different offer.",
          );
        }
        const walletRows = await q(
          "SELECT coins, gems FROM users WHERE user_id = ?",
          [userId],
        );
        return {
          success: true,
          duplicate: true,
          claimed: kind === "daily",
          wallet: {
            coins: Number(walletRows[0]?.coins) || 0,
            gems: Number(walletRows[0]?.gems) || 0,
          },
          grants: parseJson(duplicateRows[0].reward_snapshot, grants),
        };
      }

      const ownership = await getOwnershipWithRunner(q, userId);
      const requiredNotOwned = offer?.eligibility?.requiresNotOwned;
      if (requiredNotOwned && ownsGrant(ownership, requiredNotOwned)) {
        throw createShopError(
          409,
          "offer_ineligible",
          "This offer is unavailable because you already own its featured cosmetic.",
        );
      }
      const ownable = (grants || []).filter((grant) => grant.kind !== "currency");
      if (
        kind !== "daily" &&
        offer.kind !== "bundle" &&
        ownable.length > 0 &&
        ownable.every((grant) => ownsGrant(ownership, grant))
      ) {
        return {
          success: true,
          alreadyOwned: true,
          wallet: {
            coins: Number(currentUser.coins) || 0,
            gems: Number(currentUser.gems) || 0,
          },
          grants,
        };
      }

      const virtualPrice = price?.type === "virtual" ? price : null;
      const priceCurrency = virtualPrice?.currency === "coins" ? "coins" : "gems";
      const priceAmount = virtualPrice
        ? Math.max(0, Math.round(Number(virtualPrice.amount) || 0))
        : 0;
      const currentBalance = Number(currentUser[priceCurrency]) || 0;
      if (priceAmount > currentBalance) {
        throw createShopError(
          400,
          "insufficient_funds",
          `Not enough ${priceCurrency}.`,
          { wallet: { coins: Number(currentUser.coins) || 0, gems: Number(currentUser.gems) || 0 } },
        );
      }

      const insertResult = await q(
        "INSERT INTO shop_redemptions (user_id, offer_id, limit_key, redemption_kind, idempotency_key, price_snapshot, reward_snapshot, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')",
        [
          userId,
          offer.id,
          limitKey,
          kind,
          normalizedKey,
          price ? JSON.stringify(price) : null,
          JSON.stringify(grants || []),
        ],
      );
      const redemptionId = String(insertResult.insertId);
      if (priceAmount > 0) {
        await q(`UPDATE users SET ${priceCurrency} = ${priceCurrency} - ? WHERE user_id = ?`, [
          priceAmount,
          userId,
        ]);
        await addLedgerEntry(
          q,
          userId,
          priceCurrency,
          -priceAmount,
          "virtual_price",
          redemptionId,
        );
      }
      await applyGrants(q, userId, grants, kind === "daily" ? "daily" : "shop", redemptionId);
      await q(
        "UPDATE shop_redemptions SET status = 'fulfilled', fulfilled_at = NOW() WHERE redemption_id = ?",
        [insertResult.insertId],
      );
      const walletRows = await q(
        "SELECT coins, gems FROM users WHERE user_id = ?",
        [userId],
      );
      return {
        success: true,
        claimed: kind === "daily",
        wallet: {
          coins: Number(walletRows[0]?.coins) || 0,
          gems: Number(walletRows[0]?.gems) || 0,
        },
        grants,
      };
    });
  }

  async function purchaseVirtual({ userId, offerId, idempotencyKey }) {
    const offer = getShopOfferById(offerId);
    if (!offer) throw createShopError(404, "unknown_offer", "Offer not found.");
    if (offer?.price?.type !== "virtual") {
      throw createShopError(400, "wrong_purchase_type", "This offer requires checkout.");
    }
    const limitKey = offer.purchaseLimit === "unlimited"
      ? `request:${normalizeIdempotencyKey(idempotencyKey) || "invalid"}`
      : "lifetime";
    return redeem({
      userId,
      offer,
      grants: offer.grants || [],
      price: offer.price,
      limitKey,
      kind: "virtual",
      idempotencyKey,
    });
  }

  async function claimDaily({ userId, idempotencyKey }) {
    const catalog = getShopCatalog();
    const rotation = await rotationService.ensure("dailies");
    const rewards = catalog?.rotation?.dailies?.rewards || [];
    const reward = rewards[Math.abs(Number(rotation.ordinal) || 0) % rewards.length];
    if (!reward) throw createShopError(503, "daily_unavailable", "Daily reward unavailable.");
    return redeem({
      userId,
      offer: { ...reward, kind: "daily" },
      grants: reward.grants || [],
      price: null,
      limitKey: rotation.cycleKey,
      kind: "daily",
      idempotencyKey,
    });
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

  return {
    applyGrants,
    buildBootstrap,
    claimDaily,
    createShopError,
    findOfferForGrant,
    getAdminStatus,
    getFreshUser,
    getShopOfferById,
    normalizeIdempotencyKey,
    purchaseVirtual,
    rotationService,
  };
}

module.exports = { createShopService, createShopError, normalizeIdempotencyKey };
