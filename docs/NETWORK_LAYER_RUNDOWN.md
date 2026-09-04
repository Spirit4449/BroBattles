# Network Layer Rundown (AI Briefing)

Use this document as high-context input when asking an AI to change multiplayer networking, socket events, game loop timing, or interpolation behavior in Bro Battles.

## 1) Architecture in one pass

This game uses a hybrid real-time model over Socket.IO: human movement is
client-controlled, while combat validation, match state, and bots run server-side.

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
  - Sends game:input (volatile with reliable keyframes and pre-attack flushes, compress false).
  - Sends game:input-intent (non-volatile, compress false).
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
- Human position reports are validated; bots, combat, timers, and powerups advance server-side.
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

## 9) Snapshot timing and controlled comparisons (2026-09-04)

Human movement remains client-controlled. Local physics, reliable pre-attack
movement flushes, periodic reliable input keyframes, and combat authority are
unchanged. Bots continue to run every fixed simulation step on the server.

Every `game:snapshot`, including immediate respawn/action snapshots, now carries:

- `snapshotEpoch`: unique room-instance identifier, stable until that room is replaced.
- `snapshotSeq`: increasing emission sequence, independent of `tickId`.
- `tMono`: the latest simulation instant (or monotonic time before the loop starts).
- `sentMono`: actual server monotonic publication time, separate from simulation time.
- `snapshotKind`: `periodic` or `event`.
- Existing `tickId`, `timestamp`, and `sentAtWallMs` timing fields.

New clients reject duplicate/stale emission sequences before applying roster or
HUD changes. Newer emissions at the same simulation instant replace that buffered
instant without synthesizing an extra frame interval. Reconnect and room-instance
changes reset interpolation history; timestamp-only legacy bootstrap frames are
cleared when monotonic timing first becomes available. Clients still accept older
servers without the additive sequence fields. Deploy/reload both ends to benefit
from the new handling; older clients ignore new metadata and retain their original
same-time fallback behavior.

The server coalesces periodic snapshots and world-state publications within each
catch-up callback. It preserves every simulation step and discrete event, and
still emits immediate action/respawn snapshots in order. Normal cadence stays
60 Hz simulation / 30 Hz player snapshots / 7.5 Hz world state. For a comparison,
start the server with `BB_COALESCE_SNAPSHOTS=0`; this affects newly created rooms.
Snapshot delivery remains non-volatile.

Client measurements are always available from the browser console:

```js
window.__BB_NETWORK_DIAGNOSTICS__()
```

`arrivalJitterEma` measures the variation between consecutive arrival intervals
and actual server publication intervals. `arrivalGapMs` and `sourceGapMs` show the
latest such intervals separately, so a server pause is not mislabeled as network
jitter. Only periodic snapshots feed cadence/jitter estimates. `underrunFrames`,
`renderedFrames`, and `maxExtrapolationMs` describe the base render timeline and
reset on reconnect. They do not measure end-to-end input latency or per-player
visual hit alignment. Browser main-thread stalls can also delay arrival handlers.

Continuous remote smoothing is now the default. It replaces the alpha floors
and reverse-target filter with a continuous sampling timeline. Attack and airborne
lead are 12 ms and 9 ms respectively, transitioned over 80 ms, approximating the
old floors' average lead at 30 Hz. Remote sprites follow small interpolated
movements without a deadband. Position recovery speed limits, spawn snapping,
and extrapolation caps remain. Buffer catch-up uses elapsed time and smoothly
corrects excess lag, rather than applying a fixed correction per rendered frame.

For a visual comparison, add `netSmoothing=legacy` to the game URL to restore the
old alpha floors, reverse-target filter, and movement deadbands. This does not
roll back the shared buffer timing fixes. `netSmoothing=continuous` remains valid;
a plain URL also enables continuous smoothing. Parameters affect only that
browser and are not persistent account preferences.

Arrival-based adaptive delay remains opt-in: add `netArrivalDelay=1` to base it
on nominal cadence plus measured arrival jitter. The existing 45–115 ms bounds
remain in force. Compare this separately from smoothing.

Run `npm run test:network` for timing/sequence/epoch, jitter, continuous sampling,
catch-up publication, and terminal-loop regression tests. Tests also exercise
sprite motion and clock recovery at 60, 120, 144, and 240 Hz. These deterministic
tests do not establish real browser frame pacing or perceptual smoothness.
Compare two real clients under steady latency, variable latency, 250 ms and 1 s
stalls, and reconnects. Exercise running attacks, wall jumps, reversals, knockback,
death/respawn, and Bank Bust. Record underrun ratio, frame pacing, and visible hit
alignment; less extrapolation alone is not evidence of a better experience if
the extra delay makes hits look worse. Local-player blur reported in Chrome/Edge
has not been reproduced; this change does not alter local physics or rendering.
