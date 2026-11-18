const { parseJsonOr } = require("../../lib/json");
const { adjustWallet } = require("../economy/walletService");

function createPaymentReversals({ db, shopService }) {
  function currencyTotals(grants) {
    const totals = { coins: 0, gems: 0 };
    for (const grant of grants || []) {
      if (grant.kind !== "currency") continue;
      const currency = grant.currency === "gems" ? "gems" : "coins";
      totals[currency] += Math.max(0, Math.round(Number(grant.amount) || 0));
    }
    return totals;
  }

  async function setReversalTarget({ paymentIntentId, refundDeltaCents, eventId, disputeStatus }) {
    if (!paymentIntentId) return null;
    return db.withTransaction(async (_conn, q) => {
      const rows = await q(
        "SELECT * FROM shop_orders WHERE stripe_payment_intent_id = ? FOR UPDATE",
        [String(paymentIntentId)],
      );
      const order = rows[0];
      if (!order || !order.fulfilled_at) {
        throw shopService.createShopError(
          503,
          "order_not_ready",
          "Payment order is not ready for reversal; retry required.",
        );
      }
      const [receipt] = await q(
        "SELECT processed_at FROM shop_webhook_events WHERE event_id = ? FOR UPDATE",
        [eventId],
      );
      // The receipt and reversal commit together. A stale processing claim can
      // retry while the first worker is still running, so check under the lock.
      if (receipt?.processed_at) return null;
      const userRows = await q("SELECT coins, gems FROM users WHERE user_id = ? FOR UPDATE", [
        order.user_id,
      ]);
      if (!userRows[0]) return null;

      const amountCents = Math.max(1, Number(order.amount_cents) || 1);
      const nextRefundedAmount =
        refundDeltaCents == null
          ? Number(order.refunded_amount_cents) || 0
          : Math.min(
              amountCents,
              Math.max(
                0,
                (Number(order.refunded_amount_cents) || 0) + (Number(refundDeltaCents) || 0),
              ),
            );
      const nextDisputeStatus = disputeStatus ?? order.dispute_status ?? null;
      const activeDispute =
        (disputeStatus != null || order.status === "disputed") && nextDisputeStatus !== "won";
      const clampedTarget = activeDispute
        ? amountCents
        : Math.min(amountCents, Math.max(0, nextRefundedAmount));
      const refunded =
        nextRefundedAmount >= amountCents || (disputeStatus === "won" && nextRefundedAmount > 0);
      const orderStatus = activeDispute ? "disputed" : refunded ? "refunded" : "fulfilled";
      const totals = currencyTotals(parseJsonOr(order.reward_snapshot, []));
      const desiredCoins = Math.round((totals.coins * clampedTarget) / amountCents);
      const desiredGems = Math.round((totals.gems * clampedTarget) / amountCents);
      const deltaCoins = desiredCoins - (Number(order.reversed_coins) || 0);
      const deltaGems = desiredGems - (Number(order.reversed_gems) || 0);

      await adjustWallet(
        q,
        order.user_id,
        { coins: -deltaCoins, gems: -deltaGems },
        {
          sourceType: "stripe_reversal",
          sourceId: { coins: `${eventId}:coins`, gems: `${eventId}:gems` },
          idempotent: true,
        },
      );

      await q(
        "UPDATE shop_orders SET status = ?, refunded_amount_cents = ?, reversed_coins = ?, reversed_gems = ?, dispute_status = ? WHERE order_id = ?",
        [
          orderStatus,
          nextRefundedAmount,
          desiredCoins,
          desiredGems,
          nextDisputeStatus,
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
      refundDeltaCents: Math.max(0, Number(refund?.amount) || 0) * (Number(direction) < 0 ? -1 : 1),
      eventId,
    });
  }

  async function applyDispute(dispute, eventId, created) {
    const paymentIntentId = String(dispute?.payment_intent || "");
    if (!paymentIntentId) return null;
    return setReversalTarget({
      paymentIntentId,
      eventId,
      disputeStatus: String(dispute?.status || (created ? "needs_response" : "closed")),
    });
  }

  return { applyRefund, applyDispute };
}

module.exports = { createPaymentReversals };
