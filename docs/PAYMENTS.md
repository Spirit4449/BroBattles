# Stripe Shop Setup

Bro Battles uses Stripe Embedded Checkout for USD currency packs. Product names,
prices, and grants come from `src/shared/shopCatalog.json`; the browser never
submits a price or reward. Currency is fulfilled only after a signed Stripe
webhook is processed.

## Before the first test

1. Apply `migrations/2026-08-31_shop_commerce.sql` to the `game` database.
2. Copy `.env.example` values into your local `.env` and fill in the database,
   cookie, and Stripe values.
3. This repository historically tracked `.env`. Run the following once before
   committing so Git keeps the local file but stops tracking it:

   ```bash
   git rm --cached .env
   ```

   Because a test secret has already appeared in a tracked `.env` diff, rotate
   that test secret in Stripe before sharing or pushing the repository. Never
   commit a secret key or webhook signing secret.

## Stripe sandbox configuration

1. In the Stripe Dashboard, stay in a sandbox/test environment.
2. Add the Bro Battles name, icon, brand color, and accent color under Branding.
3. Enable Cards and Link under payment methods. Checkout uses Stripe's dynamic
   payment-method configuration, so no payment method is hardcoded in the app.
4. Keep Stripe Tax disabled. The app also requires
   `STRIPE_AUTOMATIC_TAX=false` until registrations and digital-product tax
   treatment have been confirmed. Checkout Sessions explicitly disable Stripe
   Managed Payments as well, even if the sandbox account enables it by default;
   Managed Payments requires a separate merchant-of-record and product tax-code
   setup that this initial currency-only integration does not opt into.
5. Copy the sandbox publishable and secret API keys into:

   ```dotenv
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_SECRET_KEY=sk_test_...
   PUBLIC_BASE_URL=http://localhost:3002
   STRIPE_AUTOMATIC_TAX=false
   ```

The app creates Checkout line items from the server catalog, so you do not need
to create Stripe Products or Prices for these initial currency packs.

## Local webhook forwarding

Install the Stripe CLI, authenticate it, and forward only the events handled by
the shop:

```bash
stripe login
stripe listen \
  --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,refund.created,refund.failed,charge.dispute.created,charge.dispute.closed,charge.dispute.funds_reinstated \
  --forward-to http://localhost:3002/api/payments/stripe/webhook
```

Copy the `whsec_...` value printed by `stripe listen` into
`STRIPE_WEBHOOK_SECRET`, then restart the application when you are ready to run
it. The real-money buttons stay disabled until all Stripe variables are present.

Useful official references:

- [Embedded Checkout](https://docs.stripe.com/payments/accept-a-payment?platform=web&ui=embedded-form)
- [Webhook signatures and local forwarding](https://docs.stripe.com/webhooks)
- [Refund events](https://docs.stripe.com/refunds)
- [Dispute events](https://docs.stripe.com/disputes/responding)

## Dashboard webhook for deployment

Create an HTTPS webhook endpoint at:

```text
https://localhost:3002/api/payments/stripe/webhook
```

Subscribe it to the same events used by the local CLI command. Put that
endpoint's signing secret—not the CLI secret—in production
`STRIPE_WEBHOOK_SECRET`.

For production, also:

- use live publishable and secret keys;
- set `PUBLIC_BASE_URL` to the canonical HTTPS origin with no trailing slash;
- set `SECURE_COOKIES=true`;
- leave automatic tax off until the business decision is complete;
- configure Stripe emails, dispute notifications, and account payout details;
- run a live low-value purchase and refund after the sandbox test matrix passes.

## Manual sandbox checks

Use a permanent Bro Battles account for Checkout. Guests should see the signup
flow and return to `/?shop=currency` afterward.

Verify these behaviors:

- `4242 4242 4242 4242` completes and grants exactly once after the webhook;
- duplicate webhook deliveries do not grant twice;
- an expired or failed Checkout order grants nothing;
- a partial refund removes currency proportionally;
- a full refund removes the full grant;
- a dispute removes the remaining grant and a won dispute restores it;
- Shop orders and Stripe readiness appear on `/admin`.

Wallet balances can become negative after a refund or dispute if the player
already spent the purchased currency. This preserves the accounting trail and
prevents value from being duplicated.
