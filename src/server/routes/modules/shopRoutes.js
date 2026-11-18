const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { authedRoute } = require("../http");

function shopErrorFields(error) {
  return { code: error?.code || "shop_error", wallet: error?.details?.wallet || error?.wallet || undefined };
}

function registerShopRoutes({ app, requireCurrentUser, shopService, stripeShopService }) {
  app.get(API_PATHS.API_SHOP_BOOTSTRAP, authedRoute(requireCurrentUser, "[shop] /api/shop/bootstrap", async (req, res, user) => {
    const paymentConfig = stripeShopService.getConfigurationStatus();
    return res.json(
      await shopService.buildBootstrap(user, {
        paymentsEnabled: paymentConfig.enabled,
        publishableKey: paymentConfig.publishableKey,
      }),
    );
  }, { fallback: "Unable to load the shop.", extra: shopErrorFields }));

  app.post(API_PATHS.API_SHOP_VIEWED, authedRoute(requireCurrentUser, "[shop] /api/shop/viewed", async (req, res, user) => {
    return res.json(await shopService.markViewed({
      userId: user.user_id,
      rotations: req.body?.rotations,
      offerIds: req.body?.offerIds,
    }));
  }, { fallback: "Unable to save viewed shop content.", extra: shopErrorFields }));

  app.post(API_PATHS.API_SHOP_CLAIM_DAILY, authedRoute(requireCurrentUser, "[shop] /api/shop/claim-daily", async (req, res, user) => {
    return res.json(
      await shopService.claimDaily({
        userId: user.user_id,
        idempotencyKey: req.body?.idempotencyKey,
      }),
    );
  }, { fallback: "Unable to claim the daily reward.", extra: shopErrorFields }));

  app.post(API_PATHS.API_SHOP_PURCHASE, authedRoute(requireCurrentUser, "[shop] /api/shop/purchase", async (req, res, user) => {
    return res.json(
      await shopService.purchaseVirtual({
        userId: user.user_id,
        offerId: req.body?.offerId,
        expectedPrice: req.body?.expectedPrice,
        expectedCurrency: req.body?.expectedCurrency,
        idempotencyKey: req.body?.idempotencyKey,
      }),
    );
  }, { fallback: "Unable to complete the purchase.", extra: shopErrorFields }));

  app.post(API_PATHS.API_SHOP_CHECKOUT_SESSION, authedRoute(requireCurrentUser, "[shop] /api/shop/checkout-session", async (req, res, user) => {
    return res.json(
      await stripeShopService.createCheckoutSession({
        user,
        offerId: req.body?.offerId,
        idempotencyKey: req.body?.idempotencyKey,
        returnPath: req.body?.returnPath,
      }),
    );
  }, { fallback: "Unable to start checkout.", extra: shopErrorFields }));

  app.get(API_PATHS.API_SHOP_CHECKOUT_STATUS, authedRoute(requireCurrentUser, "[shop] /api/shop/checkout-status", async (req, res, user) => {
    const sessionId = String(req.query?.sessionId || "").trim();
    if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
    return res.json(
      await stripeShopService.getCheckoutStatus({
        userId: user.user_id,
        sessionId,
      }),
    );
  }, { fallback: "Unable to check the order.", extra: shopErrorFields }));
}

module.exports = { registerShopRoutes };
