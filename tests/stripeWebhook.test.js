const test = require("node:test");
const assert = require("node:assert/strict");

const { CommerceFakeDb } = require("./helpers/commerceFakeDb");
const { registerStripeWebhookRoute } = require("../src/server/routes/modules/stripeWebhook");
const { createShopService } = require("../src/server/services/shop/shopService");
const { createStripeShopService } = require("../src/server/services/shop/stripeShopService");

const WEBHOOK_PATH = "/api/payments/stripe/webhook";
const SIGNING_SECRET = "test-signing-secret";
const MINUTE_MS = 60_000;
const offer = {
  id: "test-pack",
  name: "Test Gems",
  price: { type: "money", amountCents: 499, currency: "usd" },
  grants: [{ kind: "currency", currency: "gems", amount: 500 }],
};
const gemGrant = offer.grants[0].amount;

function makeOrder(overrides = {}) {
  return {
    order_id: "order-1",
    user_id: 7,
    offer_id: offer.id,
    status: "pending",
    amount_cents: offer.price.amountCents,
    currency: offer.price.currency,
    reward_snapshot: JSON.stringify(offer.grants),
    idempotency_key: "test-order",
    stripe_checkout_session_id: null,
    stripe_payment_intent_id: null,
    fulfilled_at: null,
    refunded_amount_cents: 0,
    reversed_coins: 0,
    reversed_gems: 0,
    dispute_status: null,
    last_error: null,
    ...overrides,
  };
}

class StripeFakeDb extends CommerceFakeDb {
  constructor(user, order) {
    super(user);
    Object.assign(this.state, {
      orders: new Map([[order.order_id, structuredClone(order)]]),
      events: new Map(),
      inbox: new Map(),
    });
    this.now = new Date("2026-01-10T00:00:00.000Z");
    this.inboxReads = 0;
  }

  advanceTime(milliseconds) {
    this.now = new Date(+this.now + milliseconds);
  }

  async query(rawSql, params = []) {
    const sql = rawSql.replace(/\s+/g, " ").trim();
    if (sql.includes("shop_webhook_events")) return this.queryEvents(sql, params);
    if (sql.includes("shop_webhook_inbox")) return this.queryInbox(sql, params);
    if (sql.includes("shop_orders")) return this.queryOrders(sql, params);
    if (sql.startsWith("SELECT user_id, coins, gems FROM users")) {
      const row = this.state.users.get(params[0]);
      return row ? [{ user_id: row.user_id, coins: row.coins, gems: row.gems }] : [];
    }
    if (sql.startsWith("UPDATE users SET stripe_customer_id")) {
      this.state.users.get(params[1]).stripe_customer_id ??= params[0];
      return { affectedRows: 1 };
    }
    if (sql.startsWith("INSERT IGNORE INTO shop_currency_ledger")) {
      const row = params;
      const [, currency, , source, sourceId] = row;
      if (this.state.ledger.some(entry => entry[1] === currency && entry[3] === source && entry[4] === sourceId)) {
        return { affectedRows: 0 };
      }
      return super.query(sql, row);
    }
    return super.query(sql, params);
  }

  queryOrders(sql, params) {
    const { orders } = this.state;
    if (sql.startsWith("SELECT * FROM shop_orders")) {
      const rows = [...orders.values()];
      let order;
      if (sql.includes("WHERE stripe_payment_intent_id")) {
        order = rows.find(row => row.stripe_payment_intent_id === params[0]);
      } else if (sql.includes("WHERE user_id = ? AND idempotency_key")) {
        order = rows.find(row => row.user_id === params[0] && row.idempotency_key === params[1]);
      } else if (sql.includes("WHERE user_id = ? AND stripe_checkout_session_id")) {
        order = rows.find(row => row.user_id === params[0] && row.stripe_checkout_session_id === params[1]);
      } else if (sql.includes("WHERE order_id = ?")) {
        order = orders.get(params[0]);
      } else {
        throw new Error(`Unexpected SQL in Stripe order test: ${sql}`);
      }
      return order ? [structuredClone(order)] : [];
    }
    if (sql.startsWith("INSERT INTO shop_orders")) {
      const [order_id, user_id, offer_id, amount_cents, currency, reward_snapshot, idempotency_key] = params;
      if ([...orders.values()].some(row => row.user_id === user_id && row.idempotency_key === idempotency_key)) {
        throw Object.assign(new Error("Duplicate order"), { code: "ER_DUP_ENTRY" });
      }
      orders.set(order_id, makeOrder({ order_id, user_id, offer_id, amount_cents, currency, reward_snapshot, idempotency_key }));
      return { affectedRows: 1 };
    }
    const order = orders.get(params.at(-1));
    if (sql.startsWith("UPDATE shop_orders SET status = 'fulfilled'")) {
      order.status = "fulfilled";
      order.stripe_checkout_session_id = params[0];
      order.stripe_payment_intent_id = params[1];
      order.fulfilled_at ??= this.now;
      order.last_error = null;
    } else if (sql.startsWith("UPDATE shop_orders SET status = ?, refunded_amount_cents")) {
      [
        order.status, order.refunded_amount_cents, order.reversed_coins,
        order.reversed_gems, order.dispute_status,
      ] = params;
    } else if (sql.startsWith("UPDATE shop_orders SET status = ?, stripe_checkout_session_id")) {
      if (!order || order.fulfilled_at || !["pending", "paid", "failed", "expired"].includes(order.status)) {
        return { affectedRows: 0 };
      }
      order.status = params[0];
      order.stripe_checkout_session_id ??= params[1];
      order.last_error = null;
    } else if (sql.startsWith("UPDATE shop_orders SET stripe_checkout_session_id")) {
      order.stripe_checkout_session_id = params[0];
      order.stripe_payment_intent_id ??= params[1];
      order.last_error = null;
    } else if (sql.startsWith("UPDATE shop_orders SET last_error")) {
      order.last_error = params[0];
    } else {
      throw new Error(`Unexpected SQL in Stripe order test: ${sql}`);
    }
    return { affectedRows: 1 };
  }

  queryEvents(sql, params) {
    const { events } = this.state;
    const event = events.get(params.at(-1));
    if (sql.startsWith("INSERT IGNORE")) {
      const [event_id, event_type] = params;
      if (events.has(event_id)) return { affectedRows: 0 };
      events.set(event_id, { event_id, event_type, status: "processing", attempt_count: 1, received_at: this.now, last_error: null });
    } else if (sql.startsWith("SELECT status, processed_at")) {
      return event ? [{ status: event.status, processed_at: event.processed_at }] : [];
    } else if (sql.startsWith("SELECT processed_at")) {
      return event ? [{ processed_at: event.processed_at }] : [];
    } else if (sql.startsWith("UPDATE shop_webhook_events SET status = 'processing'")) {
      if (event.status !== "failed" && +event.received_at >= +this.now - 5 * MINUTE_MS) {
        return { affectedRows: 0 };
      }
      Object.assign(event, { status: "processing", attempt_count: event.attempt_count + 1, last_error: null, received_at: this.now });
    } else if (sql.startsWith("UPDATE shop_webhook_events SET status = 'processed'")) {
      Object.assign(event, { status: "processed", last_error: null });
      if (sql.includes("processed_at = NOW()")) event.processed_at = this.now;
    } else if (sql.startsWith("UPDATE shop_webhook_events SET status = 'failed'")) {
      if (event.status === "processed") return { affectedRows: 0 };
      Object.assign(event, { status: "failed", last_error: params[0] });
    } else {
      throw new Error(`Unexpected SQL in Stripe event test: ${sql}`);
    }
    return { affectedRows: 1 };
  }

  queryInbox(sql, [eventId, payload]) {
    const { inbox } = this.state;
    if (sql.startsWith("INSERT IGNORE")) {
      if (inbox.has(eventId)) return { affectedRows: 0 };
      inbox.set(eventId, { event_id: eventId, payload, next_attempt_at: this.now });
    } else if (sql.startsWith("DELETE")) {
      return { affectedRows: Number(inbox.delete(eventId)) };
    } else if (sql.startsWith("UPDATE shop_webhook_inbox SET next_attempt_at")) {
      inbox.get(eventId).next_attempt_at = new Date(+this.now + MINUTE_MS);
    } else if (sql.startsWith("SELECT event_id, payload")) {
      this.inboxReads += 1;
      return [...inbox.values()]
        .filter(row => row.next_attempt_at <= this.now)
        .sort((first, second) => first.next_attempt_at - second.next_attempt_at)
        .slice(0, 25)
        .map(({ event_id, payload }) => ({ event_id, payload }));
    } else {
      throw new Error(`Unexpected SQL in Stripe inbox test: ${sql}`);
    }
    return { affectedRows: 1 };
  }
}

function makeSession(order, overrides = {}) {
  return {
    id: "cs_test",
    payment_status: "paid",
    status: "complete",
    amount_total: order.amount_cents,
    currency: order.currency,
    metadata: { orderId: order.order_id, userId: String(order.user_id), offerId: order.offer_id },
    customer: "cus_test",
    payment_intent: "pi_test",
    ...overrides,
  };
}

function eventOf(type, object, id = type) {
  return { id, type, data: { object } };
}

function fixture({ sessionOverrides, orderOverrides, stripeCreateError } = {}) {
  const savedOrder = makeOrder(orderOverrides);
  const user = { user_id: savedOrder.user_id, coins: 10, gems: 0, stripe_customer_id: null };
  const db = new StripeFakeDb(user, savedOrder);
  const shopService = createShopService({ db, catalogProvider: () => ({ offers: [offer] }) });
  // The checkout lookup currently reads the live catalog even with a custom provider.
  shopService.getShopOfferById = id => id === offer.id ? offer : undefined;
  const session = makeSession(savedOrder, sessionOverrides);
  const sessions = new Map([[session.id, session]]);
  const retrievedSessions = [];
  const stripeClient = {
    checkout: { sessions: {
      async retrieve(id) {
        retrievedSessions.push(id);
        return structuredClone(sessions.get(id));
      },
      async create({ metadata }) {
        if (stripeCreateError) throw stripeCreateError;
        const created = { ...session, metadata };
        sessions.set(created.id, created);
        return structuredClone(created);
      },
    } },
    webhooks: {
      constructEvent(payload, signature, secret) {
        assert.equal(secret, SIGNING_SECRET);
        assert.ok(Buffer.isBuffer(payload));
        if (signature !== "good") {
          throw Object.assign(new Error("Signature did not match the supplied payload"), {
            type: "StripeSignatureVerificationError",
          });
        }
        return JSON.parse(payload);
      },
    },
  };
  const service = createStripeShopService({
    db, shopService, stripeClient,
    configuration: {
      secretKey: "test-secret",
      webhookSecret: SIGNING_SECRET,
      publishableKey: "test-publishable",
      publicBaseUrl: "https://game.test",
      automaticTax: false,
      production: false,
    },
  });
  const deliver = event => service.handleWebhook(Buffer.from(JSON.stringify(event)), "good");
  const complete = () => deliver(eventOf("checkout.session.completed", session));
  const refund = (amount, id, type = "refund.created") =>
    deliver(eventOf(type, { amount, payment_intent: session.payment_intent }, id));
  const dispute = (type, status) =>
    deliver(eventOf(`charge.dispute.${type}`, { status, payment_intent: session.payment_intent }));
  return {
    db, service, session, user, deliver, complete, refund, dispute, retrievedSessions,
    order: () => db.state.orders.get(savedOrder.order_id),
    wallet: () => db.state.users.get(user.user_id),
  };
}

test("duplicate webhook event ids are processed once", async () => {
  const f = fixture();
  assert.deepEqual(await f.complete(), { processed: true });
  assert.deepEqual(await f.complete(), { duplicate: true });
  assert.equal(f.wallet().gems, gemGrant);
  assert.equal(f.db.state.inbox.size, 0);
  assert.equal(f.db.state.events.get("checkout.session.completed").status, "processed");
  assert.deepEqual(f.retrievedSessions, [f.session.id]);
});

test("checkout.session.completed fulfils exactly once and grants currency", async () => {
  const f = fixture();
  const checkout = await f.service.createCheckoutSession({
    user: f.user, offerId: offer.id, idempotencyKey: "checkout-start",
  });
  await f.deliver(eventOf("checkout.session.completed", { ...f.session, id: checkout.sessionId }));
  const saved = await f.service.getCheckoutStatus({ userId: f.user.user_id, sessionId: checkout.sessionId });
  assert.equal(saved.order.status, "fulfilled");
  assert.ok(saved.order.fulfilled_at instanceof Date);
  assert.deepEqual(saved.wallet, { coins: f.user.coins, gems: gemGrant });
  assert.equal(f.wallet().stripe_customer_id, f.session.customer);

  const retried = await f.service.fulfillCheckoutSession(checkout.sessionId);
  assert.equal(retried.fulfilled, true);
  assert.deepEqual(retried.wallet, saved.wallet);
  assert.deepEqual(f.db.state.ledger, [[f.user.user_id, "gems", gemGrant, "stripe_grant", checkout.orderId]]);
});

test("checkout creation records Stripe errors on the pending order", async () => {
  const stripeCreateError = new Error("Stripe could not create a session");
  const f = fixture({ stripeCreateError });
  await assert.rejects(f.service.createCheckoutSession({
    user: f.user, offerId: offer.id, idempotencyKey: "checkout-failure",
  }), stripeCreateError);
  const saved = [...f.db.state.orders.values()].find(order => order.idempotency_key === "checkout-failure");
  assert.equal(saved.status, "pending");
  assert.equal(saved.last_error, stripeCreateError.message);
});

test("unpaid sessions are not fulfilled", async () => {
  const f = fixture({ sessionOverrides: { payment_status: "unpaid", status: "open" } });
  assert.deepEqual(await f.complete(), { processed: true });
  assert.deepEqual(f.retrievedSessions, []);
  assert.deepEqual(await f.service.fulfillCheckoutSession(f.session.id), { fulfilled: false, status: "open" });
  assert.equal(f.order().status, "pending");
  assert.equal(f.wallet().gems, 0);
});

test("mismatched amount, user, offer or currency leaves the order unfulfilled", async t => {
  const metadata = makeSession(makeOrder()).metadata;
  for (const [name, sessionOverrides] of Object.entries({
    amount: { amount_total: offer.price.amountCents + 1 },
    user: { metadata: { ...metadata, userId: "8" } },
    offer: { metadata: { ...metadata, offerId: "other-pack" } },
    currency: { currency: "eur" },
  })) {
    await t.test(name, async () => {
      const f = fixture({ sessionOverrides });
      await assert.rejects(f.complete(), { message: "Checkout Session does not match the saved order." });
      assert.equal(f.order().status, "pending");
      assert.equal(f.order().fulfilled_at, null);
      assert.equal(f.wallet().gems, 0);
      assert.equal(f.db.state.ledger.length, 0);
      assert.equal(f.db.state.events.get("checkout.session.completed").status, "failed");
      assert.ok(f.db.state.inbox.get("checkout.session.completed").next_attempt_at > f.db.now);
    });
  }
});

test("missing checkout order metadata throws", async () => {
  const f = fixture({ sessionOverrides: { metadata: {} } });
  await assert.rejects(f.complete(), { message: "Checkout Session is missing order metadata." });
  assert.equal(f.order().status, "pending");
  assert.equal(f.wallet().gems, 0);
});

test("two partial refunds reverse proportionally", async () => {
  const f = fixture();
  await f.complete();

  for (const [id, refund, refundedTotal] of [["first-refund", 100, 100], ["second-refund", 150, 250]]) {
    const previousReversed = f.order().reversed_gems;
    const expected = Math.round(gemGrant * refundedTotal / offer.price.amountCents);
    await f.refund(refund, id);
    assert.equal(f.order().refunded_amount_cents, refundedTotal);
    assert.equal(f.order().reversed_gems, expected);
    assert.equal(f.wallet().gems, gemGrant - expected);
    assert.equal(f.order().status, "fulfilled");
    assert.deepEqual(f.db.state.ledger.at(-1), [f.user.user_id, "gems", previousReversed - expected, "stripe_reversal", `${id}:gems`]);
  }
  await f.refund(offer.price.amountCents - f.order().refunded_amount_cents, "final-refund");
  assert.equal(f.order().status, "refunded");
  assert.equal(f.wallet().gems, 0);
});

test("refund amounts are clamped to the order amount and failed refunds are clamped at zero", async () => {
  const f = fixture();
  await f.complete();
  await f.refund(offer.price.amountCents + 10, "oversized-refund");
  assert.equal(f.order().refunded_amount_cents, offer.price.amountCents);
  assert.equal(f.order().reversed_gems, gemGrant);
  assert.equal(f.wallet().gems, 0);

  await f.refund(offer.price.amountCents + 20, "oversized-failure", "refund.failed");
  assert.equal(f.order().refunded_amount_cents, 0);
  assert.equal(f.order().reversed_gems, 0);
  assert.equal(f.wallet().gems, gemGrant);
});

test("refund.failed re-credits a prior refund", async () => {
  const f = fixture();
  await f.complete();
  await f.refund(100, "refund");
  const reversed = f.order().reversed_gems;
  await f.refund(100, "refund-failed", "refund.failed");
  assert.ok(reversed > 0);
  assert.equal(f.order().reversed_gems, 0);
  assert.equal(f.wallet().gems, gemGrant);
  assert.deepEqual(f.db.state.ledger.slice(1), [
    [f.user.user_id, "gems", -reversed, "stripe_reversal", "refund:gems"],
    [f.user.user_id, "gems", reversed, "stripe_reversal", "refund-failed:gems"],
  ]);
});

test("a processed refund cannot debit the wallet again after its receipt status is reset", async () => {
  const f = fixture();
  await f.complete();
  await f.refund(100, "refund");
  const gemsAfterRefund = f.wallet().gems;
  assert.deepEqual(await f.refund(100, "refund"), { duplicate: true });
  assert.equal(f.wallet().gems, gemsAfterRefund);

  const receipt = f.db.state.events.get("refund");
  const processedAt = receipt.processed_at;
  f.db.advanceTime(MINUTE_MS);
  receipt.status = "failed";
  assert.deepEqual(await f.refund(100, "refund"), { duplicate: true });
  assert.equal(f.order().refunded_amount_cents, 100);
  assert.equal(f.wallet().gems, gemsAfterRefund);
  assert.equal(receipt.status, "processed");
  assert.equal(receipt.processed_at, processedAt);
  assert.equal(f.db.state.ledger.filter(row => row[4] === "refund:gems").length, 1);
});

test("a dispute reverses the purchase and a win restores it to the refunded amount", async t => {
  for (const priorRefund of [0, 100]) {
    await t.test(`prior refund of ${priorRefund} cents`, async () => {
      const f = fixture();
      await f.complete();
      if (priorRefund > 0) await f.refund(priorRefund, "partial-refund");
      const gemsBeforeDispute = f.wallet().gems;
      const reversedBeforeDispute = f.order().reversed_gems;

      await f.dispute("created");
      assert.equal(f.order().status, "disputed");
      assert.equal(f.order().dispute_status, "needs_response");
      assert.equal(f.wallet().gems, 0);
      assert.equal(f.order().reversed_gems, gemGrant);

      await f.dispute("closed", "won");
      assert.equal(f.order().dispute_status, "won");
      assert.equal(f.order().refunded_amount_cents, priorRefund);
      assert.equal(f.order().reversed_gems, reversedBeforeDispute);
      assert.equal(f.wallet().gems, gemsBeforeDispute);
      assert.equal(f.order().status, priorRefund ? "refunded" : "fulfilled");
    });
  }
});

test("a lost dispute leaves the full reversal in place", async () => {
  const f = fixture();
  await f.complete();
  await f.dispute("created", "under_review");
  assert.equal(f.order().dispute_status, "under_review");
  await f.dispute("closed", "lost");
  assert.equal(f.order().status, "disputed");
  assert.equal(f.order().dispute_status, "lost");
  assert.equal(f.order().reversed_gems, gemGrant);
  assert.equal(f.wallet().gems, 0);
});

test("an event for an unfulfilled order remains in the inbox and is retried after fulfilment", async () => {
  const f = fixture({ orderOverrides: { stripe_payment_intent_id: "pi_test" } });
  await assert.rejects(f.refund(100, "early-refund"), { status: 503, code: "order_not_ready" });
  assert.equal(f.db.state.events.get("early-refund").status, "failed");
  assert.ok(f.db.state.inbox.has("early-refund"));

  await f.complete();
  await f.service.reconcileWebhooks();
  assert.equal(f.db.state.events.get("early-refund").attempt_count, 1);
  assert.equal(f.wallet().gems, gemGrant);

  f.db.advanceTime(MINUTE_MS);
  await f.service.reconcileWebhooks();
  assert.equal(f.db.state.events.get("early-refund").status, "processed");
  assert.equal(f.db.state.events.get("early-refund").attempt_count, 2);
  assert.equal(f.db.state.events.get("early-refund").last_error, null);
  assert.equal(f.db.state.inbox.size, 0);
  assert.equal(f.order().refunded_amount_cents, 100);
  assert.equal(f.wallet().gems, gemGrant - f.order().reversed_gems);
});

test("a failed reversal rolls back both currencies and can retry the same event", async t => {
  const coinGrant = 250;
  const grants = [...offer.grants, { kind: "currency", currency: "coins", amount: coinGrant }];
  const f = fixture({ orderOverrides: { reward_snapshot: JSON.stringify(grants) } });
  await f.complete();
  const query = f.db.query.bind(f.db);
  const failure = t.mock.method(f.db, "query", (sql, params) => {
    if (sql.startsWith("UPDATE shop_orders SET status = ?, refunded_amount_cents")) {
      throw new Error("Could not save reversal");
    }
    return query(sql, params);
  });
  await assert.rejects(f.refund(offer.price.amountCents, "refunded"), { message: "Could not save reversal" });
  assert.equal(f.wallet().gems, gemGrant);
  assert.equal(f.wallet().coins, f.user.coins + coinGrant);
  assert.equal(f.order().status, "fulfilled");
  assert.deepEqual(f.db.state.ledger.map(row => row[3]), ["stripe_grant", "stripe_grant"]);
  assert.equal(f.db.state.events.get("refunded").status, "failed");

  failure.mock.restore();
  assert.deepEqual(await f.refund(offer.price.amountCents, "refunded"), { processed: true });
  assert.equal(f.wallet().gems, 0);
  assert.equal(f.wallet().coins, f.user.coins);
  assert.equal(f.order().status, "refunded");
  assert.deepEqual(f.db.state.ledger.slice(2), [
    [f.user.user_id, "coins", -coinGrant, "stripe_reversal", "refunded:coins"],
    [f.user.user_id, "gems", -gemGrant, "stripe_reversal", "refunded:gems"],
  ]);
  assert.equal(f.db.state.inbox.size, 0);
});

test("webhook processing takes over stale claims and rejects fresh ones", async () => {
  const f = fixture();
  const eventId = "checkout.session.completed";
  f.db.state.events.set(eventId, { status: "processing", received_at: f.db.now, attempt_count: 1 });
  await assert.rejects(f.complete(), { status: 409, code: "webhook_in_progress" });
  assert.equal(f.wallet().gems, 0);
  assert.equal(f.db.state.events.get(eventId).attempt_count, 1);

  f.db.advanceTime(6 * MINUTE_MS);
  assert.deepEqual(await f.complete(), { processed: true });
  assert.equal(f.wallet().gems, gemGrant);
  assert.equal(f.db.state.events.get(eventId).attempt_count, 2);
  assert.equal(f.db.state.inbox.size, 0);
});

test("reconcileWebhooks continues after failures and prevents concurrent reconciliation", async t => {
  t.mock.method(console, "warn", () => {});
  const f = fixture();
  const failingEvent = eventOf("refund.created", { amount: 100, payment_intent: "missing-intent" }, "no-order");
  const validEvent = eventOf("checkout.session.completed", f.session);
  for (const event of [failingEvent, validEvent]) {
    f.db.state.inbox.set(event.id, { event_id: event.id, payload: JSON.stringify(event), next_attempt_at: f.db.now });
  }
  await Promise.all([f.service.reconcileWebhooks(), f.service.reconcileWebhooks()]);
  assert.equal(f.db.inboxReads, 1);
  assert.deepEqual([...f.db.state.inbox.keys()], [failingEvent.id]);
  assert.ok(f.db.state.inbox.get(failingEvent.id).next_attempt_at > f.db.now);
  assert.equal(f.db.state.events.get(failingEvent.id).status, "failed");
  assert.equal(f.db.state.events.get(validEvent.id).status, "processed");
  assert.equal(f.wallet().gems, gemGrant);
});

test("checkout.session.expired and async_payment_failed update only unfulfilled orders", async t => {
  for (const [type, status] of [["expired", "expired"], ["async_payment_failed", "failed"]]) {
    await t.test(type, async () => {
      const f = fixture();
      await f.deliver(eventOf(`checkout.session.${type}`, f.session));
      assert.equal(f.order().status, status);
      assert.equal(f.order().stripe_checkout_session_id, f.session.id);

      await f.deliver(eventOf("checkout.session.async_payment_succeeded", f.session));
      await f.deliver(eventOf(`checkout.session.${type}`, f.session, `second-${type}`));
      assert.equal(f.order().status, "fulfilled");
      assert.equal(f.wallet().gems, gemGrant);
    });
  }
});

test("unknown event types are acknowledged without changing orders or wallets", async () => {
  const f = fixture();
  const event = eventOf("payment_intent.created", { id: "pi_test" });
  assert.deepEqual(await f.deliver(event), { processed: true });
  assert.equal(f.db.state.events.get(event.id).status, "processed");
  assert.equal(f.db.state.inbox.size, 0);
  assert.equal(f.order().status, "pending");
  assert.equal(f.wallet().gems, 0);
  assert.deepEqual(f.db.state.ledger, []);
});

async function callWebhookRoute(service, event, signature = "good") {
  let handler;
  const app = {
    post(path, rawBody, callback) {
      assert.equal(path, WEBHOOK_PATH);
      assert.equal(typeof rawBody, "function");
      handler = callback;
    },
  };
  registerStripeWebhookRoute({ app, stripeShopService: service });
  const res = {
    status(status) { return { json: body => ({ status, body }) }; },
  };
  return handler({ body: Buffer.from(JSON.stringify(event)), headers: { "stripe-signature": signature } }, res);
}

test("webhook route answers 400 for a bad signature without persisting the event", async t => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  const result = await callWebhookRoute(f.service, eventOf("checkout.session.completed", f.session), "bad");
  assert.deepEqual(result, { status: 400, body: { received: false, error: "Invalid signature" } });
  assert.equal(f.db.state.inbox.size, 0);
  assert.equal(f.db.state.events.size, 0);
});

test("webhook route answers 200 when a verified event is processed", async () => {
  const f = fixture();
  const result = await callWebhookRoute(f.service, eventOf("checkout.session.completed", f.session));
  assert.deepEqual(result, { status: 200, body: { received: true } });
  assert.equal(f.wallet().gems, gemGrant);
});

test("webhook route preserves retry statuses for in-progress events and unfulfilled orders", async t => {
  t.mock.method(console, "error", () => {});
  const f = fixture();
  const completion = eventOf("checkout.session.completed", f.session);
  f.db.state.events.set(completion.id, { status: "processing", received_at: f.db.now, attempt_count: 1 });
  assert.deepEqual(await callWebhookRoute(f.service, completion), {
    status: 409, body: { received: false, error: "Webhook processing failed" },
  });

  const refund = eventOf("refund.created", { amount: 100, payment_intent: f.session.payment_intent });
  assert.deepEqual(await callWebhookRoute(f.service, refund), {
    status: 503, body: { received: false, error: "Webhook processing failed" },
  });
  assert.equal(f.db.state.inbox.size, 2);
});

test("webhook route answers 500 without echoing the processing error", async t => {
  t.mock.method(console, "error", () => {});
  const f = fixture({ sessionOverrides: { metadata: {} } });
  const completion = eventOf("checkout.session.completed", f.session);
  assert.deepEqual(await callWebhookRoute(f.service, completion), {
    status: 500, body: { received: false, error: "Webhook processing failed" },
  });
  assert.equal(f.db.state.events.get(completion.id).last_error, "Checkout Session is missing order metadata.");
});

test("webhook route treats unexpected service errors as retryable even when their text mentions a signature", async t => {
  t.mock.method(console, "error", () => {});
  const service = { async handleWebhook() { throw Object.assign(new Error("database signature field unavailable"), { status: 422 }); } };
  assert.equal((await callWebhookRoute(service, {})).status, 500);
});
