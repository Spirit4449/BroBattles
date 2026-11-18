function createStripeConfiguration({
  publishableKey,
  secretKey,
  listener,
  publicBaseUrl,
  stripe,
  loadError,
  automaticTax,
  shopService,
}) {
  function getConfigurationStatus() {
    const missing = [];
    if (!publishableKey) missing.push("STRIPE_PUBLISHABLE_KEY");
    if (!secretKey) missing.push("STRIPE_SECRET_KEY");
    if (!listener.getSigningSecret()) missing.push("STRIPE_WEBHOOK_SECRET");
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
    if (!listener.getSigningSecret()) {
      throw shopService.createShopError(
        503,
        "payments_unavailable",
        "Stripe webhook verification is unavailable.",
      );
    }
  }

  return { getConfigurationStatus, assertEnabled, assertStripeClient, assertWebhookEnabled };
}

module.exports = { createStripeConfiguration };
