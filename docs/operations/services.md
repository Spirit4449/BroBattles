# Site, social, support, and email

The game remains at `/`. Public routes are `/about`, `/news`, `/news/:slug`, `/help`, `/help/:slug`, `/help/contact`, `/help/requests`, `/feedback`, `/privacy`, and `/terms`. Public articles are rendered by Express without guest creation, sockets, or Phaser.

## Content and release configuration

Edit `content/manifest.json` for News and Help titles, slugs, summaries, categories, dates, and artwork. Add the corresponding Markdown file under `content/news/` or `content/help/`. Use plain Markdown; raw HTML is disabled. Deploy the `content/` directory alongside `src/` and `dist/`, and restart the server to reload the manifest. Do not use unannounced or invented release claims.

`content/legal/privacy.md` and `content/legal/terms.md` are the legal source documents served by the application. Changes to policies or operator details require a deliberate content/version update; implementation notes do not establish legal compliance.

`src/shared/site/siteConfig.json` owns the visible version (`beta v1.1`), document versions, support contact, and retention durations. Increment document versions when seeking renewed acceptance. No date of birth or age eligibility step is implemented. The Terms state a 13+ audience and guardian-permission requirements.

Signup records acceptance of both document versions atomically with conversion of the guest account. Existing and guest players accept when first pressing Ready, then continue into matchmaking. Lobby sockets can connect before acceptance; Ready, queue entry, and game-data access require current acceptance. Public information and support remain available separately. Already connected players may finish a match during a deployment; a reconnect uses the current server versions.

## Database and API

Run `node scripts/db/apply-migration.cjs site` before starting this release. See [database setup](database.md) for prerequisites and migration order. Startup verifies all three tables. Existing accounts, balances, and matches are preserved.

- `POST /api/feedback`: authenticated guest/member feedback; category, subject, message, submissionKey.
- `GET/POST /api/support/requests`: permanent-account conversation list/create.
- `GET /api/support/requests/:id`, `POST /api/support/requests/:id/messages`: owner-only reading and replies.
- `/api/admin/feedback` and `/api/admin/support`: administrator-only lists and details; `POST /:id/status` changes triage state. `POST /api/admin/support/:id/messages` replies.
- `GET /api/site/session`: signed-in state and unread support count, without creating a guest.
- `GET /api/legal/status`, `POST /api/legal/accept`: current document acceptance. `accepted` must be literal true, with matching `termsVersion` and `privacyVersion`.
- `GET /api/site/legal/:kind`: shared legal markup for popups.
- `queue:leave` now optionally acknowledges `{ok:true|false}`; existing callers without an acknowledgment remain supported. Site navigation waits for confirmed queue cancellation.

Writes require browser same-origin Fetch Metadata or a matching Origin header; cross-site requests are rejected. Set `PUBLIC_BASE_URL` to the actual browser origin (or leave it unset locally so the request origin is used). All request ownership and authorship comes from authenticated sessions. Members cannot read other members' conversations. Submissions are plain text, with subject 3–120 characters and message 5–4000 characters. Idempotency keys prevent retry duplication. Guest feedback has no reply channel; durable support requires an account.

Feedback is removed after 12 months. Closed support is removed 12 months after closure; open conversations remain until closed. Hourly cleanup deletes at most 1,000 parent records per run, with message cascade deletion. Support does not accept attachments. When email is configured, new requests enqueue owner notifications; replies are read in the support interface. Privacy requests and password-recovery help are manual through the provided support email; do not promise automated fulfillment.

## Browser preferences

Settings use `bb_settings_v1` in local storage and synchronize between same-origin tabs. They remain device-local. Sensitivity is a multiplier on existing aiming tuning; defaults preserve the prior behavior. SFX applies to Phaser effects and UI audio. Background volume separately controls map and sudden-death music, including active tracks.

Opening a Settings or legal dialog releases pointer capture and suppresses local combat/movement input; it does not pause an online match. With automatic hiding disabled, movement keys do not capture the cursor; clicking the arena still does.

Streamer mode obscures known username labels using pixel mosaics, supplies neutral accessibility labels, and hides battle HUD/canvas name text. Existing lobby code reads DOM text as identity, so original DOM strings are retained as application data under the opaque presentation. It is a screen-sharing feature, not anonymization: it does not hide network data, developer tools, or names typed inside free text. Admin support messages and free-text reports may also contain names.

## Verification

- `node --test tests/siteFeatures.test.js tests/combatMouse.test.js`
- `node tests/siteSupport.integration.cjs` (configured MySQL; connection-local temporary tables, no persistent test data)
- `npm test`
- `npm run validate:content`
- `npm run build`

Verify the waffle menu, keyboard focus, settings/reset, signup legal popups, article search, feedback submission, member replies, admin triage, and narrow-screen layouts in a browser. Before international launch, separately review server regions/capacity, localization, moderation/reporting, asset licenses, account recovery, payment obligations, and privacy operations.

Settings includes expandable keyboard remapping. Configurable actions accept supported key codes; duplicate bindings are rejected. Arrow alternatives and Space dash remain fixed in `src/client/site/keyBindings.mjs`. Changes apply to the active player and reset restores all defaults. Battle Settings is a non-modal side panel; its Controls section replaces the separate controls button.

## Email configuration and delivery

The profile Account area supports Add Email Address / Change Email Address. A permanent, authenticated account can request a six-digit code. Codes expire after ten minutes, allow five guesses, are HMAC hashed, and are consumed on verification. Verified addresses are unique and are never included in public profile responses. Sending is limited to once per minute and five times per hour per account, plus an IP limit. Email does not yet provide password recovery.

Server configuration: `RESEND_API_KEY` (or existing `EMAIL_API_KEY`), `EMAIL_FROM` (default `Bro Battles <noreply@brobattles.dev>`), `EMAIL_NOTIFICATIONS_TO` (owner inbox), and optional `EMAIL_VERIFICATION_SECRET` (defaults to `COOKIE_SECRET`). Keep these server-side. Production needs the same variables separately if it uses another environment. Set production `PUBLIC_BASE_URL` to the deployed HTTPS origin and `SECURE_COOKIES=true`.

Apply `node scripts/db/apply-migration.cjs email` after the site support migration, then build and restart the server. Startup checks the new tables. Verify the target database after applying it.

After the signup/marketing migration, run `node scripts/db/apply-migration.cjs email-polish` on existing installations. It adds the persisted first-correction waiver to both verification flows. One address correction may skip the minute wait; later corrections and reloads preserve the cooldown, and every send still counts toward the hourly limit.

New feedback and support requests enqueue one notification within the same transaction as the request. A worker sends one pending notification every 15 seconds. Provider failures retry every ten minutes, up to eight attempts; request submission remains saved. Resend idempotency keys prevent duplicate sends during retries. Alert content contains the category and subject; review the full message in the admin area. Existing requests are not backfilled. Support reply notifications are outside this implementation.

Check failures with `SELECT id,request_id,attempts,next_attempt_at FROM email_outbox WHERE sent_at IS NULL;`. After resolving delivery configuration, reset attempts and next_attempt_at for the intended failed rows. Retrying more than 24 hours after an uncertain send may duplicate mail because provider idempotency expires.

Provider DNS and receiving routes are deployment-specific. Verify the sender domain with the provider and test delivery in the target environment; the repository cannot establish current DNS or inbox configuration.

## Marketing

Signup always verifies email before an account is activated. The existing guest session remains active during this step. An optional, unchecked checkbox records marketing consent; a verified opt-in queues a welcome email about three minutes after verification. Set `MARKETING_POSTAL_ADDRESS` before welcome delivery is enabled. Every message contains a signed-free random unsubscribe URL that works without login and also honors standard one-click unsubscribe headers.

Use Resend's Broadcast editor for occasional campaigns. Create a Resend API key with Contacts access and set it as `RESEND_MARKETING_API_KEY`; the app then syncs each verified player's subscription state to Resend Contacts. Build and schedule Broadcasts in Resend, including its unsubscribe placeholder/footer. Do not use the transactional key for this: a send-only key cannot perform contact synchronization. The app's own welcome message is transactional and independently honors the player preference.

Broadcast opt-outs are checked when email preferences are opened and immediately before a welcome message is sent. Provider failures leave the welcome queued rather than ignoring the unsubscribe check. New local preference changes sync first. Contact updates use Resend's update endpoint so an existing contact is updated correctly; failed welcome sends stop after five attempts.

## Friends

`src/server/services/social/friendService.js` owns friend codes, requests, friendships, recent-player suggestions and direct messages. `src/client/friends/friendsPanelController.js` owns the panel; route/socket modules authenticate transport before calling the service. Guests cannot use friends. Apply the `friends` migration helper before enabling these flows; see [database](database.md).

Friends show live activity while connected and a relative last-seen time while offline, with the exact local time on hover in the list and direct-message header. Apply `npm run migrate:apply -- friend-last-seen` before restarting with this change. `users.last_seen_at` persists activity independently of party membership, refreshes every ten seconds while active, and records transitions offline. Accounts without recorded activity show “Last seen unknown” until their next visit.

Privacy settings live in `user_privacy_settings` (no row means defaults); `src/shared/social/privacy.cjs` defines the fields and `friendService` enforces them. Players choose who can send friend requests (everyone, recent players with 2+ matches in 14 days, or no one), whether friends can message them or send party invites, whether friends see their last-seen time, whether read receipts are shared (both players must allow them; typing indicators show unless the friend has messages off), and whether they appear in other players' suggestions. They are edited in Settings → Privacy and, for friend requests, in the friends Add tab. Apply `npm run migrate:apply -- privacy-settings` before restarting with this change; the friends list query joins the table.

## Name changes

Permanent accounts pay 50 gems per name change at `/profile/change-username`. A successful change starts a one-calendar-month cooldown (month-end dates clamp to the last day of the next month). Balance, name, party membership name, and cooldown update in one transaction under an account row lock. Invalid or taken names, insufficient gems, and submitting the current name do not charge or restart the cooldown. The profile form shows the cost and next eligible local date.

Apply `npm run migrate:apply -- name-changes` before restarting the server. Existing accounts start with no cooldown; signup names remain free.
