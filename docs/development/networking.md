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

Human positions in snapshots are time-aligned by `gameRoom/humanPlayout.js`. Each accepted packet is placed on the server clock by its `timestamp` (the client's `Date.now()`), using the lowest arrival-minus-send offset of the last few seconds so network delay variation drops out. Snapshots publish each human's motion (position and velocity) interpolated a playout delay before the snapshot's simulation time. The delay is the 90th percentile of how long the newest sample has been waiting when the next one arrives, plus 2 ms, capped at 80 ms (`MAX_PLAYOUT_MS`), and it changes by at most 8% of elapsed time. Publishing the latest packet instead turned packet spacing and jitter into uneven snapshot steps: with 25 ms packets and 33 ms snapshots, a steady run was published as 9, 9, 18 px steps, which every viewer drew as jitter. Position history keys each accepted position by the time it will be published, so rewinds land on what attackers were shown. Anything that moves a human on the server (respawn, hook pull, idle fallback, Inferno) is published at once, and the playout restarts from zero delay. Packets without a timestamp publish the latest position. Bots are stepped on the simulation clock and published as they are.

The render timeline interpolates buffered remote states with bounded extrapolation. It advances by the frame's rAF timestamp (`game.loop.now`), not `performance.now()` read partway through the frame's work. Delivery steering follows median arrival offset over a four-second window, with bounded slewing. Adaptive delay uses spacing and jitter, bounded to 45–115 ms. Only periodic snapshots feed cadence/jitter estimates. Arrival-based delay is an opt-in comparison (`netArrivalDelay=1`); the removed `netSmoothing=legacy` switch no longer selects another renderer. Remote smoothing preserves spawn snaps and recovery/extrapolation limits.

`player:dead` and `player:respawn` arrive one interpolation delay ahead of the snapshots being drawn. Each event carries the newest snapshot received before it (Socket.IO keeps one socket's messages in order), and `remoteLifeState` in `remoteSmoothing.js` gives older snapshots the event's life state, so the lagging timeline cannot undo the event. A respawned actor stays at the spawn until the timeline reaches it. The snapshot path still starts death and respawn presentation when an event was missed.

`movementFxSeq` identifies movement cues; detailed movement-effect fields are short-lived, and wall-side data is conditional. Treat optional snapshot fields as optional and reset visual/audio state on lifecycle transitions.

## Movement corrections

The server limits each input packet to an elapsed-time movement budget and sweeps dash/coast against canonical colliders. Corrections include an increasing per-player `correctionId`, corrected input `sequence`, reason (`budget`, `collision` or `idle`), error and collision contacts. The client echoes its latest applied ID as `correctionAck`; the server briefly drops reports sent before that acknowledgment to prevent repeated stale corrections. Server teleports reset the wait. After silence causes server idle simulation, an `idle` correction hands back authoritative position, velocity and grounded state. The client discards stale path blending, acceleration and dash/coast state; ordinary budget and collision corrections keep their existing smoothing rules.

The client applies the error relative to the corrected input's recorded position, preserving subsequent movement. Small errors blend; large errors snap. Collision corrections constrain the blocked axis while retaining motion along the surface, and do not pull an actor back to a face already left. Fractional movement precision and subpixel tolerances prevent repeated corrections on platform edges. This is bounded client movement, not a complete authoritative human physics replay.

## Ninja and Huntress protocols

`src/client/game/characters/networkRegistry.js` and `src/server/core/gameRoom/characterCombatRegistry.js` register the dedicated adapters. Both use server runtimes for human and bot outcomes, predicted local visuals, reconciliation by projectile ID and reconnect bootstrap records. Stale protocol clients must reload; deploy matching browser and server versions.

**Ninja** advertises `ninjaCombatVersion: 1`. The shared projectile model defines outgoing, hover and fixed-step homing-return phases. Requests validate socket identity, aim, ammo, cooldown, charge and eligibility. Swept contacts hit each target at most once per flight leg. Outgoing wall contact turns a projectile back; returning flight passes through terrain. Only an authoritative basic return refunds ammo; supers never do. Return corrections are sent at 10 Hz because the owner moves. Death/disconnect cancels active flight and pending super shards. Late launches cannot resurrect completed/rejected predictions.

**Huntress** advertises `huntressCombatVersion: 2`. Authoritative combat is always enabled; there is no browser-damage fallback or rollout toggle. The shared fixed-step model drives arrows and aim preview. Client aim/power are inputs; the server resolves launch position, spread, gravity, ammo and damage. Read `src/shared/characters/huntress.json` for current speeds/reload/lifetimes. Local arrows predict after windup, accepted launches reconcile by ID, and remote arrows sample server age rather than launching from delayed actor sprites. Visual contact pauses never apply damage. Terminals contain exact impact coordinates and attachment offsets. `game:init.huntressCombat` carries version, epoch, clocks, geometry, active projectiles and bounded terminals; existing `game:action` carries result/projectile/terminal messages.

Human collision locations still depend on received movement reports. Last-moment dodges can disagree under latency; projectile authority does not eliminate that limitation.

## Attack delivery

How an attack reaches its target decides how it is networked, so attacks are networked by delivery, never per character. `src/shared/combat/attackDelivery.js` owns the policy of each delivery and maps every server attack runtime to one; the server (`lagCompensation.js`, `attackRuntimes/`) and the attacker's client (`characters/shared/shotPrediction.js`) both read it. `tests/attackDelivery.test.js` fails for an attack runtime without a delivery.

| Delivery | Attacks | Server rewind | Attacker's client |
| --- | --- | --- | --- |
| attached: the hitbox moves with the attacker | Thorg sweep (`path-rect`), Draven splash (`attached-rect`), `attached-cone` | targets where the attacker saw them, capped lower than shots | swing tested against enemies as drawn; hit sound and a hitstop on both fighters |
| released: flies on its own | Huntress arrows and burning volley, Ninja shuriken and swarm, Wizard fireball, Gloop slimeball and hook | constant offset for the whole flight | launch predicted and reconciled by ID; hit sound and a shorter hitstop on the victim |
| area: warned, resolves later | Draven Inferno | none: the target had time to react (favor the target) | nothing predicted |
| self | Thorg Rage, Wizard Arcane Surge, dash | not applicable | predicted locally |

The caps and hitstop lengths are in `DELIVERIES`. The trade-off of every rewind is the victim's: under latency they can still be struck up to the cap after reaching cover or stepping out of reach.

1. **Requests carry the render time.** `withShotView` adds `viewMono`, the server simulation time the render timeline is drawing remote actors at, to every `game:action` and `game:special`. The socket handlers overwrite `viewRewindMs` with the arrival simulation time minus `viewMono`, bounded by both `HIT_STALENESS_MAX_MS` (300 ms) and a per-connection allowance; each attack then bounds it again by its delivery (`clampDeliveryRewind`, in `attackIdentity` and the Huntress and Ninja runtimes). Server-originated `game:latency` acknowledgments, driven by the existing clock cadence, measure RTT without reading client timing values. The allowance is the lowest recent RTT plus 150 ms for the remote render buffer and jitter; before a successful probe (including older clients) it is 150 ms. Samples expire after 30 seconds and reconnects start fresh. Non-numeric or non-finite view times receive no rewind. A forged old view cannot grant more than this allowance; deliberately delaying all network responses remains indistinguishable from genuine latency. Bot attacks, which never pass the transport, have no rewind.
2. **The server tests targets where the attacker saw them.** Every runtime places each enemy at its position-history entry `viewRewindMs` before the current step (`shotTargetBounds`). The attacker stays where it is now: its own inputs reach the server with the same delay as its request, so its swing or shot and its body line up on the server as they did on its screen. History records collision dimensions and offsets as well as position: coordinates interpolate, but posture/facing changes take effect at the timestamp of the newer sample, never by interpolating body sizes. Teleports (spawn and respawn) restart a player's history, so a rewind never reaches a pre-teleport position. Hit validation for an attached contact (walls between the fighters, melee facing) uses the same two positions the runtime tested. Huntress attachment offsets are relative to the seen position.
3. **Attached shapes are shared code.** `attachedRectShape`, `pathSweepShapes` and `sectorShape` are pure functions of the attacker's pose and the time since the attack started. The server runtimes and the attacker's client call the same functions with the same tuning, and `tests/attackDelivery.test.js` checks that the client's volume equals the one the server exposes at each moment of the attack. The client predicts on the attack's own clock from the key press, so a hitstop that holds the drawn swing does not delay what it strikes.
4. **Every predicted hit lands the same way.** A predicted contact (`predictShotContact` for released attacks, `predictAttachedContacts` for attached ones) goes through `notePredictedHit`: the attacker's hit sound and the shared hit feedback (client guide, "Hit feedback") play at the target, and `hitstop` holds the animation frames (the victim's, and for attached attacks the attacker's too) for the delivery's `hitstopMs`. Position and simulation never pause. The character draws its own impact (an arrow in the body, a burst, a splat, an explosion, a latch). When the server confirms, `takePredictedHit` stops the confirmation, impact and health-update feedback echoes from playing them a second time. Damage numbers and health always wait for the server. A predicted hit the server does not confirm within `confirmWindowMs()` (lowest RTT plus 220 ms) is withdrawn by fading or letting go, never by flying on or jumping; a sound that already played cannot be withdrawn, which is why predictions use the server's exact shapes.

Clients also stop arrows at terrain with the bootstrap colliders, so shots never overshoot a wall while their terminal is in flight. Other players' attacks are not predicted against bodies.

### Adding a character or an attack

1. Pick each attack's delivery by how it reaches its target, and give it an existing runtime kind in the character's JSON (`runtime.kind`) with its tuning. No new netcode is needed.
2. An attached attack with a new shape adds one pure shape function to `attackDelivery.js`, used by its server runtime and its client attack, plus a case in `tests/attackDelivery.test.js` comparing the two.
3. The client attack sends its request through `emitAttackAction` (or `withShotView`), tests its predicted contact with `predictShotContact` or `predictAttachedContacts`, and calls `notePredictedHit` for each contact.
4. Only an attack that reaches its target in a new way (a beam, a grab) needs a new delivery, with its policy in `DELIVERIES`.

## Production network tracing

Lag and rubber-banding that only reproduce on the production Pi are measured with a run-scoped trace. It is off unless the server has `BB_NET_TRACE_TOKEN` (at least 16 characters) in its environment. `BB_NET_TRACE_DIR` overrides the output directory (default `data/net-traces`, gitignored).

- **Opt in per tab:** open any page with `?nettrace=<runId>&ntk=<token>&ntag=<label>`. The spec is kept in `sessionStorage`, so it survives lobby → party → game navigation; `?nettrace=off` clears it. The socket handshake carries it, and `src/server/core/socket.js` verifies the token. A wrong token is ignored silently.
- **Server** (`src/server/core/gameRoom/netTraceRecorder.js`): every room a traced socket joins writes `<runId>/server.jsonl`. Records are per-second loop/snapshot/bot/input/write-buffer summaries with main-thread time per fixed-step phase (`tick`: `platforms`, `tick` = bots and idle humans, `attacks`, `combat`, `items`, `mode`, `publish`), loop and snapshot-emission stalls (`stall`), corrections sent to traced players, attack requests from traced sockets with the stamped view rewind (`action`), damage applied where a traced player is attacker or victim (`hit`), navigation-worker builds (`nav`), and host load, event-loop delay, CPU, memory, swap, GC pauses, page faults, iowait and context switches (`host`). Writes are buffered and flushed once a second. Limits: 8 traced sockets and 50 MB per run, client batches at most 256 KB and one per 400 ms; runs older than seven days are pruned. `BB_NET_TRACE_CPU_PROFILE_S=<seconds>` also writes `<runId>/cpu.cpuprofile` of the game thread once the first traced room goes live; summarize it on the Pi with `node scripts/dev/cpuprofile-top.cjs <file>` (totals) or `scripts/dev/cpuprofile-spans.cjs <file>` (the longest single bot ticks).
- **Client** (`src/client/game/match/netTrace.js`): records raw snapshot arrivals, decoded positions, rendered local/remote positions per frame, corrections, keys and mouse buttons, clock and render diagnostics, attack requests sent (at the socket, so every character), combat actions, health and super updates received, and predicted hits drawn and withdrawn (through a hook `shotPrediction.js` exposes), and uploads them every two seconds on `debug:net-trace` to `<runId>/<tag>.jsonl`. Detection happens offline in the report, so it can change without a client build.
- **Probe accounts:** token-verified sockets may use `queue:fill-bots` for their own party and skip trophy mode and character locks for six hours (a locked character plays at level 1), so fresh guests can test any mode and character.

```sh
# One-time: npx playwright-core install chromium-headless-shell (and chromium for --headed)
# Headless clients on this machine, private party, bots fill the rest.
npm run net:probe -- --clients 2 --mode bank-bust --duration 90
npm run net:probe -- --mode duels --variant duels-2v2 --char ninja --script dash
# Attack scripts steer toward the nearest enemy and attack with J/I (auto-aim);
# one character per client; two matches; compare with an earlier run.
npm run net:probe -- --mode bank-bust --char huntress,thorg --script special --matches 2 --run bb-hunt-thorg --baseline <runId>
# Fetch the run from the Pi over SSH and print the diagnosis.
npm run net:report -- <runId>
npm run net:report -- --compare <runA> <runB>
```

The probe reads the token from `--token`, `$BB_NET_TRACE_TOKEN` or a gitignored `.env.nettrace` (`BB_NET_TRACE_TOKEN=...`); against `--base http://localhost:3002` it falls back to `.env`. Use `--local` with the report for local runs. Other flags: `--chrome` (installed Google Chrome instead of the headless shell), `--map`, `--script strafe|dash|idle|mixed|attack|melee|special|fight`, `--range <px>`, `--matches <n>` (fresh guests and party per match in one browser; runs `<id>-m1`, `-m2`…), `--baseline <runId>`, `--no-report`, `--headed` (Playwright's full Chromium in a window; `npx playwright-core install chromium` once), `--cpu-throttle <rate>`, `--run <id>` (refused if the run already exists, since trace files append). `BB_NET_TRACE_REMOTE` (default `nisch@100.94.147.111`) selects the SSH host the report and probe use. Real browsers produce the same files when opened with the trace URL.

For attacks the report prints, per client and character: press → request sent (the local attack plays in the same frame), request → server receipt, predicted hit drawn → the target's health update, server hit → client health update, press → confirmation (includes windups and projectile flight), hit → super update, the share of predicted hits the server never confirmed (and how many coincided with a loop stall), and the view rewind applied as shooter and as victim.

The report classifies each client snapshot gap ≥100 ms as server-side (the server's own emission gap matched it) or transport, and each rubber-band event as correction, server-stall, transport-gap, client-frame-hitch, client-interpolation or unexplained. Reversals that follow a key press, or that appear in the server's own snapshots, count as ordinary movement. Loop stalls are cross-checked against navigation builds, heavy bot ticks and host overload. Headless Chrome renders in software, so treat client frame hitches with care and compare with `--headed`.

## Game-thread budget and lag root causes

Everything a player sees waits on the game thread: snapshots, hit confirmations, health and super updates, and the processing of incoming inputs and attacks. When the loop stalls, remote actors freeze and then catch up, predicted hits go unconfirmed, and an `idle` correction can pull the local player back. Production traces (2026-11, `output/net-traces/LOG.md`) found these causes, ranked by how much players felt them:

1. **Bot planning.** Route search was ~75% of bot planning on the Pi, and a single planning unit (one route query) could take 100+ ms, so the 4 ms planning allowance never bounded it. Bank Bust matches had ~150–190 loop stalls a match and stalls up to 1.6 s. Each navigation graph now gets search tables once (`routeSearchTables` in `bots/navigation.js`): integer state ids, adjacency records and per-surface walk blockers. Searches use typed arrays. Seeded `simulate-bots --deterministic` fingerprints are unchanged. Nothing in a bot tick may run unbounded: long work is a generator consumed by `advancePlanning`, which stops at `_botPlanningDeadline`. Route queries inside planning generators use `context.routeSteps`, which pauses a long search between expansions and resumes it next frame, and a new graph's search tables are built the same way (`routeSearchTablesSteps`). States settle in the same order either way, so answers, random draws and fingerprints are unchanged; only a long search finishes a few frames later. A stuck bot's recovery used to run a whole decision synchronously (up to ~100 ms on the Pi); it is now planned the same way. Bot physics and navigation checks query colliders through an x-bucket broadphase (`nearColliders` in `bots/physics.js`) that returns nearby colliders in their original order, so results are identical and Bank Bust graph builds take ~2.5 s instead of ~6 s on the Pi. Ballistic aim (`clearTrajectory` in `bots/combat.js`) samples an arc once and tests only cover near its flight: testing every collider against each of an arc's ~180 steps, for every arc a decision tried, held the thread for 40–80 ms in one call and was most of the bots' time in Bank Bust (395 → 145 ms/s once fixed). Avoid `require()` inside per-tick functions: module resolution was ~10% of the live game loop in a CPU profile.
2. **The catch-up spiral.** After a stall the loop runs up to 60 steps in one frame. Each step used to get its own planning allowance, so one stall produced the next. Planning now also stops at `BOT_PLANNING_FRAME_MS` per loop frame (`gameRoomConfig.js`): two-step frames from timer jitter keep the full allowance, long catch-ups do not plan. With three Pi cores busy, stalls ≥200 ms dropped from 50 to 0 a match.
3. **Synchronous disk writes.** Node writes stdout and stderr synchronously to files and pipes (pm2). On the Pi the SD card is often busy with swap, so one log line held the loop for 1.8–5.1 s (traced at ~5% CPU and 70–94% iowait). `src/server/lib/asyncConsole.js` queues console output and writes it from the threadpool. Do not add synchronous file I/O on the game thread; a worker's disk cache of navigation graphs was tried and removed for the same reason (its writes stalled the loop up to 1.4 s).
4. **Navigation graphs.** Builds run in one worker thread (a second worker slowed every build and the game thread with it). The worker returns graphs packed into transferred typed arrays (`bots/navigationPack.js`); receiving a structured clone of ~80k frame objects cost the game thread ~150 ms per graph. The queue builds the most recently requested graph first and drops requests no bot has repeated for 3 s. While a Bank Bust wall change rebuilds, bots route with the newest graph for the same character and buffs, checked against the current walls. Different buffs never borrow routes. A wall changes only the moves whose simulated paths came near it, so `buildGraph` records the area each surface's moves covered (`sweeps`) and builds a changed layout from the worker's latest graph for the same character and buffs: surfaces whose area no added or removed collider touches keep their edges, and only the rest are simulated again. The result equals a full build (checked over random wall sequences for every character); a single wall costs about a fifth of a full build.
5. **Death and respawn presentation fought the snapshot timeline.** With the loop steady, the last remote "bounce" left was on every remote death and respawn. The death event started the death animation, and the next frame the older snapshot (still alive) respawned the corpse until the timeline caught up, playing the death twice. A respawn showed the player at the spawn, then dying again at the death spot for ~70 ms. Each snapshot-driven respawn also moved the sprite once by its collider offset (70–140 px), because Phaser's `body.reset()` records the sprite's top-left as the previous body position. See [Snapshots and clocks](#snapshots-and-clocks).

To find the next cost, profile the live process (`BB_NET_TRACE_CPU_PROFILE_S`) rather than the simulator: production bots cost about twice per bot what `simulate-bots` shows, because live matches have humans, mode objectives and planning slices cut by real time.

Remaining limits on the 4-core, 4 GB Pi: swap keeps the SD card busy; a bot's takeoff check (`prepareTraversal` from its real state) and per-tick physics still run unsliced; and the game shares the Pi with other apps. Other apps are kept off one core and at a lower priority (see [Deployment](../operations/deployment.md#shared-raspberry-pi)); before that, three busy cores brought back 50–150 ms stalls.

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
