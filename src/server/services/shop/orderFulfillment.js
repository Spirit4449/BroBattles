const { parseJsonOr } = require("../../lib/json");
const { readWallet } = require("../economy/walletService");

function createOrderFulfillment({ assertStripeClient, stripe, db, shopService }) {
  async function fulfillCheckoutSession(sessionId) {
    assertStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!session || session.payment_status === "unpaid") {
      return { fulfilled: false, status: session?.status || "open" };
    }
    const orderId = String(session.metadata?.orderId || "");
    if (!orderId) throw new Error("Checkout Session is missing order metadata.");

    return db.withTransaction(async (_conn, q) => {
      const orderRows = await q("SELECT * FROM shop_orders WHERE order_id = ? FOR UPDATE", [
        orderId,
      ]);
      const order = orderRows[0];
      if (!order) throw new Error("Shop order not found.");
      if (
        String(session.metadata?.userId || "") !== String(order.user_id) ||
        String(session.metadata?.offerId || "") !== String(order.offer_id) ||
        Number(session.amount_total) !== Number(order.amount_cents) ||
        String(session.currency || "").toLowerCase() !== String(order.currency || "").toLowerCase()
      ) {
        throw new Error("Checkout Session does not match the saved order.");
      }

      const userRows = await q(
        "SELECT user_id, coins, gems FROM users WHERE user_id = ? FOR UPDATE",
        [order.user_id],
      );
      if (!userRows[0]) throw new Error("Order user not found.");

      if (!order.fulfilled_at) {
        const grants = parseJsonOr(order.reward_snapshot, []);
        if (grants.some((grant) => grant.kind !== "currency")) {
          throw new Error("A real-money order contains a non-currency grant.");
        }
        await shopService.applyGrants(q, order.user_id, grants, "stripe", order.order_id);
        await q(
          "UPDATE shop_orders SET status = 'fulfilled', stripe_checkout_session_id = ?, stripe_payment_intent_id = ?, fulfilled_at = COALESCE(fulfilled_at, NOW()), last_error = NULL WHERE order_id = ?",
          [session.id, String(session.payment_intent || "") || null, order.order_id],
        );
      }

      if (session.customer) {
        await q(
          "UPDATE users SET stripe_customer_id = COALESCE(stripe_customer_id, ?) WHERE user_id = ?",
          [String(session.customer), order.user_id],
        );
      }
      return {
        fulfilled: true,
        orderId: order.order_id,
        wallet: await readWallet(q, order.user_id),
        grants: parseJsonOr(order.reward_snapshot, []),
      };
    });
  }

  return { fulfillCheckoutSession };
}

module.exports = { createOrderFulfillment };
