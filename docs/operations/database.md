# Database setup and migrations

The server uses `mysql2/promise` through `src/server/core/sql.js`. Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, and the pool/timeout settings in `.env.example`.

## Base schema prerequisite

The SQL files in `migrations/` upgrade an existing game database. They do not create the original `users`, `parties`, `party_members`, `matches`, `match_participants`, or `match_tickets` tables. The repository also lacks a standalone player-card migration for `users.selected_card_id` and `user_cards`. An empty `CREATE DATABASE game` followed by these migrations is not a working bootstrap.

Obtain a sanitized schema export from the maintainer containing those prerequisites. Do not use production account data or commit database dumps. Required transaction tables must use InnoDB. Confirm SQL compatibility with the target MySQL version; some older SQL uses `ADD COLUMN IF NOT EXISTS`, which is not portable to all MySQL versions. Use explicit existence checks where needed, following `scripts/db/db.cjs` and the conditional SQL migrations.

Player-card ownership requires `user_cards` with `user_id`, `card_id`, `acquired_at`, `source`, a composite primary key `(user_id, card_id)`, and an account foreign key with cascade deletion. Equipped selection is `users.selected_card_id`. Catalog metadata and authoritative Shop prices stay in source, not those tables. The earlier `DESCRIBE` transcript was an incomplete historical schema and has been removed.

## Upgrade an existing database

Back up first, drain matches and stop older workers when applying migrations that alter queue or reward data. Inspect status and available helpers:

```sh
npm run migrate:status
npm run migrate:apply -- --list
```

Status is read-only. It infers tables, columns and indexes from migration SQL; it does **not** prove that backfills, helper-only changes, base schema, column types or constraints are correct. There is no migration ledger or universal apply-all command.

Apply older SQL in chronological order after checking existing schema. Do not blindly rerun non-idempotent `ALTER TABLE` or index statements. For migrations covered by the helper, use the named step so conditional DDL, verification and service backfills run:

| Step (`npm run migrate:apply -- <step>`) | Prerequisites and effect |
| --- | --- |
| `hardening` | Existing InnoDB base and Shop tables; applies battle-log fields, session hashes, reward receipts and webhook inbox |
| `site` | Base schema; creates legal acceptance and support tables |
| `email` | Site support; creates account email verification and notification outbox |
| `signup-marketing` | Email setup; creates pending signups, preferences, jobs and provider sync records |
| `email-polish` | Both `email` and `signup-marketing`; adds `correction_used` to verification records (helper-only DDL) |
| `party-slots` | Party members; adds explicit slot index |
| `trophy-road` | Trophy claims and cosmetic ownership tables; adds trophy peak, migrates claims and backfills non-currency grants |
| `shop-views` | Users; creates account-saved viewed Shop offers and rotation acknowledgments |
| `highest-win-streak` | Users and completed battle history; adds `users.highest_win_streak` and backfills historical records without lowering saved peaks |
| `friends` | Users and matches; adds friend codes, social tables and the matches-created index |
| `name-changes` | Users; adds nullable `users.next_name_change_at` for the paid monthly rename cooldown |
| `friend-last-seen` | Users; adds nullable `users.last_seen_at` for persistent friend activity history |

The helper's list order is not a dependency order: run `signup-marketing` before `email-polish`. Trophy Road's non-currency backfill calls application services; running its SQL alone is insufficient. Friends also adds columns/indexes outside its SQL file. Verify each environment independently; this documentation makes no claim about its applied state.

## Schema ownership

Use the actual SQL in [migrations](../../migrations/) for definitions rather than copying DDL into docs.

| Domain | Stored state / defining migration |
| --- | --- |
| Match selection | `mode_id`, `mode_variant_id` on parties, matches and tickets; `2026-03-25_game_mode_registry_scaffold.sql` |
| Trophy claims | Unique `(user_id, tier_id)` receipts; `2026-04-06_trophy_reward_claims.sql`, `2026-09-15_trophy_road.sql` plus helper |
| Parties | Visibility/name, member selection permissions and slots; April discovery and September member-selection/slot migrations |
| Party chat | Messages, replies, reactions and reads; `2026-04-11_party_chat.sql` |
| Join requests | Per-party/account request state; `2026-04-14_party_join_requests.sql` |
| Cosmetics | Profile icons and skins in their April migrations; cards are a base-schema prerequisite |
| Moderation | Offense/suspension/ban fields and abuse events; `2026-04-15_abuse_controls.sql` |
| Shop | Rotation, redemptions, orders, webhook receipts and ledger; `2026-08-31_shop_commerce.sql` |
| Bots | Temporary `match_bot_participants`; `2026-09-03_adaptive_bots.sql` also backfills queue trophy ratings |
| Battle history | Winner, summary, participant stats/rewards; `2026-09-03_match_battle_log.sql` |
| Sessions and recovery | `auth_sessions`, `match_reward_commits`, `shop_webhook_inbox`; `2026-09-10_production_hardening.sql` |
| Site support | `legal_acceptances`, `site_requests`, `site_request_messages`; `2026-09-12_site_support.sql` |
| Email and marketing | `account_emails`, `email_outbox`, `pending_signups`, `email_marketing`, `marketing_jobs`, `marketing_contact_sync`, `email_webhook_events`; September 13 migrations |
| Friends | `friend_requests`, `friendships`, `friend_messages`, `friend_message_reactions`; `2026-10-02_friends.sql` plus helper |

Friend data is keyed by account ID, not username. The generated pending-pair key prevents concurrent pending requests for the same pair. Friendships store both directions; generated conversation pair columns support direct-message lookups. Guests cannot use friends.

## Verification and persistence

`npm run test:db` runs the site-support integration, email verification and Trophy Road checks using configured MySQL. Read each script before running against a shared environment: site-support uses connection-local temporary tables; Trophy Road creates a temporary account inside a rolled-back transaction. These checks require an existing compatible schema.

`node scripts/db/verify-hardening-db.cjs` and `node scripts/db/verify-hardening-server.cjs` require permission to create/drop randomly named temporary databases. Build assets before the server verifier. They exercise isolated schema copies, not live account balances.

Database backups alone do not cover `data/maps`, uploaded assets or the match-result journal. See [deployment](deployment.md) and [Map Studio](../development/maps.md).

Apply `highest-win-streak` before running the server code that stores profile
records. The helper scans completed history once per account; reruns preserve
higher stored records and safely resume a partially completed backfill.
