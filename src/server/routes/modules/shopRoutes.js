function sendShopError(res, error, fallback = "Shop request failed") {
  const status = Math.max(400, Math.min(599, Number(error?.status) || 500));
  if (status >= 500) console.error("[shop] request failed", error);
  return res.status(status).json({
    success: false,
    code: error?.code || "shop_error",
    error: status >= 500 ? fallback : error?.message || fallback,
    wallet: error?.wallet || undefined,
  });
}

function registerShopRoutes({ app, requireCurrentUser, shopService, stripeShopService }) {
  app.get("/api/shop/bootstrap", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ success: false, error: "Not authenticated" });
      const paymentConfig = stripeShopService.getConfigurationStatus();
      return res.json(
        await shopService.buildBootstrap(user, {
          paymentsEnabled: paymentConfig.enabled,
          publishableKey: paymentConfig.publishableKey,
        }),
      );
    } catch (error) {
      return sendShopError(res, error, "Unable to load the shop.");
    }
  });

  app.post("/api/shop/claim-daily", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ success: false, error: "Not authenticated" });
      return res.json(
        await shopService.claimDaily({
          userId: user.user_id,
          idempotencyKey: req.body?.idempotencyKey,
        }),
      );
    } catch (error) {
      return sendShopError(res, error, "Unable to claim the daily reward.");
    }
  });

  app.post("/api/shop/purchase", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ success: false, error: "Not authenticated" });
      return res.json(
        await shopService.purchaseVirtual({
          userId: user.user_id,
          offerId: req.body?.offerId,
          idempotencyKey: req.body?.idempotencyKey,
        }),
      );
    } catch (error) {
      return sendShopError(res, error, "Unable to complete the purchase.");
    }
  });

  app.post("/api/shop/checkout-session", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ success: false, error: "Not authenticated" });
      return res.json(
        await stripeShopService.createCheckoutSession({
          user,
          offerId: req.body?.offerId,
          idempotencyKey: req.body?.idempotencyKey,
          returnPath: req.body?.returnPath,
        }),
      );
    } catch (error) {
      return sendShopError(res, error, "Unable to start checkout.");
    }
  });

  app.get("/api/shop/checkout-status", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ success: false, error: "Not authenticated" });
      const sessionId = String(req.query?.sessionId || "").trim();
      if (!sessionId) return res.status(400).json({ success: false, error: "sessionId is required" });
      return res.json(
        await stripeShopService.getCheckoutStatus({
          userId: user.user_id,
          sessionId,
        }),
      );
    } catch (error) {
      return sendShopError(res, error, "Unable to check the order.");
    }
  });
}

module.exports = { registerShopRoutes };
