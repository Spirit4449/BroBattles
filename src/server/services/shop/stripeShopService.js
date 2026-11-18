const { createStripeConfiguration } = require("./stripeConfiguration");
const { createShopOrders } = require("./shopOrders");
const { createCheckoutSessions } = require("./checkoutSessions");
const { createOrderFulfillment } = require("./orderFulfillment");
const { createPaymentReversals } = require("./paymentReversals");
const { createWebhookInbox } = require("./webhookInbox");

const { getConfig } = require("../../config");

function safeErrorMessage(error) {
  return String(error?.message || error || "Unknown error").slice(0, 255);
}

function loadStripeClient(secretKey) {
  if (!secretKey) return { stripe: null };
  try {
    const Stripe = require("stripe");
    return { stripe: new Stripe(secretKey) };
  } catch (loadError) {
    console.error("[shop:stripe] Stripe SDK unavailable", loadError.message);
    return { stripe: null, loadError };
  }
}

function createStripeShopService({
  db,
  shopService,
  configuration = getConfig().stripe,
  stripeClient,
  loadError = null,
  listener = null,
}) {
  const { publishableKey, secretKey, webhookSecret, publicBaseUrl, automaticTax } = configuration;
  let stripe = stripeClient;
  if (stripeClient === undefined) ({ stripe, loadError } = loadStripeClient(secretKey));
  listener ||= {
    getSigningSecret: () => webhookSecret,
    getStatus: () => ({ state: "unverified", message: "Local listener is disabled." }),
  };
  const { getConfigurationStatus, assertEnabled, assertStripeClient, assertWebhookEnabled } =
    createStripeConfiguration({
      publishableKey,
      secretKey,
      listener,
      publicBaseUrl,
      stripe,
      loadError,
      automaticTax,
      shopService,
    });
  const { normalizeReturnPath, getOrCreateOrder } = createShopOrders({ shopService, db });
  const { createCheckoutSession, getCheckoutStatus } = createCheckoutSessions({
    assertEnabled,
    shopService,
    getOrCreateOrder,
    stripe,
    normalizeReturnPath,
    publicBaseUrl,
    automaticTax,
    db,
    safeErrorMessage,
  });
  const { fulfillCheckoutSession } = createOrderFulfillment({
    assertStripeClient,
    stripe,
    db,
    shopService,
  });
  const { applyRefund, applyDispute } = createPaymentReversals({ db, shopService });
  const { handleWebhook, reconcileWebhooks } = createWebhookInbox({
    db,
    fulfillCheckoutSession,
    applyRefund,
    applyDispute,
    shopService,
    safeErrorMessage,
    assertWebhookEnabled,
    stripe,
    listener,
  });

  return {
    createCheckoutSession,
    fulfillCheckoutSession,
    getCheckoutStatus,
    getConfigurationStatus,
    listener,
    handleWebhook,
    reconcileWebhooks,
  };
}

module.exports = { createStripeShopService, loadStripeClient };
