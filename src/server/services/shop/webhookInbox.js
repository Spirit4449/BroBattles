const { parseJsonOr } = require("../../lib/json");

function createWebhookInbox({
  db,
  fulfillCheckoutSession,
  applyRefund,
  applyDispute,
  shopService,
  safeErrorMessage,
  assertWebhookEnabled,
  stripe,
  listener,
}) {
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

  async function processVerifiedEvent(event) {
    const inserted = await db.runQuery(
      "INSERT IGNORE INTO shop_webhook_events (event_id, event_type, status) VALUES (?, ?, 'processing')",
      [event.id, event.type],
    );
    if (Number(inserted?.affectedRows) === 0) {
      const rows = await db.runQuery(
        "SELECT status, processed_at FROM shop_webhook_events WHERE event_id = ? LIMIT 1",
        [event.id],
      );
      if (rows[0]?.status === "processed" || rows[0]?.processed_at) {
        if (rows[0].status !== "processed") {
          await db.runQuery(
            "UPDATE shop_webhook_events SET status = 'processed', last_error = NULL WHERE event_id = ?",
            [event.id],
          );
        }
        await db.runQuery("DELETE FROM shop_webhook_inbox WHERE event_id = ?", [event.id]);
        return { duplicate: true };
      }
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
      await db.runQuery("DELETE FROM shop_webhook_inbox WHERE event_id = ?", [event.id]);
      return { processed: true };
    } catch (error) {
      await db.runQuery(
        "UPDATE shop_webhook_events SET status = 'failed', last_error = ? WHERE event_id = ? AND status <> 'processed'",
        [safeErrorMessage(error), event.id],
      );
      await db.runQuery(
        "UPDATE shop_webhook_inbox SET next_attempt_at = DATE_ADD(NOW(), INTERVAL 1 MINUTE) WHERE event_id = ?",
        [event.id],
      );
      throw error;
    }
  }

  async function handleWebhook(payload, signature) {
    assertWebhookEnabled();
    const event = stripe.webhooks.constructEvent(payload, signature, listener.getSigningSecret());
    // Only signature-verified events enter the durable inbox.
    await db.runQuery("INSERT IGNORE INTO shop_webhook_inbox (event_id, payload) VALUES (?, ?)", [
      event.id,
      JSON.stringify(event),
    ]);
    return processVerifiedEvent(event);
  }

  let reconciling = false;

  async function reconcileWebhooks() {
    if (reconciling || !stripe) return;
    reconciling = true;
    try {
      const pending = await db.runQuery(
        "SELECT event_id, payload FROM shop_webhook_inbox WHERE next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 25",
      );
      for (const row of pending) {
        try {
          await processVerifiedEvent(parseJsonOr(row.payload, {}));
        } catch (error) {
          console.warn("[shop:stripe] reconciliation pending", row.event_id, error?.message);
        }
      }
    } finally {
      reconciling = false;
    }
  }

  return { handleWebhook, reconcileWebhooks };
}

module.exports = { createWebhookInbox };
