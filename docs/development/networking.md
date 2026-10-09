# Networking

Human movement is client-simulated with server bounds and dash collision checks. The server owns combat validation, health, bots, room membership, match state and rewards. Clients predict presentation and interpolate remote actors. See [gameplay](gameplay.md) for dash/bots and [client lifecycle](client.md) for screen teardown.

## Ownership

| Component | Source |
| --- | --- |
| Socket authentication and early handler registration | `src/server/core/socket.js` |
| Join validation and room lookup | `src/server/core/socketEvents/gameEvents.js`, `src/server/core/gameHub.js` |
| Fixed-step simulation and publication | `src/server/core/gameRoom/index.js` |
| Player transport and action validation | `src/server/core/gameRoom/playerTransport.js`, `src/server/core/gameRoom/actionValidation.js` |
| Initial state, spawns and snapshots | `src/server/core/gameRoom/roomStateManager.js` |
| Damage, hit timing and health | `src/server/core/gameRoom/damageResolver.js`, `src/server/core/gameRoom/healthManager.js` |
| Client socket lifecycle | `src/client/lib/socket.js` |
| Match listeners, state and join/readiness recovery | `src/client/game/match/matchCoordinator.js` |
| Input publication | `src/client/game/scene/localInputSync.js` |
| Shared client clock | `src/client/game/match/serverClock.js` |
| Snapshot buffering and render timeline | `src/client/game/match/snapshotBuffer.js` |
| Movement correction | `src/client/game/players/movementCorrection.js`, `src/client/game/players/localMovementCorrector.js` |
| Local lifecycle reactions | `src/client/game/players/localSocketEvents.js` |

The signed `user_id` cookie carries a session token. Socket authentication resolves the account through stored session hashes; client-supplied participant identity cannot authorize an action.

## Match lifecycle

1. The coordinator emits `game:join` with `matchId` and combat protocol versions. The gateway authenticates membership before joining `game:{matchId}`.
2. `game:init` provides roster, mode/map, server spawns, loaded/connected flags, effects, items and protocol bootstrap state. Clients merge roster data without inventing ownership.
3. Once the scene is built and the loading screen lifts, the client emits `game:ready` and begins the pregame. Readiness is keyed by account, not socket ID. The coordinator retries join/readiness only after local readiness.
4. `src/shared/matchIntroTiming.js` defines a five-second pregame, up to two seconds of grace for loading peers, a five-second countdown and a 45-second room-start deadline. `game:start` sends countdown duration and spawns. Rejoins receive remaining countdown state; live rejoins skip pregame. Controls and movement sync begin at FIGHT.
5. `src/shared/gameConstants.js` owns `SERVER_TICK_HZ`, `FIXED_DT_MS`, `SNAPSHOT_EVERY_TICKS` and `WORLD_STATE_EVERY_TICKS`: currently 60 Hz simulation, 30 Hz player snapshots and 7.5 Hz world state. The client snapshot interval and shared projectile steps derive from these constants. Human reports are bounded; bots advance in simulation steps.
6. Health, effects, objective state, timers and terminal events remain server-owned. `game:over` disables input and drives results. [Deployment](../operations/deployment.md) explains durable reward settlement and restart behavior.

## Transport contracts

| Direction | Event | Role |
| --- | --- | --- |
| Client → server | `game:join`, `game:ready` | Membership and scene readiness |
| Client → server | `game:input` | Sequenced positional state and controls; normally volatile with reliable keyframes and pre-attack flushes |
| Client → server | `game:clock` | Acknowledged clock exchange returning epoch/simulation/publication timing |
| Client → server | `game:action`, `game:special` | Validated action and charged-special requests |
| Client → server | `hit`, `heal`, `deathdrop:pickup` | Proposals checked by the server, never permission to assign outcomes |
| Server → client | `game:joined`, `game:init`, `game:start` | Join/bootstrap/countdown |
| Server → client | `game:snapshot`, `game:correction` | Replicated state and rejected-movement correction |
| Server → client | `game:action`, `player:special` | Accepted combat presentation and protocol packets |
| Server → client | `health-update`, `super-update` | Authoritative health/charge |
| Server → client | `player:dead`, `player:respawn`, `player:disconnected`, `player:reconnected`, `player:loaded` | Actor lifecycle |
| Server → client | `game:timer`, `game:sudden-death:start`, `game:over` | Match lifecycle |
| Server → client | `powerup:collected`, `powerup:tick`, `deathdrop:collected` | Item/effect events |

This table is an overview, not an exhaustive schema. Read emitters and listeners together when changing payloads. Keep compatible fields additive; update both endpoints and protocol gates when making incompatible changes. `game:input-intent` and the disabled server human-movement simulator have been removed. Socket.IO `connect` handles reconnects; the socket itself does not emit the Manager's `reconnect` event.

## Snapshots and clocks

Each snapshot carries room-instance `snapshotEpoch`, increasing `snapshotSeq`, simulation `tMono`, publication `sentMono`, `snapshotKind` (`periodic` or `event`), plus tick/wall-time fields. Clients reject stale/duplicate sequences before roster or HUD updates. New emissions at the same simulation instant replace that instant in the buffer; reconnects and epoch changes reset history. Compatibility handling accepts older payloads without sequence fields.

Catch-up callbacks coalesce periodic snapshots and world state while preserving every simulation step and discrete event. Snapshots remain non-volatile. `BB_COALESCE_SNAPSHOTS=0` disables coalescing for newly created rooms for controlled comparisons.

Per-player snapshot state is delta-encoded by `src/shared/snapshotDelta.js`. A keyframe (`keyframe: true`) carries every player's full state; other snapshots carry `baseSeq` plus only the fields that changed since the previous snapshot (removed fields listed in `_del`, departed players in `gone`), and unchanged players are omitted. The room sends a keyframe at least once per second and right after any `game:init`. The match coordinator decodes before buffering, so everything downstream sees full states; a client that missed a packet drops deltas until the next keyframe. Identity fields (`participantId`, `isBot`, team, skins) come only from `game:init`. World state sends only active effect timers (each player keeps an entry, possibly `{}`) and `playerEffectMovement` only for players with active effects.

Each room's timing diagnostics (`gameRoom/timingDiagnostics.js`) log loop stalls and snapshot gaps whenever they occur. Routine summaries every few seconds are printed only outside production; `BB_TIMING_DIAG=1` enables them in production and `BB_TIMING_DIAG=0` silences them in development.

`serverClock.js` owns the clock ping loop: a five-ping burst after epoch changes/reconnects, then one ping every two seconds. It uses the lowest RTT in a 12-sample window. Ninja, Huntress and hit reports share this clock; character adapters must not reset it independently.

Hit proposals use `attackServerMono`, which the damage resolver converts into the server's wall-clock position-history domain. Client wall-clock `attackTime` does not establish hit timing. Future claims beyond the server tolerance are rejected. Human history records accepted inputs; bot history records simulation steps. History is bounded by `POSITION_HISTORY_MS` / `POSITION_HISTORY_DEPTH` in `src/server/core/gameRoomConfig.js` (currently one second / 128 samples). The same owner defines the 300ms rewind cap and 120ms future tolerance.

The render timeline interpolates buffered remote states with bounded extrapolation. Delivery steering follows median arrival offset over a four-second window, with bounded slewing. Adaptive delay uses spacing and jitter, bounded to 45–115 ms. Only periodic snapshots feed cadence/jitter estimates. Arrival-based delay is an opt-in comparison (`netArrivalDelay=1`); the removed `netSmoothing=legacy` switch no longer selects another renderer. Remote smoothing preserves spawn snaps and recovery/extrapolation limits.

`movementFxSeq` identifies movement cues; detailed movement-effect fields are short-lived, and wall-side data is conditional. Treat optional snapshot fields as optional and reset visual/audio state on lifecycle transitions.

## Movement corrections

The server limits each input packet to an elapsed-time movement budget and sweeps dash/coast against canonical colliders. Corrections include an increasing per-player `correctionId`, corrected input `sequence`, reason (`budget` or `collision`), error and collision contacts. The client echoes its latest applied ID as `correctionAck`; the server briefly drops reports sent before that acknowledgment to prevent repeated stale corrections. Server teleports reset the wait.

The client applies the error relative to the corrected input's recorded position, preserving subsequent movement. Small errors blend; large errors snap. Collision corrections constrain the blocked axis while retaining motion along the surface, and do not pull an actor back to a face already left. Fractional movement precision and subpixel tolerances prevent repeated corrections on platform edges. This is bounded client movement, not a complete authoritative human physics replay.

## Ninja and Huntress protocols

`src/client/game/characters/networkRegistry.js` and `src/server/core/gameRoom/characterCombatRegistry.js` register the dedicated adapters. Both use server runtimes for human and bot outcomes, predicted local visuals, reconciliation by projectile ID and reconnect bootstrap records. Stale protocol clients must reload; deploy matching browser and server versions.

**Ninja** advertises `ninjaCombatVersion: 1`. The shared projectile model defines outgoing, hover and fixed-step homing-return phases. Requests validate socket identity, aim, ammo, cooldown, charge and eligibility. Swept contacts hit each target at most once per flight leg. Outgoing wall contact turns a projectile back; returning flight passes through terrain. Only an authoritative basic return refunds ammo; supers never do. Return corrections are sent at 10 Hz because the owner moves. Death/disconnect cancels active flight and pending super shards. Late launches cannot resurrect completed/rejected predictions.

**Huntress** advertises `huntressCombatVersion: 2`. Authoritative combat is always enabled; there is no browser-damage fallback or rollout toggle. The shared fixed-step model drives arrows and aim preview. Client aim/power are inputs; the server resolves launch position, spread, gravity, ammo and damage. Read `src/shared/characters/huntress.json` for current speeds/reload/lifetimes. Local arrows predict after windup, accepted launches reconcile by ID, and remote arrows sample server age rather than launching from delayed actor sprites. Visual contact pauses never apply damage. Terminals contain exact impact coordinates and attachment offsets. `game:init.huntressCombat` carries version, epoch, clocks, geometry, active projectiles and bounded terminals; existing `game:action` carries result/projectile/terminal messages.

Human collision locations still depend on received movement reports. Last-moment dodges can disagree under latency; projectile authority does not eliminate that limitation.

## Shot prediction and lag compensation

Every shooter (Huntress arrows and burning volley, Ninja shuriken and swarm, Wizard fireball, Gloop slimeball and hook) follows one contract. The shared pieces are `src/client/game/characters/shared/shotPrediction.js`, `src/server/core/gameRoom/lagCompensation.js` and `src/shared/combat/shotContact.js` (hit boxes, collision centres and swept contact used by both sides).

1. **The shooter predicts its own launch.** Huntress and Ninja reconcile by projectile ID and keep the prediction's lead over the later server launch (capped at 300 ms) instead of pulling the shot back. Wizard and Gloop release locally after their windup under the request's ID; the server's echo of that ID is skipped. The Gloop hook request carries its ID through `game:special`.
2. **Requests carry the render time.** `withShotView` adds `viewMono`, the server simulation time the render timeline is drawing remote actors at. The `game:action` and `game:special` socket handlers overwrite `viewRewindMs` with the arrival simulation time minus `viewMono`, clamped to `HIT_STALENESS_MAX_MS` (300 ms). Client values are never trusted, and bot shots, which never pass the transport, have no rewind.
3. **The server tests targets where the shooter saw them.** Huntress, Ninja and the generic projectile and hook runtimes place each enemy at its position-history entry `viewRewindMs` before the current step. Melee runtimes are not rewound. Teleports (spawn and respawn) restart a player's history, so a rewind never reaches a pre-teleport position. Huntress attachment offsets are relative to the seen position.
4. **The shooter draws hits at once against enemies as displayed.** Huntress arrows stick into the drawn body (and Bank Bust vaults) and follow it; Ninja and Wizard flash an impact once per enemy and leg; a Gloop slimeball splats; the hook latches. Damage, hit sounds, health and pulls still wait for the server. A predicted hit the server does not confirm within `confirmWindowMs()` (lowest RTT plus 220 ms) is withdrawn by fading or letting go, never by flying on or jumping. Other players' shots are not predicted against bodies.

Clients also stop arrows at terrain with the bootstrap colliders, so shots never overshoot a wall while their terminal is in flight. The trade-off of the rewind is the victim's: under latency they can still be hit up to 300 ms after reaching cover.

## Diagnostics and verification

Browser console diagnostics:

```js
window.__BB_NETWORK_DIAGNOSTICS__()
window.__BB_HUNTRESS_DIAGNOSTICS__()
```

Network diagnostics report cadence/arrival gaps, jitter, underruns, extrapolation, delivery offset, clock estimates and correction counts/history. Server `[movement:corrections]` logs summarize budget/collision/stale-packet counts per human. Huntress diagnostics expose prediction and confirmation age/alignment metrics. These measurements do not establish end-to-end input latency or perceptual smoothness.

```sh
npm run test:network
node scripts/dev/benchmark-huntress.cjs
node scripts/dev/huntress-network-lab.cjs
```

The lab runs two isolated clients at http://127.0.0.1:3017 without production accounts or MySQL. `?rtt=100&jitter=1` enables a latency scenario; supported RTT values are 0, 50, 100 and 150 ms.

After transport changes, run relevant tests and the production build, then use two real clients to exercise fresh start, late join, disconnect/reconnect during pregame/countdown/combat, every character's basic/special, wall jumps, reversals, knockback, death/respawn, Bank Bust and results cleanup. Compare steady/variable latency and stalls. Deterministic tests and isolated benchmarks do not establish production capacity or browser frame pacing.
