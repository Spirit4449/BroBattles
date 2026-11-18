const { ServiceError } = require("../../services/httpError");
const { webhookPath } = require("../../jobs/stripeListener");
const express = require("express");

function registerStripeWebhookRoute({ app, stripeShopService }) {
  app.post(
    webhookPath,
    express.raw({ type: "application/json" }),
    async (req, res) => {
      try {
        await stripeShopService.handleWebhook(
          req.body,
          req.headers["stripe-signature"],
        );
        return res.status(200).json({ received: true });
      } catch (error) {
        const signatureFailure = error?.type === "StripeSignatureVerificationError";
        const status = signatureFailure ? 400 : error instanceof ServiceError && [409, 503].includes(error.status) ? error.status : 500;
        console.error("[shop:stripe] webhook error", status >= 500 ? error.stack || error : error?.message);
        return res.status(status)
          .json({ received: false, error: signatureFailure ? "Invalid signature" : "Webhook processing failed" });
      }
    },
  );
}

module.exports = { registerStripeWebhookRoute };
