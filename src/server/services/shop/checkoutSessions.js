const { readWallet } = require("../economy/walletService");
const { parseJsonOr } = require("../../lib/json");

function createCheckoutSessions({
  assertEnabled,
  shopService,
  getOrCreateOrder,
  stripe,
  normalizeReturnPath,
  publicBaseUrl,
  automaticTax,
  db,
  safeErrorMessage,
}) {
  async function createCheckoutSession({ user, offerId, idempotencyKey, returnPath }) {
    assertEnabled();
    const freshUser = (await shopService.getFreshUser(user.user_id)) || user;
    if (freshUser?.expires_at) {
      throw shopService.createShopError(
        403,
        "account_required",
        "Create a permanent account before making a real-money purchase.",
      );
    }
    const offer = shopService.getShopOfferById(offerId);
    if (!offer) {
      throw shopService.createShopError(404, "unknown_offer", "Offer not found.");
    }
    if (offer?.price?.type !== "money") {
      throw shopService.createShopError(
        400,
        "wrong_purchase_type",
        "This offer does not use checkout.",
      );
    }
    if ((offer.grants || []).some((grant) => grant.kind !== "currency")) {
      throw shopService.createShopError(
        400,
        "unsupported_money_grant",
        "Real-money offers may only grant currency.",
      );
    }

    const order = await getOrCreateOrder({
      user: freshUser,
      offer,
      idempotencyKey,
    });
    if (order.stripe_checkout_session_id) {
      const existingSession = await stripe.checkout.sessions.retrieve(
        order.stripe_checkout_session_id,
      );
      return {
        success: true,
        orderId: order.order_id,
        sessionId: existingSession.id,
        clientSecret: existingSession.client_secret,
      };
    }

    const path = normalizeReturnPath(returnPath);
    const returnUrl = `${publicBaseUrl}${path}?shop_checkout={CHECKOUT_SESSION_ID}`;
    const params = {
      mode: "payment",
      // Stripe API 2026-08-26.dahlia renamed the embedded Checkout mode.
      // Its client secret still mounts through Stripe.js initEmbeddedCheckout.
      ui_mode: "embedded_page",
      redirect_on_completion: "if_required",
      return_url: returnUrl,
      client_reference_id: String(freshUser.user_id),
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: Number(offer.price.amountCents),
            product_data: {
              name: offer.name,
              description: offer.description,
            },
          },
          quantity: 1,
        },
      ],
      metadata: {
        orderId: order.order_id,
        userId: String(freshUser.user_id),
        offerId: offer.id,
      },
      payment_intent_data: {
        metadata: {
          orderId: order.order_id,
          userId: String(freshUser.user_id),
          offerId: offer.id,
        },
      },
      // Managed Payments acts as merchant of record and requires eligible Stripe
      // product tax codes. Bro Battles is not opting into that tax model yet, so
      // override any account-level default for every shop Checkout Session.
      managed_payments: { enabled: false },
      automatic_tax: { enabled: automaticTax },
    };
    if (freshUser.stripe_customer_id) {
      params.customer = String(freshUser.stripe_customer_id);
    } else {
      params.customer_creation = "always";
    }

    try {
      const session = await stripe.checkout.sessions.create(params, {
        idempotencyKey: `bro-battles-shop:${order.order_id}`,
      });
      await db.runQuery(
        "UPDATE shop_orders SET stripe_checkout_session_id = ?, stripe_payment_intent_id = COALESCE(stripe_payment_intent_id, ?), last_error = NULL WHERE order_id = ?",
        [session.id, session.payment_intent || null, order.order_id],
      );
      return {
        success: true,
        orderId: order.order_id,
        sessionId: session.id,
        clientSecret: session.client_secret,
      };
    } catch (error) {
      await db.runQuery("UPDATE shop_orders SET last_error = ? WHERE order_id = ?", [
        safeErrorMessage(error),
        order.order_id,
      ]);
      throw error;
    }
  }

  async function getCheckoutStatus({ userId, sessionId }) {
    const rows = await db.runQuery(
      "SELECT * FROM shop_orders WHERE user_id = ? AND stripe_checkout_session_id = ? LIMIT 1",
      [userId, String(sessionId || "")],
    );
    if (!rows[0]) {
      throw shopService.createShopError(404, "order_not_found", "Order not found.");
    }
    const { order_id, offer_id, status, amount_cents, currency, fulfilled_at } = rows[0];
    return {
      success: true,
      order: { order_id, offer_id, status, amount_cents, currency, fulfilled_at },
      wallet: await readWallet(db.runQuery, userId),
      grants: shopService.describeGrants(parseJsonOr(rows[0].reward_snapshot, [])),
    };
  }

  return { createCheckoutSession, getCheckoutStatus };
}

module.exports = { createCheckoutSessions };
