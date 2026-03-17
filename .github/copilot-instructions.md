# AI agent guide for this repository

This project is a browser game built with Phaser (client) and Express + Socket.IO (server), bundled by Webpack. The server owns matchmaking, party management, and a server-authoritative game loop that broadcasts snapshots for client interpolation.

## Build and test commands

- Install deps: `npm install`
- Dev server: `npm run dev` (Express + webpack middleware, defaults to `PORT=3002`)
- Production build: `npm run build`
- Production start: `npm start`
- Debug production bundle with maps: `npm run sourcemap`
- Automated tests: none configured right now (do not assume a test runner exists)

## Environment and runtime

- Env: `NODE_ENV`, `PORT`, `SECURE_COOKIES` (false by default for HTTP dev), `COOKIE_SECRET` (persisted to `.cookie-secret` if missing), `ADMIN_USERS`.
- Webpack copies `public/**` to `dist/**`; bundles to `dist/bundles/*.bundle.js`.
- MySQL is required for gameplay/auth flows; default DB name is `game`.

## Architecture

- Client: `src/*.js` with entry points in `webpack.config.js` (`index`, `party`, `game`, etc.). Assets live under `public/assets/**`. In dev, static is served from `public/`; in prod from `dist/`.
- Server: `src/server/**`
  - Core: `core/socket.js` (Socket.IO wiring, presence, matchmaking controls), `core/matchmaking.js` (tickets → matches, ready-check), `core/gameHub.js` and `core/gameRoom.js` (live rooms, snapshots, health/combat), `core/sql.js` (MySQL helpers/transactions).
  - Routes: `routes/routes.js` (pages, party, auth, gamedata), `routes/economy.js` (upgrade/buy with JSON column ops).
  - Helpers: `helpers/auth.js` (signed cookie users + guest creation), `helpers/party.js`, `helpers/constants.js`.
  - DB schema details: `database.md`.

## Core conventions

- Data/auth:
- MySQL (`mysql2/promise`) connection is in `src/server/core/sql.js`.
- Signed cookies via cookie-parser: `user_id` (signed) + `display_name` (plain).
- Guests are auto-created on first `/status` or `/` (see `helpers/auth.js`).
- Party membership is authoritative in DB; user presence is tracked and broadcast from sockets.

- Socket event naming:
- Use scoped names (`feature:verb` or existing established names).
- Preserve existing event names and payload shapes unless explicitly approved.

- State transitions:
- Party status enum is centralized in `helpers/constants.js` (`idle`, `queued`, `ready_check`, `live`).
- Matchmaking/party code must keep status transitions consistent.

## Sockets and event contracts

- Naming style: namespace with colons.

- Presence/rooms: users auto-join `party:{id}` or `lobby`. Heartbeat every 10s: `socket.emit("heartbeat", partyId)`. Pre-unload hint: `client:bye`.
- Party: server emits `party:joined`, `party:members`, `status:update`. Client may emit `ready:status`, `mode-change`, `map-change`, `char-change`. When all ready: `party:matchmaking:start` and live `match:progress` updates.
- Matchmaking: client emits `queue:join` / `queue:leave` (solo); server emits `match:found` (client replies `ready:ack`), `match:gameReady`, and `match:cancelled`.
- Game room: client emits `game:join` with `{ matchId }`, then streams `game:input` (~20ms throttle with `socket.volatile.compress(false)`), and `game:action`/`hit`/`heal` as needed. Server emits `game:init`, `game:start`, regular `game:snapshot` (~20Hz with `tickId`/`tMono`), `health-update`, `player:dead`, `game:over`.

## Client patterns to follow

- Always POST `/status` first to create/identify the user, then call `ensureSocketConnected()` from `src/socket.js` before relying on socket events.
- Lobby/party UI lives in `src/index.js` + `src/party.js`; keep DOM IDs/classes stable (`.character-slot`, `#matchmaking-overlay`, etc.). Use `renderPartyMembers()` and `initializeModeDropdown()` to keep UI and DB in sync.
- Game flow: `src/game.js` fetches `/gamedata` then joins via `game:join`. Interpolate positions using the server’s `game:snapshot` and `tMono` timeline; do not snap remote sprites to network origins.

## Server patterns to follow

- Update DB first, then broadcast with helpers (e.g., `emitRoster(io, partyId, party, members)`); use capacity helpers from `helpers/utils.js`.
- Party status enum is centralized in `helpers/constants.js` (`idle`, `queued`, `ready_check`, `live`). Matchmaking updates party and match statuses consistently.
- When adding a new socket feature: authorize from `socket.data.user`, prefer party/lobby rooms (`party:{id}`), and keep event names scoped (`feature:verb`).
- Register critical socket handlers synchronously in connection flow before async work, so early client emits are not dropped.

## Gotchas and examples

- Mode/team sizes: team size S derives from “mode” (1→1v1, 2→2v2, 3→3v3). UI must prevent selecting a mode smaller than current members (`/party-members` check).
- Character changes: emit `char-change` with `{ partyId, charClass }`; server validates, updates `users.char_class`, then re-emits roster.
- Redirects: `/game/:matchid` serves `game.html`; client reads matchId from path. If `/status` reports `live_match_id`, redirect to the live game.
- Keep powerup config identifiers aligned between client and server implementations to avoid desync.

Keep edits aligned with these contracts and file locations; when changing a public event or route, update both server emit/handlers and the corresponding client listeners.

## Rules

- Follow existing patterns. Match file layout, naming (feature:verb for events), logging tone, and helper usage already in the repo.

- Be surgical, not destructive. Prefer minimal diffs; avoid refactors, renames, or dependency changes unless explicitly asked.

- Preserve public contracts. Do not change event names, routes, payload shapes, DOM IDs/classes, or DB schema without clear, explicit approval.

- Suggest → then patch. When confidence < 80%, propose diagnostics or a small experiment first (extra logs, a guarded code path), not a sweeping change.

- No build/tooling churn (webpack, eslint, tsconfig) unless the task is tooling itself.
