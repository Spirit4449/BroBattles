# Production hardening

The September 10 review fixes cover movement validation, collision geometry,
HTTP abuse controls, sessions, payment event retries, match settlement, runtime
ownership, bounded presence/database work, and production source maps. Review
item 3 (admin identity rules) is intentionally unchanged.

## Deploying

1. Stop the previous game server, including older versions that do not take the
   runtime lock. Drain ongoing games before stopping if their outcomes matter.
2. Back up the database and apply the existing migrations documented in
   `database.md`, including the battle-log and shop migrations. Then run
   `node scripts/apply-hardening-migration.cjs`. It reads `.env`, checks required
   InnoDB tables, applies the battle-log and hardening migrations idempotently,
   and verifies the new tables. The hardening migration has been applied to the
   configured local database during this review; other environments still need it.
3. Set `NODE_ENV=production`, a persistent `COOKIE_SECRET`, and
   `SECURE_COOKIES=true` for HTTPS. `.env.example` uses HTTP development settings;
   override them in production. Configure `TRUST_PROXY` with the actual proxy
   addresses/CIDRs only. With it unset, forwarded IP headers are ignored.
4. Keep `MATCH_RESULT_DIR` on persistent storage writable only by the game
   process. Its default is `data/match-results`. Preserve that directory across
   releases and when moving the server to another host.
5. Run `npm run build`, then `npm start`. Deploy matching client and server
   versions: the client now handles the server's `game:correction` message.

Existing signed numeric identity cookies are invalidated by this release.
Registered users must log in again; anonymous visitors receive a new guest.
The `user_id` cookie now contains a random session token; MySQL stores only its
SHA-256 hash. Sessions expire after 20 days or the guest's earlier expiration.
Logout revokes the current token and its sockets. Password changes revoke all
sessions and sockets for that account before issuing a replacement session.

## Runtime and recovery

Run **one game process per database**, connected to the same MySQL primary.
A dedicated connection holds a MySQL advisory lock for the process lifetime.
A second process fails startup, and ownership loss terminates the owner.
This prevents accidental duplicate simulations with the current routing model;
it is not horizontal sharding or a distributed failover protocol. Scaling to
multiple active processes still requires match ownership, routed socket events,
and fencing of all state mutations.

Completed outcomes are written and synced to the local result journal before
settlement. Wallet changes, battle history, match completion, party state, and
the unique match reward receipt commit in one database transaction. A failed
settlement remains pending, is shown as pending to the client, and retries every
30 seconds. Restart reads the journal before cleaning up stale live matches.
Matches with pending results cannot start another simulation. Cleanup also
leaves running rooms alone. Do not delete result files or receipts to retry a
payment: receipts make retries idempotent.

An interrupted active simulation has no recoverable final outcome. Startup
cancels its stale live database record and resets its parties; it does not
reconstruct a new game from the initial roster. If the process dies before an
outcome is synced, or its journal volume is lost, that outcome cannot be recovered.
Monitor `[rewards]` errors and old journal files, especially during disk or DB
outages. Persistent failed outcomes require investigating the underlying data
or storage problem, not marking them completed manually.

Stripe signatures are checked before events enter `shop_webhook_inbox`.
Refund/dispute events arriving before an order is fulfilled remain retryable
instead of being acknowledged as completed. The durable inbox retries up to
25 due events per minute; failed events remain available across restarts.
Monitor old inbox rows and `[shop:stripe] reconciliation pending` messages.
Unmatched payment intents need investigation. Existing processed event receipts
must be retained for duplicate protection. No real Stripe payment was issued
or refunded during verification.

## Limits and validation

Movement uses a server-time distance budget for every packet interval, including
bursts and long gaps. Spawn positions, standing/ducking body dimensions, offsets,
and grounded checks come from shared game geometry. Server knockback gets a
bounded allowance. This remains client-simulated movement with server bounds;
it does not validate every path against walls or replace physics with a fully
server-simulated movement system.

HTTP route aliases share rate limits, forwarded headers require explicit proxy
trust, and authentication/guard failures return 503. Request windows have bounded
identity and event counts. Presence evicts inactive entries, indexes match
members, coalesces updates, and batches database writes. Pool defaults are 10
connections, 100 queued requests, 5 seconds to acquire a connection, and 10
seconds per query. Tune the corresponding `DB_*` variables from `.env.example`
based on measured load. Timed-out connections are discarded; callers may retry
only operations whose duplicate behavior is safe.

Normal production builds clean `dist` to remove stale debug bundles and omit
source maps. Keep only generated build artifacts in `dist`. `npm run sourcemap` remains an
explicit debugging build; do not publish its map files in public production
assets. Webpack still reports large-bundle warnings; asset splitting is a
separate performance improvement.

## Verification

```sh
node --test tests/*.test.js tests/*.test.mjs
node scripts/verify-hardening-db.cjs
npm run build
node scripts/verify-hardening-server.cjs
```

The two integration scripts require local MySQL credentials in `.env` and
permission to create/drop their own randomly named temporary databases. They
never modify game accounts or balances. The server verifier uses an empty copy
of the configured schema and binds a temporary local port; build assets first.

At completion of the review, the full suite passed 498/499 tests, including all
24 new hardening tests. The remaining pre-existing failure is
`thorg at zero trophies executes every map 1 destination safely` (`p4`) in
`tests/botCoherence.test.js`. Bot fixtures now pin checked-in maps so local editor
saves do not affect navigation assertions. Database integration, production
server smoke, and production build passed. Browser gameplay and load testing
have not been performed for this change.
