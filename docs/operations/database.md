# Database setup and migrations

The server uses `mysql2/promise` through `src/server/core/sql.js`. Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and the pool/timeout settings in `.env.example`.

## Bootstrap an empty database

Create an empty MySQL database, for example `CREATE DATABASE game CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`. Set `DB_NAME` and the other connection values in `.env`, then run:

```sh
npm run migrate:apply -- bootstrap
npm run migrate:status
```

The bootstrap builds the original game tables from [0000_base_schema.sql](../../migrations/0000_base_schema.sql) and applies the migrations in [bootstrap order](../../scripts/db/apply-migration.cjs), including schema changes in the named helpers. It requires an empty database and verifies its result against the schema contract used by the maintenance commands. The bootstrap was verified on MySQL 26.7 through the November 17, 2026 payment-intent migration.

## Upgrade an existing database

Inspect the schema before running an upgrade.

```sh
npm run migrate:status
npm run migrate:apply -- --list
```

The status command uses read-only metadata queries. The same schema contract runs at server startup and requires the expected InnoDB tables, columns, index definitions, foreign keys and checks. The per-file DDL hints list expected names. The contract accepts equivalent index or constraint names and permits collation and column-width differences. Historical backfill completion requires separate verification.

If required schema disappears while the server is running, the affected operation returns an error. Restore the schema before retrying. Missing inventory, party settings and moderation tables previously appeared to callers as empty data.

Back up before schema changes. Drain matches and stop older workers before any upgrade that changes queue, rewards or account data. Use the following named steps and apply earlier SQL in the [recorded order](../../scripts/db/apply-migration.cjs) when repairing an older installation.

| Step (`npm run migrate:apply -- <step>`) | Prerequisites and effect |
| --- | --- |
| `player-cards` | Users. Creates player-card ownership and the equipped-card field. |
| `hardening` | InnoDB base, match and Shop tables. Adds battle-log fields, session hashes, reward receipts and webhook inbox. |
| `site` | Base schema. Creates legal acceptance and support tables. |
| `email` | Site support. Creates account email verification and notification outbox. |
| `signup-marketing` | Email setup. Creates pending signups, preferences, jobs and provider sync records. |
| `email-polish` | `email` and `signup-marketing`. Adds `correction_used` to both verification tables. |
| `party-slots` | Party members. Adds the explicit slot index field. |
| `trophy-road` | Trophy claims and cosmetic ownership. Adds trophy peak and backfills non-currency grants. |
| `friends` | Users and matches. Adds friend codes, social tables and the matches-created index. |
| `shop-views` | Users and Shop. Creates account-saved offer and rotation acknowledgments. |
| `friend-last-seen` | Users. Adds persistent friend activity history. |
| `highest-win-streak` | Users and completed battle history. Adds and backfills the stored record. |
| `name-changes` | Users. Adds the paid monthly rename cooldown. |
| `privacy-settings` | Users. Creates per-account social and presence privacy settings. |
| `party-hidden-bros` | Parties. Adds the owner's enemy-portrait visibility setting. |
| `titles` | Users. Adds title ownership and the equipped-title field. |
| `temporary-bans` | Abuse controls. Adds the suspension expiry field. |
| `shop-payment-intent-unique` | Shop orders. Requires one order per Stripe payment intent. |
| `party-member-rename-cascade` | Users and party members. Preserves party membership when an account is renamed. |

### Upgrading Stripe payment-intent uniqueness

If status reports `Missing index on shop_orders UNIQUE (stripe_payment_intent_id)`, run `npm run migrate:apply -- shop-payment-intent-unique` before starting the server. The step can be rerun safely when the unique index already exists. MySQL rejects the change if multiple orders share a non-null payment intent. Reconcile those orders through their payment and refund history before retrying the migration.

### Upgrading party membership renames

If status reports a missing `ON UPDATE CASCADE` foreign key on
`party_members.name`, run `npm run migrate:apply -- party-member-rename-cascade`.
The migration keeps the referenced account name and the existing delete rule.
It can run again after the name foreign key already cascades updates.

### Historical backfills

Apply each historical migration where that upgrade is still needed. Schedule it while the relevant workers are stopped.

- The March 25 mode-registry migration converts legacy party, match and queue selections. The September 3 adaptive-bot migration recalculates old ticket ratings and clears old claims.
- Run the `trophy-road` helper to migrate historical peaks and grant eligible cosmetics without reissuing currency. Run `highest-win-streak` to derive the stored record from completed history. It preserves higher stored records if restarted.
- Apply [2026-11-12_ozzy_sparrow.sql](../../migrations/2026-11-12_ozzy_sparrow.sql) before deploying the renamed characters on an older database. It rewrites stored ownership, selections and identifiers. Legacy aliases keep historical summaries readable.

## Schema ownership

Use the actual SQL in [migrations](../../migrations/) for definitions rather than copying DDL into docs.

| Domain | Stored state / defining migration |
| --- | --- |
| Match selection | `mode_id`, `mode_variant_id` on parties, matches and tickets; `2026-03-25_game_mode_registry_scaffold.sql` |
| Trophy claims | Unique `(user_id, tier_id)` receipts; `2026-04-06_trophy_reward_claims.sql`, `2026-09-15_trophy_road.sql` plus helper |
| Parties | Visibility/name, member selection permissions and slots; April discovery and September member-selection/slot migrations |
| Party chat | Messages, replies, reactions and reads; `2026-04-11_party_chat.sql` |
| Join requests | Per-party/account request state; `2026-04-14_party_join_requests.sql` |
| Cosmetics | April migrations for player cards, profile icons and skins. November 12 migration for titles. |
| Moderation | Offense/suspension/ban fields and abuse events; `2026-04-15_abuse_controls.sql` and `2026-11-12_temporary_bans.sql` |
| Shop | Rotation, redemptions, orders, webhook receipts and ledger; `2026-08-31_shop_commerce.sql` |
| Bots | Temporary `match_bot_participants`; `2026-09-03_adaptive_bots.sql` also backfills queue trophy ratings |
| Battle history | Winner, summary, participant stats/rewards; `2026-09-03_match_battle_log.sql` |
| Sessions and recovery | `auth_sessions`, `match_reward_commits`, `shop_webhook_inbox`; `2026-09-10_production_hardening.sql` |
| Site support | `legal_acceptances`, `site_requests`, `site_request_messages`; `2026-09-12_site_support.sql` |
| Email and marketing | `account_emails`, `email_outbox`, `pending_signups`, `email_marketing`, `marketing_jobs`, `marketing_contact_sync`, `email_webhook_events`; September 13 migrations |
| Friends | `friend_requests`, `friendships`, `friend_messages`, `friend_message_reactions`; `2026-10-02_friends.sql` plus helper |
| Privacy | `user_privacy_settings`, one optional row per account; `2026-10-09_privacy_settings.sql` |

Friend data is keyed by account ID, not username. The generated pending-pair key prevents concurrent pending requests for the same pair. Friendships store both directions; generated conversation pair columns support direct-message lookups. Guests cannot use friends.

## Verification and persistence

`npm run test:db` runs the site-support integration, email verification and Trophy Road checks using configured MySQL. Read each script before running against a shared environment: site-support uses connection-local temporary tables; Trophy Road creates a temporary account inside a rolled-back transaction. These checks require an existing compatible schema.

`node scripts/db/verify-hardening-db.cjs` and `node scripts/db/verify-hardening-server.cjs` require permission to create/drop randomly named temporary databases. Build assets before the server verifier. The server verifier builds its disposable database from the bootstrap.

Database backups alone do not cover `data/maps`, uploaded assets or the match-result journal. See [deployment](deployment.md) and [Map Studio](../development/maps.md).
