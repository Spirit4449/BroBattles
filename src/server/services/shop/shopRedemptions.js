const { grantCosmetic, ownershipSnapshot } = require("../cosmetics/cosmeticCollections");
const { adjustWallet, readWallet, toWallet } = require("../economy/walletService");
const { parseJsonOr } = require("../../lib/json");
const { isOfferInRotation, getSaleOfferIds, getSalePrice, ownsGrant } = require("./shopOfferRules");

function createShopRedemptions({
  normalizeIdempotencyKey,
  createShopError,
  db,
  describeGrants,
  catalogProvider,
  rotationService,
}) {
  async function applyGrants(q, userId, grants, source, sourceId) {
    const totals = { coins: 0, gems: 0 };
    for (const grant of grants || []) {
      if (grant.kind === "currency") {
        const currency = grant.currency === "gems" ? "gems" : "coins";
        totals[currency] += Math.max(0, Math.round(Number(grant.amount) || 0));
      } else if (["skin", "card", "title", "profileIcon"].includes(grant.kind)) {
        await grantCosmetic(q, userId, grant.kind, grant.id, source);
      }
    }
    await adjustWallet(q, userId, totals, {
      sourceType: `${source}_grant`,
      sourceId,
      idempotent: true,
    });
    return totals;
  }

  async function redeem({
    userId,
    resolveOffer,
    kind,
    idempotencyKey,
    expectedPrice,
    expectedCurrency,
  }) {
    const normalizedKey = normalizeIdempotencyKey(idempotencyKey);
    if (!normalizedKey) {
      throw createShopError(400, "invalid_idempotency_key", "A valid idempotency key is required.");
    }
    return db.withTransaction(async (_conn, q) => {
      const userRows = await q("SELECT * FROM users WHERE user_id = ? FOR UPDATE", [userId]);
      const currentUser = userRows[0];
      if (!currentUser) throw createShopError(404, "missing_user", "User not found.");

      const { offer, grants, price, limitKey, available = true } = await resolveOffer(q);
      const duplicateRows = await q(
        "SELECT * FROM shop_redemptions WHERE user_id = ? AND (idempotency_key = ? OR (offer_id = ? AND limit_key = ?)) LIMIT 1",
        [userId, normalizedKey, offer.id, limitKey],
      );
      if (duplicateRows[0]) {
        if (!available && String(duplicateRows[0].idempotency_key || "") !== normalizedKey) {
          throw createShopError(
            409,
            "offer_unavailable",
            "This offer is not in the current shop rotation.",
          );
        }
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
        return {
          success: true,
          duplicate: true,
          claimed: kind === "daily",
          wallet: await readWallet(q, userId),
          grants: describeGrants(parseJsonOr(duplicateRows[0].reward_snapshot, grants)),
        };
      }

      if (!available)
        throw createShopError(
          409,
          "offer_unavailable",
          "This offer is not in the current shop rotation.",
        );

      if (
        (expectedPrice != null && Number(expectedPrice) !== Number(price?.amount)) ||
        (expectedCurrency != null && expectedCurrency !== price?.currency)
      ) {
        throw createShopError(
          409,
          "price_changed",
          "The offer price changed. Refresh the shop and try again.",
        );
      }

      const ownership = await ownershipSnapshot(q, userId);
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
        ownable.length === grants.length &&
        ownable.length > 0 &&
        ownable.every((grant) => ownsGrant(ownership, grant))
      ) {
        return {
          success: true,
          alreadyOwned: true,
          wallet: toWallet(currentUser),
          grants: describeGrants(grants),
        };
      }

      const virtualPrice = price?.type === "virtual" ? price : null;
      const priceCurrency = virtualPrice?.currency === "coins" ? "coins" : "gems";
      const priceAmount = virtualPrice
        ? Math.max(0, Math.round(Number(virtualPrice.amount) || 0))
        : 0;
      const currentBalance = Number(currentUser[priceCurrency]) || 0;
      if (priceAmount > 0 && priceAmount > currentBalance) {
        throw createShopError(400, "insufficient_funds", `Not enough ${priceCurrency}.`, {
          wallet: toWallet(currentUser),
        });
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
      await adjustWallet(
        q,
        userId,
        { [priceCurrency]: -priceAmount },
        {
          sourceType: "virtual_price",
          sourceId: redemptionId,
          idempotent: true,
        },
      );
      await applyGrants(q, userId, grants, kind === "daily" ? "daily" : "shop", redemptionId);
      await q(
        "UPDATE shop_redemptions SET status = 'fulfilled', fulfilled_at = NOW() WHERE redemption_id = ?",
        [insertResult.insertId],
      );
      return {
        success: true,
        claimed: kind === "daily",
        wallet: await readWallet(q, userId),
        grants: describeGrants(grants),
      };
    });
  }

  async function purchaseVirtual({
    userId,
    offerId,
    idempotencyKey,
    expectedPrice,
    expectedCurrency,
  }) {
    return redeem({
      userId, kind: "virtual", idempotencyKey, expectedPrice, expectedCurrency,
      resolveOffer: async q => {
        const rotation = await rotationService.ensureLocked(q, "sales");
        const catalog = catalogProvider();
        const offer = catalog.offers.find(entry => entry.id === String(offerId || "").trim());
        if (!offer) throw createShopError(404, "unknown_offer", "Offer not found.");
        if (offer.price?.type !== "virtual") throw createShopError(400, "wrong_purchase_type", "This offer requires checkout.");
        const onSale = getSaleOfferIds(catalog, rotation).includes(offer.id);
        return {
          offer, grants: offer.grants || [], price: onSale ? getSalePrice(offer, catalog) : offer.price,
          available: isOfferInRotation(catalog, offer, rotation),
          limitKey: offer.purchaseLimit === "unlimited" ? `request:${normalizeIdempotencyKey(idempotencyKey)}` : "lifetime",
        };
      },
    });
  }

  function claimDaily({ userId, idempotencyKey }) {
    return redeem({
      userId, kind: "daily", idempotencyKey,
      resolveOffer: async q => {
        const rotation = await rotationService.ensureLocked(q, "dailies");
        const rewards = catalogProvider().rotation?.dailies?.rewards || [];
        const reward = rewards[Math.abs(Number(rotation.ordinal) || 0) % rewards.length];
        if (!reward) throw createShopError(503, "daily_unavailable", "Daily reward unavailable.");
        return { offer: { ...reward, kind: "daily" }, grants: reward.grants || [], price: null, limitKey: rotation.cycleKey };
      },
    });
  }

  return { applyGrants, purchaseVirtual, claimDaily };
}

module.exports = { createShopRedemptions };
