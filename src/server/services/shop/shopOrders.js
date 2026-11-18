const crypto = require("crypto");

function createShopOrders({ shopService, db }) {
  function normalizeReturnPath(raw) {
    const value = String(raw || "/").trim();
    if (value === "/") return value;
    if (/^\/party\/[1-9][0-9]*$/.test(value)) return value;
    return "/";
  }

  function matchingOrder(order, offer) {
    if (
      String(order.offer_id || "") !== String(offer.id || "") ||
      Number(order.amount_cents) !== Number(offer.price.amountCents) ||
      String(order.currency || "").toLowerCase() !==
        String(offer.price.currency || "usd").toLowerCase()
    ) {
      throw shopService.createShopError(
        409,
        "idempotency_conflict",
        "That idempotency key was already used for a different order.",
      );
    }
    return order;
  }

  async function getOrCreateOrder({ user, offer, idempotencyKey }) {
    const normalizedKey = shopService.normalizeIdempotencyKey(idempotencyKey);
    if (!normalizedKey) {
      throw shopService.createShopError(
        400,
        "invalid_idempotency_key",
        "A valid idempotency key is required.",
      );
    }
    const existing = await db.runQuery(
      "SELECT * FROM shop_orders WHERE user_id = ? AND idempotency_key = ? LIMIT 1",
      [user.user_id, normalizedKey],
    );
    if (existing[0]) {
      return matchingOrder(existing[0], offer);
    }

    const orderId = crypto.randomUUID();
    try {
      await db.runQuery(
        "INSERT INTO shop_orders (order_id, user_id, offer_id, amount_cents, currency, reward_snapshot, idempotency_key) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [
          orderId,
          user.user_id,
          offer.id,
          Number(offer.price.amountCents),
          String(offer.price.currency || "usd").toLowerCase(),
          JSON.stringify(offer.grants || []),
          normalizedKey,
        ],
      );
    } catch (error) {
      if (error?.code !== "ER_DUP_ENTRY") throw error;
      const raced = await db.runQuery(
        "SELECT * FROM shop_orders WHERE user_id = ? AND idempotency_key = ? LIMIT 1",
        [user.user_id, normalizedKey],
      );
      if (raced[0]) {
        return matchingOrder(raced[0], offer);
      }
      throw error;
    }
    const rows = await db.runQuery("SELECT * FROM shop_orders WHERE order_id = ? LIMIT 1", [
      orderId,
    ]);
    return rows[0];
  }

  return { normalizeReturnPath, getOrCreateOrder };
}

module.exports = { createShopOrders };
