# Bro Battles email

The profile Account area supports Add Email Address / Change Email Address. A permanent, authenticated account can request a six-digit code. Codes expire after ten minutes, allow five guesses, are HMAC hashed, and are consumed on verification. Verified addresses are unique and are never included in public profile responses. Sending is limited to once per minute and five times per hour per account, plus an IP limit. Email does not yet provide password recovery.

Server configuration: `RESEND_API_KEY` (or existing `EMAIL_API_KEY`), `EMAIL_FROM` (default `Bro Battles <noreply@brobattles.dev>`), `EMAIL_NOTIFICATIONS_TO` (owner inbox), and optional `EMAIL_VERIFICATION_SECRET` (defaults to `COOKIE_SECRET`). Keep these server-side. Production needs the same variables separately if it uses another environment. Production must also set `PUBLIC_BASE_URL=https://brobattles.dev` and `SECURE_COOKIES=true`.

Apply `node scripts/apply-email-migration.cjs` after the site support migration, then build and restart the server. Startup checks the new tables. This additive migration has been applied to the configured development database.

After the signup/marketing migration, run `node scripts/apply-email-polish-migration.cjs` on existing installations. It adds the persisted first-correction waiver to both verification flows. One address correction may skip the minute wait; later corrections and reloads preserve the cooldown, and every send still counts toward the hourly limit.

New feedback and support requests enqueue one notification within the same transaction as the request. A worker sends one pending notification every 15 seconds. Provider failures retry every ten minutes, up to eight attempts; request submission remains saved. Resend idempotency keys prevent duplicate sends during retries. Alert content contains the category and subject; review the full message in the admin area. Existing requests are not backfilled. Support reply notifications are outside this implementation.

Check failures with `SELECT id,request_id,attempts,next_attempt_at FROM email_outbox WHERE sent_at IS NULL;`. After resolving delivery configuration, reset attempts and next_attempt_at for the intended failed rows. Retrying more than 24 hours after an uncertain send may duplicate mail because provider idempotency expires.

Domain configuration (September 20, 2026): Resend sends from `brobattles.dev`; set `EMAIL_FROM` to `Bro Battles <noreply@brobattles.dev>`. Cloudflare Email Routing handles receiving, with `support@brobattles.dev` forwarding to the verified owner inbox. The root SPF record must retain Cloudflare routing, while the `send` subdomain uses Resend's SPF and `feedback-smtp.us-east-1.amazonses.com` MX record. Keep Resend receiving disabled so it does not conflict with Cloudflare's root MX records. Verify the domain in Resend and send a production verification-email test after deployment.

## Marketing

Signup always verifies email before an account is activated. The existing guest session remains active during this step. An optional, unchecked checkbox records marketing consent; a verified opt-in queues a welcome email about three minutes after verification. Set `MARKETING_POSTAL_ADDRESS` before welcome delivery is enabled. Every message contains a signed-free random unsubscribe URL that works without login and also honors standard one-click unsubscribe headers.

Use Resend's Broadcast editor for occasional campaigns. Create a Resend API key with Contacts access and set it as `RESEND_MARKETING_API_KEY`; the app then syncs each verified player's subscription state to Resend Contacts. Build and schedule Broadcasts in Resend, including its unsubscribe placeholder/footer. Do not use the transactional key for this: the current key is send-only. The app's own welcome message is transactional and independently honors the player preference.

Broadcast opt-outs are checked when email preferences are opened and immediately before a welcome message is sent. Provider failures leave the welcome queued rather than ignoring the unsubscribe check. New local preference changes sync first. Contact updates use Resend's update endpoint so an existing contact is updated correctly; failed welcome sends stop after five attempts.
