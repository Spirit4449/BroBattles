const crypto = require("crypto");

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (_) {
    return fallback;
  }
}

function safeErrorMessage(error) {
  return String(error?.message || error || "Unknown error").slice(0, 255);
}

function createStripeShopService({ db, shopService }) {
  const publishableKey = String(process.env.STRIPE_PUBLISHABLE_KEY || "").trim();
  const secretKey = String(process.env.STRIPE_SECRET_KEY || "").trim();
  const webhookSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
  const publicBaseUrl = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  const automaticTax =
    String(process.env.STRIPE_AUTOMATIC_TAX || "").toLowerCase() === "true";
  let stripe = null;
  let loadError = null;

  if (secretKey) {
    try {
      const Stripe = require("stripe");
      stripe = new Stripe(secretKey);
    } catch (error) {
      loadError = error;
      console.error("[shop:stripe] Stripe SDK unavailable", error?.message || error);
    }
  }

  function getConfigurationStatus() {
    const missing = [];
    if (!publishableKey) missing.push("STRIPE_PUBLISHABLE_KEY");
    if (!secretKey) missing.push("STRIPE_SECRET_KEY");
    if (!webhookSecret) missing.push("STRIPE_WEBHOOK_SECRET");
    if (!publicBaseUrl) missing.push("PUBLIC_BASE_URL");
    if (!stripe && secretKey) missing.push("stripe package");
    return {
      enabled: missing.length === 0 && !loadError,
      publishableKey: missing.length === 0 && !loadError ? publishableKey : null,
      automaticTax,
      missing,
    };
  }

  function assertEnabled() {
    const config = getConfigurationStatus();
    if (!config.enabled) {
      throw shopService.createShopError(
        503,
        "payments_unavailable",
        "Payments are not configured yet.",
      );
    }
  }

  function assertStripeClient() {
    if (!secretKey || !stripe || loadError) {
      throw shopService.createShopError(
        503,
        "payments_unavailable",
        "Stripe payment processing is unavailable.",
      );
    }
  }

  function assertWebhookEnabled() {
    assertStripeClient();
    if (!webhookSecret) {
      throw shopService.createShopError(
        503,
        "payments_unavailable",
        "Stripe webhook verification is unavailable.",
      );
    }
  }

  function normalizeReturnPath(raw) {
    const value = String(raw || "/").trim();
    if (value === "/") return value;
    if (/^\/party\/[1-9][0-9]*$/.test(value)) return value;
    return "/";
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
      if (
        String(existing[0].offer_id || "") !== String(offer.id || "") ||
        Number(existing[0].amount_cents) !== Number(offer.price.amountCents) ||
        String(existing[0].currency || "").toLowerCase() !==
          String(offer.price.currency || "usd").toLowerCase()
      ) {
        throw shopService.createShopError(
          409,
          "idempotency_conflict",
          "That idempotency key was already used for a different order.",
        );
      }
      return existing[0];
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
        if (
          String(raced[0].offer_id || "") !== String(offer.id || "") ||
          Number(raced[0].amount_cents) !== Number(offer.price.amountCents) ||
          String(raced[0].currency || "").toLowerCase() !==
            String(offer.price.currency || "usd").toLowerCase()
        ) {
          throw shopService.createShopError(
            409,
            "idempotency_conflict",
            "That idempotency key was already used for a different order.",
          );
        }
        return raced[0];
      }
      throw error;
    }
    const rows = await db.runQuery(
      "SELECT * FROM shop_orders WHERE order_id = ? LIMIT 1",
      [orderId],
    );
    return rows[0];
  }

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
        "UPDATE shop_orders SET stripe_checkout_session_id = ?, last_error = NULL WHERE order_id = ?",
        [session.id, order.order_id],
      );
      return {
        success: true,
        orderId: order.order_id,
        sessionId: session.id,
        clientSecret: session.client_secret,
      };
    } catch (error) {
      await db.runQuery(
        "UPDATE shop_orders SET last_error = ? WHERE order_id = ?",
        [safeErrorMessage(error), order.order_id],
      );
      throw error;
    }
  }

  async function fulfillCheckoutSession(sessionId) {
    assertStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status === "unpaid") {
      return { fulfilled: false, status: session?.status || "open" };
    }
    const orderId = String(session.metadata?.orderId || "");
    if (!orderId) throw new Error("Checkout Session is missing order metadata.");

    return db.withTransaction(async (_conn, q) => {
      const orderRows = await q(
        "SELECT * FROM shop_orders WHERE order_id = ? FOR UPDATE",
        [orderId],
      );
      const order = orderRows[0];
      if (!order) throw new Error("Shop order not found.");
      if (
        String(session.metadata?.userId || "") !== String(order.user_id) ||
        String(session.metadata?.offerId || "") !== String(order.offer_id) ||
        Number(session.amount_total) !== Number(order.amount_cents) ||
        String(session.currency || "").toLowerCase() !==
          String(order.currency || "").toLowerCase()
      ) {
        throw new Error("Checkout Session does not match the saved order.");
      }

      const userRows = await q(
        "SELECT user_id, coins, gems FROM users WHERE user_id = ? FOR UPDATE",
        [order.user_id],
      );
      if (!userRows[0]) throw new Error("Order user not found.");

      if (!order.fulfilled_at) {
        const grants = parseJson(order.reward_snapshot, []);
        if (grants.some((grant) => grant.kind !== "currency")) {
          throw new Error("A real-money order contains a non-currency grant.");
        }
        await shopService.applyGrants(
          q,
          order.user_id,
          grants,
          "stripe",
          order.order_id,
        );
        await q(
          "UPDATE shop_orders SET status = 'fulfilled', stripe_checkout_session_id = ?, stripe_payment_intent_id = ?, fulfilled_at = COALESCE(fulfilled_at, NOW()), last_error = NULL WHERE order_id = ?",
          [
            session.id,
            String(session.payment_intent || "") || null,
            order.order_id,
          ],
        );
      }

      if (session.customer) {
        await q(
          "UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE user_id = ?",
          [String(session.customer), order.user_id],
        );
      }
      const walletRows = await q(
        "SELECT coins, gems FROM users WHERE user_id = ?",
        [order.user_id],
      );
      return {
        fulfilled: true,
        orderId: order.order_id,
        wallet: {
          coins: Number(walletRows[0]?.coins) || 0,
          gems: Number(walletRows[0]?.gems) || 0,
        },
        grants: parseJson(order.reward_snapshot, []),
      };
    });
  }

  function currencyTotals(grants) {
    const totals = { coins: 0, gems: 0 };
    for (const grant of grants || []) {
      if (grant.kind !== "currency") continue;
      const currency = grant.currency === "gems" ? "gems" : "coins";
      totals[currency] += Math.max(0, Math.round(Number(grant.amount) || 0));
    }
    return totals;
  }

  async function setReversalTarget({
    paymentIntentId,
    targetCents,
    refundDeltaCents,
    eventId,
    orderStatus,
    disputeStatus,
  }) {
    if (!paymentIntentId) return null;
    return db.withTransaction(async (_conn, q) => {
      const rows = await q(
        "SELECT * FROM shop_orders WHERE stripe_payment_intent_id = ? FOR UPDATE",
        [String(paymentIntentId)],
      );
      const order = rows[0];
      if (!order || order.status === "pending") return null;
      const userRows = await q(
        "SELECT coins, gems FROM users WHERE user_id = ? FOR UPDATE",
        [order.user_id],
      );
      if (!userRows[0]) return null;

      const amountCents = Math.max(1, Number(order.amount_cents) || 1);
      const nextRefundedAmount =
        refundDeltaCents == null
          ? Number(order.refunded_amount_cents) || 0
          : Math.min(
              amountCents,
              Math.max(
                0,
                (Number(order.refunded_amount_cents) || 0) +
                  (Number(refundDeltaCents) || 0),
              ),
            );
      const activeDispute =
        String(order.status || "") === "disputed" &&
        String(order.dispute_status || "") !== "won";
      const requestedTarget =
        refundDeltaCents == null
          ? targetCents
          : activeDispute
            ? amountCents
            : nextRefundedAmount;
      const clampedTarget = Math.max(
        0,
        Math.min(amountCents, Number(requestedTarget) || 0),
      );
      const totals = currencyTotals(parseJson(order.reward_snapshot, []));
      const desiredCoins = Math.round((totals.coins * clampedTarget) / amountCents);
      const desiredGems = Math.round((totals.gems * clampedTarget) / amountCents);
      const deltaCoins = desiredCoins - (Number(order.reversed_coins) || 0);
      const deltaGems = desiredGems - (Number(order.reversed_gems) || 0);

      if (deltaCoins || deltaGems) {
        await q(
          "UPDATE users SET coins = coins - ?, gems = gems - ? WHERE user_id = ?",
          [deltaCoins, deltaGems, order.user_id],
        );
        if (deltaCoins) {
          await q(
            "INSERT IGNORE INTO shop_currency_ledger (user_id, currency, amount, source_type, source_id) VALUES (?, 'coins', ?, 'stripe_reversal', ?)",
            [order.user_id, -deltaCoins, `${eventId}:coins`],
          );
        }
        if (deltaGems) {
          await q(
            "INSERT IGNORE INTO shop_currency_ledger (user_id, currency, amount, source_type, source_id) VALUES (?, 'gems', ?, 'stripe_reversal', ?)",
            [order.user_id, -deltaGems, `${eventId}:gems`],
          );
        }
      }

      await q(
        "UPDATE shop_orders SET status = ?, refunded_amount_cents = ?, reversed_coins = ?, reversed_gems = ?, dispute_status = ? WHERE order_id = ?",
        [
          activeDispute
            ? "disputed"
            : refundDeltaCents != null && nextRefundedAmount >= amountCents
              ? "refunded"
              : orderStatus,
          nextRefundedAmount,
          desiredCoins,
          desiredGems,
          disputeStatus || order.dispute_status || null,
          order.order_id,
        ],
      );
      await q(
        "UPDATE shop_webhook_events SET status = 'processed', processed_at = NOW(), last_error = NULL WHERE event_id = ?",
        [eventId],
      );
      return { orderId: order.order_id, reversedCoins: desiredCoins, reversedGems: desiredGems };
    });
  }

  async function applyRefund(refund, eventId, direction = 1) {
    const paymentIntentId = String(refund?.payment_intent || "");
    if (!paymentIntentId) return null;
    return setReversalTarget({
      paymentIntentId,
      refundDeltaCents:
        Math.max(0, Number(refund?.amount) || 0) *
        (Number(direction) < 0 ? -1 : 1),
      eventId,
      orderStatus: "fulfilled",
    });
  }

  async function applyDispute(dispute, eventId, created) {
    const paymentIntentId = String(dispute?.payment_intent || "");
    if (!paymentIntentId) return null;
    const rows = await db.runQuery(
      "SELECT * FROM shop_orders WHERE stripe_payment_intent_id = ? LIMIT 1",
      [paymentIntentId],
    );
    const order = rows[0];
    if (!order) return null;
    if (created) {
      return setReversalTarget({
        paymentIntentId,
        targetCents: Number(order.amount_cents),
        eventId,
        orderStatus: "disputed",
        disputeStatus: String(dispute?.status || "needs_response"),
      });
    }
    const won = String(dispute?.status || "") === "won";
    return setReversalTarget({
      paymentIntentId,
      targetCents: won
        ? Number(order.refunded_amount_cents) || 0
        : Number(order.amount_cents),
      eventId,
      orderStatus: won
        ? Number(order.refunded_amount_cents) > 0
          ? "refunded"
          : "fulfilled"
        : "disputed",
      disputeStatus: String(dispute?.status || "closed"),
    });
  }

  async function updateSessionStatus(session, status) {
    const orderId = String(session?.metadata?.orderId || "");
    if (!orderId) return;
    await db.runQuery(
      "UPDATE shop_orders SET status = ?, stripe_checkout_session_id = COALESCE(stripe_checkout_session_id, ?), last_error = NULL WHERE order_id = ? AND fulfilled_at IS NULL AND status IN ('pending', 'paid', 'failed', 'expired')",
      [status, String(session.id || "") || null, orderId],
    );
  }

  async function processEvent(event) {
    const object = event?.data?.object || {};
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        if (object.payment_status && object.payment_status !== "unpaid") {
          await fulfillCheckoutSession(object.id);
        }
        return;
      case "checkout.session.async_payment_failed":
        await updateSessionStatus(object, "failed");
        return;
      case "checkout.session.expired":
        await updateSessionStatus(object, "expired");
        return;
      case "refund.created":
        await applyRefund(object, event.id);
        return;
      case "refund.failed":
        await applyRefund(object, event.id, -1);
        return;
      case "charge.dispute.created":
        await applyDispute(object, event.id, true);
        return;
      case "charge.dispute.closed":
      case "charge.dispute.funds_reinstated":
        await applyDispute(object, event.id, false);
        return;
      default:
        return;
    }
  }

  async function handleWebhook(payload, signature) {
    assertWebhookEnabled();
    const event = stripe.webhooks.constructEvent(payload, signature, webhookSecret);
    const inserted = await db.runQuery(
      "INSERT IGNORE INTO shop_webhook_events (event_id, event_type, status) VALUES (?, ?, 'processing')",
      [event.id, event.type],
    );
    if (Number(inserted?.affectedRows) === 0) {
      const rows = await db.runQuery(
        "SELECT status, received_at FROM shop_webhook_events WHERE event_id = ? LIMIT 1",
        [event.id],
      );
      if (rows[0]?.status === "processed") return { duplicate: true };
      const claimed = await db.runQuery(
        "UPDATE shop_webhook_events SET status = 'processing', attempt_count = attempt_count + 1, last_error = NULL, received_at = NOW() WHERE event_id = ? AND (status = 'failed' OR received_at < DATE_SUB(NOW(), INTERVAL 5 MINUTE))",
        [event.id],
      );
      if (Number(claimed?.affectedRows) !== 1) {
        throw shopService.createShopError(
          409,
          "webhook_in_progress",
          "This webhook event is already being processed.",
        );
      }
    }
    try {
      await processEvent(event);
      await db.runQuery(
        "UPDATE shop_webhook_events SET status = 'processed', processed_at = NOW(), last_error = NULL WHERE event_id = ?",
        [event.id],
      );
      return { processed: true };
    } catch (error) {
      await db.runQuery(
        "UPDATE shop_webhook_events SET status = 'failed', last_error = ? WHERE event_id = ? AND status <> 'processed'",
        [safeErrorMessage(error), event.id],
      );
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
    const orderRows = await db.runQuery(
      "SELECT order_id, offer_id, status, amount_cents, currency, fulfilled_at FROM shop_orders WHERE order_id = ?",
      [rows[0].order_id],
    );
    const walletRows = await db.runQuery(
      "SELECT coins, gems FROM users WHERE user_id = ?",
      [userId],
    );
    return {
      success: true,
      order: orderRows[0],
      wallet: {
        coins: Number(walletRows[0]?.coins) || 0,
        gems: Number(walletRows[0]?.gems) || 0,
      },
      grants: parseJson(rows[0].reward_snapshot, []),
    };
  }

  return {
    createCheckoutSession,
    fulfillCheckoutSession,
    getCheckoutStatus,
    getConfigurationStatus,
    handleWebhook,
  };
}

module.exports = { createStripeShopService };
