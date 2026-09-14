# Public pages, support, and settings

The game remains at `/`. Public routes are `/about`, `/news`, `/news/:slug`, `/help`, `/help/:slug`, `/help/contact`, `/help/requests`, `/feedback`, `/privacy`, and `/terms`. Public articles are rendered by Express without guest creation, sockets, or Phaser.

## Content and release configuration

Edit `content/manifest.json` for News and Help titles, slugs, summaries, categories, dates, and artwork. Add the corresponding Markdown file under `content/news/` or `content/help/`. Use plain Markdown; raw HTML is disabled. Deploy the `content/` directory alongside `src/` and `dist/`, and restart the server to reload the manifest. Do not use unannounced or invented release claims.

`content/legal/privacy.md` and `content/legal/terms.md` contain reviewable drafts using the supplied operator details. Before publication, confirm Cloudflare products, origin hosting, logging, existing-data retention, transfer safeguards, regional consumer/minor requirements, and manual privacy-request operations with qualified counsel. These documents do not make the game globally compliant by themselves.

`src/shared/siteConfig.json` owns the visible version (`beta v1.1`), document versions, contact details, and retention durations. Increment document versions when seeking renewed acceptance. No date of birth or age eligibility step is implemented. The Terms state a 13+ audience and guardian-permission requirements.

Signup records acceptance of both document versions atomically with conversion of the guest account. Existing and guest players accept when first pressing Ready, then continue into matchmaking. Lobby sockets can connect before acceptance; Ready, queue entry, and game-data access require current acceptance. Public information and support remain available separately. Already connected players may finish a match during a deployment; a reconnect uses the current server versions.

## Database and API

Run `node scripts/apply-site-migration.cjs` before starting this release. The SQL is also included in `database.md`. Startup verifies all three tables. Existing accounts, balances, and matches are preserved.

- `POST /api/feedback`: authenticated guest/member feedback; category, subject, message, submissionKey.
- `GET/POST /api/support/requests`: permanent-account conversation list/create.
- `GET /api/support/requests/:id`, `POST /api/support/requests/:id/messages`: owner-only reading and replies.
- `/api/admin/feedback` and `/api/admin/support`: administrator-only lists and details; `POST /:id/status` changes triage state. `POST /api/admin/support/:id/messages` replies.
- `GET /api/site/session`: signed-in state and unread support count, without creating a guest.
- `GET /api/legal/status`, `POST /api/legal/accept`: current document acceptance. `accepted` must be literal true, with matching `termsVersion` and `privacyVersion`.
- `GET /api/site/legal/:kind`: shared legal markup for popups.
- `queue:leave` now optionally acknowledges `{ok:true|false}`; existing callers without an acknowledgment remain supported. Site navigation waits for confirmed queue cancellation.

Writes require browser same-origin Fetch Metadata or a matching Origin header; cross-site requests are rejected. Set `PUBLIC_BASE_URL` to the actual browser origin (or leave it unset locally so the request origin is used). All request ownership and authorship comes from authenticated sessions. Members cannot read other members' conversations. Submissions are plain text, with subject 3–120 characters and message 5–4000 characters. Idempotency keys prevent retry duplication. Guest feedback has no reply channel; durable support requires an account.

Feedback is removed after 12 months. Closed support is removed 12 months after closure; open conversations remain until closed. Hourly cleanup deletes at most 1,000 parent records per run, with message cascade deletion. No uploads or outbound email service is configured. Privacy requests and password-recovery help are manual through the provided support email; do not promise automated fulfillment.

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

Settings includes expandable keyboard remapping. Letter, digit, arrow, and Space bindings are supported; duplicates and reserved shortcuts are rejected. Changes apply to the active player and reset restores all defaults. Battle Settings is a non-modal side panel; its Controls section replaces the separate controls button.
