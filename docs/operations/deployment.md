# Deployment and recovery

This guide covers the current single-process server, persistent state, recovery, and verification.

## Deploying

1. Stop the previous game server, including older versions that do not take the
   runtime lock. Drain ongoing games before stopping if their outcomes matter.
2. Back up the database and apply the existing migrations documented in
   [database setup](database.md), including the battle-log and shop migrations. Then run
   `node scripts/db/apply-migration.cjs hardening`. It reads `.env`, checks required
   InnoDB tables, applies the battle-log and hardening migrations idempotently,
   and verifies the new tables.
3. Set `NODE_ENV=production`, a persistent `COOKIE_SECRET`, and
   `SECURE_COOKIES=true` for HTTPS. `.env.example` uses HTTP development settings;
   override them in production. Configure `TRUST_PROXY` with the actual proxy
   addresses/CIDRs only. With it unset, forwarded IP headers are ignored.
4. Keep `MATCH_RESULT_DIR` on persistent storage writable only by the game
   process. Its default is `data/match-results`. Preserve that directory across
   releases and when moving the server to another host.
5. Run `npm run build`, then `npm start`. Deploy matching client and server
   versions: the client now handles the server's `game:correction` message.

Legacy signed numeric identity cookies are not accepted by the current session system.
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
must be retained for duplicate protection. Use sandbox events when verifying this integration.

## Shared Raspberry Pi

Production shares a 4-core Raspberry Pi with other services. `scripts/ops/pi-cpu-reserve.sh` keeps one core for the game: it confines every other pm2 app (with its child processes, at niceness 10), Docker containers, MariaDB, the desktop session and the Pi's other system services to cores 0–2 with a lower CPU weight, and leaves the game, nginx and tailscaled on every core. MariaDB keeps normal priority because the game queries it. It is idempotent and runs as root every minute from `/etc/cron.d/pi-cpu-reserve`, which catches pm2 apps restarted since the last run:

```
* * * * * root nice -n 19 taskset -c 0-2 /home/nisch/Desktop/Game/scripts/ops/pi-cpu-reserve.sh >/dev/null 2>&1
```

The game inherits pm2's systemd unit, so restart pm2 with `sudo systemctl restart pm2-nisch` rather than from a login shell (which would put it in the confined user session); the script logs a warning to the journal if that happens. `pm2-logrotate` caps pm2 logs at 20 MB with five compressed copies.

## Limits and validation

Production JavaScript minification runs serially to reduce peak memory on the
4 GB Raspberry Pi alongside its other services. Use `npm run build -- --progress`
to see compilation stages; minification can take several minutes. Leave memory
headroom before building and check `free -h` and `swapon --show` if the host stops
responding. Swap provides a fallback but does not replace available RAM.

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

Production builds omit source maps and preserve `dist` to avoid rewriting unchanged assets. Use `npm run cleanbuild` before a build when a full artifact cleanup is needed. HTTP responses use compression for compressible content above 1 KiB; event streams are excluded, and movement Socket.IO messages remain uncompressed. Keep only generated build artifacts in `dist`. `npm run sourcemap` remains an
explicit debugging build; do not publish its map files in public production
assets. Webpack still reports large-bundle warnings; asset splitting is a
separate performance improvement.

## Verification

```sh
npm run test:all
node scripts/db/verify-hardening-db.cjs
npm run build
node scripts/db/verify-hardening-server.cjs
```

The two integration scripts require local MySQL credentials in `.env` and
permission to create/drop their own randomly named temporary databases. They
never modify game accounts or balances. The server verifier uses an empty copy
of the configured schema and binds a temporary local port; build assets first.


## Persistent files and deployment payload

Deploy `src/`, `content/`, generated `dist/`, package metadata and installed production dependencies. Keep `.env` and the cookie secret private. Map editing also needs writable `public/assets/` and its production copy; preserve uploaded revisions, `data/maps/` (or `BB_MAP_DIR`) and production map snapshots. Preserve `runtime-overrides.json` if you use admin configuration. Do not replace these runtime stores with an empty release directory.

## Security regression workflow

Use executable tests instead of historical pasted console flood/spoof scripts:

```sh
node --test tests/productionHardening.test.js tests/cosmeticRoutes.test.js tests/shopCommerce.test.js tests/emailRoutes.test.js tests/signupVerification.test.js
npm run test:network
```

In an isolated test environment, verify unauthenticated and guest restrictions, cross-account support/ownership access, admin guards, same-origin write checks, duplicate purchase/claim delivery, session revocation, forged combat claims, and movement corrections. Use controlled test accounts and bounded requests. Do not interpret client-side UI restrictions as authorization. Socket identity comes from authenticated sessions and service mutations remain server-owned.

For release QA, check two browsers through join, ready, countdown, combat, reconnect, results and lobby return; test Bank Bust respawns, bots, map edits, chat and sound. Report the actual test result and environment for each release instead of carrying forward a past passing count.

## Automatic build versions

Webpack stamps `dist/build-version.json` with the release name, Git commit count,
full commit SHA, build time, and whether the checkout has uncommitted changes.
Every build requires Git and full history (`git fetch --unshallow` for shallow
clones). Build from a clean committed checkout for production. Counts advance
along branch history; merges and rebases can change the count, so the SHA is the
exact identity. Rebuilding a commit keeps its number and changes its build time.

Deploy the generated manifest with the rest of `dist/` and the matching server
source, then restart the server. The server snapshots the manifest at startup;
production does not derive its version from the live checkout. `GET /api/version`
is public and uncached by browsers. The site menu shows the deployed build and
checks whether its SHA equals the latest GitHub deployment-branch commit. It
refreshes on menu opening; remote checks are shared and cached for 60 seconds.
“Up to date” means exact equality with the last successful check, not that a
browser's already-loaded JavaScript is the newest bundle.

Defaults are repository `Spirit4449/APCSP-Create-Project---Final` and branch
`main`. Override with `BB_VERSION_REPOSITORY=owner/repo` and `BB_DEPLOY_BRANCH`.
For a private repository set server-only `BB_VERSION_GITHUB_TOKEN` to a token
with read access to repository contents. Never place it in client configuration.
Unreachable GitHub, missing metadata, and access/rate-limit errors show “Unable
to check”. A dirty build shows “Uncommitted changes”; local servers show
“Development”. No commits, pushes, or deployments happen automatically.
