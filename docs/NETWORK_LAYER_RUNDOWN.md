# Network Layer Rundown (AI Briefing)

Use this document as high-context input when asking an AI to change multiplayer networking, socket events, game loop timing, or interpolation behavior in Bro Battles.

## 1) Architecture in one pass

This game uses a server-authoritative real-time model over Socket.IO:

- Server owns match lifecycle, room membership, tick progression, combat validation, health, deaths, and snapshots.
- Client sends intent/state updates and renders local + remote entities.
- Server broadcasts authoritative snapshots and event packets to room game:{matchId}.
- Client smooths remote state using buffered interpolation based on server monotonic timestamps.

Primary authority boundaries:

- Authoritative: server game room state in src/server/core/gameRoom.js and helpers.
- Predictive/visual: client interpolation and VFX timing in src/match/snapshotBuffer.js, src/gameScene/networkInterpolation.js, src/match/matchCoordinator.js.

## 2) Main files and responsibilities

Server core:

- src/server/core/socket.js
  - Initializes Socket.IO.
  - Auth middleware from signed cookie user_id.
  - Registers event modules early (important: game handlers are attached before awaited work to avoid dropped early emits).
  - Connects matchmaking, party services, and game hub.
- src/server/core/socketEvents/gameEvents.js
  - Handles game:join request.
  - Validates auth + matchId.
  - Ensures room exists for live match, then forwards join to game hub.
- src/server/core/gameHub.js
  - Tracks active rooms by matchId.
  - Creates/removes room instances.
  - Routes add/remove player calls.
- src/server/core/gameRoom.js
  - Main match runtime.
  - Player socket handlers per room (game:input, game:input-intent, game:action, game:special, hit, heal, game:ready).
  - Fixed-step loop at 60 Hz and snapshot cadence.
  - Delegates to managers for timer, room state, health, powerups, lifecycle.
- src/server/core/gameRoom/roomStateManager.js
  - Emits game:init and game:snapshot payloads.
- src/server/core/gameRoom/timerManager.js
  - Emits game:timer and game:sudden-death:start.
  - Handles sudden death poison and end-of-match tiebreak logic.
- src/server/core/gameRoom/healthManager.js
  - Emits health-update and death-related updates.

Client core:

- src/socket.js
  - Singleton socket client.
  - Manual connect via ensureSocketConnected().
- src/match/matchCoordinator.js
  - Central listener registry for live match events.
  - Emits game:join and game:ready.
  - Consumes game:init, game:start, game:starting, game:snapshot, health/death/timer/over, etc.
  - Maintains live replicated state slices and updates HUD pipelines.
- src/gameScene/localInputSync.js
  - Sends game:input (volatile, compress false).
  - Sends game:input-intent (volatile, compress false).
  - Throttled movement publish path.
- src/match/snapshotBuffer.js
  - Snapshot buffering, monotonic time calibration, interpolation frame selection.
- src/players/localSocketEvents.js
  - Local-player-specific health/death/special/knockback/respawn reactions.
- src/game.js
  - Sends one-time game:ready once scene exists and local state can be acknowledged.

## 3) End-to-end live match flow

1. Socket connection and auth
- Client connects using src/socket.js.
- Server reads signed cookie in src/server/core/socket.js and stores socket.data.user.

2. Join attempt
- Client emits game:join from src/match/matchCoordinator.js.
- Server validates in src/server/core/socketEvents/gameEvents.js.
- gameHub handles addPlayer, room join, and initial state send.

3. Initial sync
- Server emits game:init from roomStateManager with roster, team, map/mode, spawnVersion, loaded/connected flags, initial powerups, modeState, deathDrops, playerEffects.
- Client merges init data into its roster in matchCoordinator and initializes remote players.

4. Starting phase and readiness
- Room enters starting phase.
- Server expects game:ready ack from required participants (tracked by user_id, robust to reconnect).
- Start is finalized either by all acks or timeout.

5. Active simulation and broadcast
- Server fixed-step loop runs at 60 Hz.
- Movement/actions/combat/timer/powerups resolved server-side.
- Snapshot emission occurs on cadence (every N ticks; currently 30 Hz with SNAPSHOT_EVERY_TICKS=2 at 60 Hz loop).
- Snapshots include timing metadata tickId and tMono.

6. Client interpolation and render
- Client ingests snapshots into snapshotBuffer.
- Remote actors are rendered using interpolation between buffered states.
- HUD/mode state/powerups/deathdrops/effects are synchronized from snapshots and discrete events.

7. Match end
- Server emits game:over and terminal events.
- Client disables gameplay input and shows end UI.

## 4) Event contract map (important)

Client to server:

- game:join
  - Purpose: request entry to match room.
  - Typical payload: { matchId }.
  - Ack path supported in gameEvents.
- game:ready
  - Purpose: client scene loaded and local state ready.
  - Typical payload: { matchId, x, y, flip, animation }.
- game:input
  - Purpose: latest local positional state.
  - Sent volatile + compress(false) for low latency.
- game:input-intent
  - Purpose: movement intent diagnostic/server-sim path.
  - Includes sequence and directional intent.
- game:action
  - Purpose: attack or gameplay action trigger.
- game:special
  - Purpose: request special when charged.
- hit
  - Purpose: owner-side hit proposal; server validates authoritatively.
- heal
  - Purpose: heal proposal; server clamps/validates.
- deathdrop:pickup
  - Purpose: pickup request for death drop object.

Server to client:

- game:joined
  - Join confirmation.
- game:init
  - Initial authoritative room state.
- game:starting
  - Starting handshake phase active.
- game:start
  - Countdown/start signal.
- game:snapshot
  - Repeated world snapshot with player states and timing fields.
- game:action
  - Replicated action event for remote visuals.
- health-update
  - Authoritative health changes.
- super-update
  - Authoritative super charge updates.
- player:special
  - Special activation broadcast.
- player:dead, player:respawn
  - Lifecycle state transitions.
- game:timer
  - Remaining time, sudden-death, poison line.
- game:sudden-death:start
  - Sudden death start marker.
- game:over
  - Terminal result payload.
- player:disconnected, player:reconnected
  - Presence in match room.
- powerup:collected, powerup:tick, deathdrop:collected
  - Timed item/effect lifecycle events.

## 5) Timing model and smoothing details

Server timing:

- Fixed simulation step: 60 Hz in GameRoom loop.
- Snapshot cadence: every 2 ticks by default, so about 30 Hz snapshots.
- Snapshot timing payload includes:
  - tickId: server tick counter.
  - tMono: server monotonic clock sample.
  - sentAtWallMs: wall clock send time.

Client timing:

- snapshotBuffer calibrates server tMono offset once snapshots arrive.
- Maintains interpolation delay window and can adapt delay based on observed spacing/jitter.
- Selects interpolation frame pair (aState, bState, alpha) and allows bounded extrapolation when needed.

Design intent:

- Keep transport low-latency for frequently changing movement packets.
- Keep server as source of truth for anti-cheat and consistency.
- Keep client visually smooth under variable network conditions.

## 6) Reliability and reconnection behavior

- Socket handlers for game events are registered early during connection to avoid missed early events.
- Reconnection path updates player socket association in room while preserving user identity.
- Readiness tracking is keyed by user_id, not socket id, so reconnects do not break start handshake.
- Client matchCoordinator has a watchdog that retries join/ready during start if events are missed.

## 7) How to safely modify this network layer

Rules for low-regression changes:

- Preserve event names and payload shape unless all emitters/listeners are updated together.
- If adding new snapshot fields, keep them additive and optional.
- If changing server tick/snapshot cadence, also revisit client interpolation delay defaults.
- Keep input emit path lightweight (volatile, no heavy per-message transforms).
- Maintain server authority for hit validation, health, death, and win conditions.
- Update both server and client listeners in one change set when introducing a new live event.

Recommended verification checklist after changes:

- Fresh match start with all players present.
- Late join to live match.
- Disconnect/reconnect during waiting, starting, and active states.
- Ability/action replication for all classes.
- Snapshot smoothness under packet jitter.
- Sudden death transition and timer correctness.
- End-of-match game:over and cleanup path.

## 8) AI prompt block you can paste directly

You are editing Bro Battles real-time multiplayer networking. Treat the server as authoritative. Use these source-of-truth files:

- Server socket wiring: src/server/core/socket.js
- Join gateway: src/server/core/socketEvents/gameEvents.js
- Room hub: src/server/core/gameHub.js
- Match runtime: src/server/core/gameRoom.js
- Snapshot payloads: src/server/core/gameRoom/roomStateManager.js
- Timer and sudden death: src/server/core/gameRoom/timerManager.js
- Client coordinator/listeners: src/match/matchCoordinator.js
- Client input emit path: src/gameScene/localInputSync.js
- Snapshot buffering/interp: src/match/snapshotBuffer.js
- Local player event reactions: src/players/localSocketEvents.js

Constraints:
- Do not rename existing socket events.
- Keep payload changes backward-compatible (additive).
- Keep server-authoritative combat and health logic.
- If you add a new event, implement both emit and listener paths in the same patch.
- If cadence/timing changes, retune interpolation defaults and document expected behavior.

Deliverables:
- Exact file diffs.
- Event contract changes summarized.
- Risk notes for desync/regression.
- Manual verification steps for join/start/active/reconnect/end.
