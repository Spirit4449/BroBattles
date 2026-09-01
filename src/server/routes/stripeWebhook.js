const express = require("express");

function registerStripeWebhookRoute({ app, stripeShopService }) {
  app.post(
    "/api/payments/stripe/webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        await stripeShopService.handleWebhook(
          req.body,
          req.headers["stripe-signature"],
        );
        return res.status(200).json({ received: true });
      } catch (error) {
        const signatureFailure =
          String(error?.type || "").includes("Signature") ||
          String(error?.message || "").toLowerCase().includes("signature");
        console.error("[shop:stripe] webhook error", error?.message || error);
        return res
          .status(signatureFailure ? 400 : Number(error?.status) || 500)
          .json({ received: false, error: signatureFailure ? "Invalid signature" : "Webhook processing failed" });
      }
    },
  );
}

module.exports = { registerStripeWebhookRoute };
