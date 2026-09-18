# Realtime diagnosis — September 18, 2026

The strongest evidence points to **long synchronous bot-navigation work on the server**, plus **separate client animation and projectile-correction defects**. The Pi makes the expensive work more noticeable. The measured public connection was usually fast; distance alone cannot explain the failures in these recordings.

This was an investigation, not a gameplay patch. No application source was changed, no production build was deployed, and PM2 was not restarted. Diagnostic clients connected to the deployed game; profiling experiments ran in separate processes. Evidence is saved in [output/realtime-diagnosis](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis>). That directory is ignored by Git.

**What was tested**

- Reviewed all four recordings through sampled frames and denser sequences around movement/attack behavior. Matched the visible player names to production match logs.
- Ran three production Socket.IO matches: public 1v1, public 3v3, and direct-LAN 3v3. The test guest reported a stationary position at 30 Hz; other participants were bots. These measure transport and server scheduling, not browser frame rate or human input responsiveness.
- Compared client packet arrival intervals against the server's monotonic publication timestamps. Also pinged public and LAN WebSocket connections simultaneously.
- Read production timing logs and Pi resource/process information. Profiled the existing bot simulator on the Pi and locally, then tested one temporary optimization in a separate process.
- Reproduced remote Ninja animation interruption and projectile backtracking using actual application functions with test stubs. Ran the existing relevant network tests: **67 passed**. Passing those tests does not cover the integrated failures demonstrated here.

The local and Pi checkouts were at `a15dd11`. Public, Pi, and local game bundles had the same SHA-256: `ebb563dfda648aa8e7e7a0f35cdbc4d59cc1aee364a511f198b5ddf2b832298b`. The relevant bot-navigation and character-tuning files predate the running server process. This does not prove every later repository change is loaded in that process.

**1. Server pauses are real and affect other matches**

Normal snapshots arrive about every 33 ms. The worst gaps in these tests were already present in the server's publication timestamps:

| Production test | Match | Snapshots | Median round trip | Largest server publication gap | Largest arrival gap |
|---|---:|---:|---:|---:|---:|
| Public 1v1 | 554 | 367 | 9.95 ms | 132.6 ms | 131.8 ms |
| Public 3v3 | 555 | 314 | 10.19 ms | 299.6 ms | 299.9 ms |
| Direct LAN 3v3 | 556 | 449 | 5.30 ms | 1,629.5 ms | 1,631.9 ms |

For 95% of sampled intervals, the absolute difference between arrival spacing and publication spacing was under 3.4 ms in each test. That strongly attributes the large observed gaps to the origin's scheduling, rather than additional transit delay. It does not exclude occasional network jitter or packet loss elsewhere.

The LAN match's largest pause coincided with **another match, 557, being constructed**. This is a concrete cross-match interference case. During an earlier room startup, simultaneous public and LAN pings both backed up for roughly 2.6 seconds and then completed together. Cloudflare was not necessary for that failure to occur.

These are short samples, with different rosters and concurrent room activity. The table is not a controlled comparison of LAN versus public performance. Evidence: [public 1v1](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/public-1v1-summary.json>), [public 3v3](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/public-3v3-summary.json>), [LAN 3v3](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/lan-3v3-summary.json>), [production log](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/production-final.log>).

The root cause is the synchronous graph builder in [navigation.js](</Users/nisch/Desktop/code/Bro Battles/src/server/core/bots/navigation.js:15>). It simulates many possible traversals, each with up to 150 physics steps plus settling. It runs during [bot construction](</Users/nisch/Desktop/code/Bro Battles/src/server/core/bots/controller.js:45>), and again during [bot thinking](</Users/nisch/Desktop/code/Bro Battles/src/server/core/bots/controller.js:131>) when movement modifiers require an uncached graph. Its cache is attached to the room's geometry object, so constructing a new room does not reuse a previous room's graph.

On the Pi, individual builds took **602–751 ms** in the isolated workload. A 15-second simulated Ninja match had a **757 ms maximum tick**, despite its 95th-percentile tick being only 4.8 ms. A separate CPU profile attributed about 2.4 seconds to graph-building stacks. Rare expensive operations, rather than consistently slow ticks, explain the abrupt jumps.

Repeated body-configuration cloning and merging inside collision work is a substantial part of that cost: [duelGeometry.js](</Users/nisch/Desktop/code/Bro Battles/src/shared/duelGeometry.js:12>) and [characterTuning.js](</Users/nisch/Desktop/code/Bro Battles/src/shared/characterTuning.js:45>). A temporary, separate-process memoization experiment reduced the maximum tick from **757 to 426 ms**. That demonstrates an optimization opportunity, but still leaves an unacceptable pause and is not a validated production fix. The experiment's output was not identical, so behavioral equivalence needs testing.

The same existing simulation on this computer peaked around 59 ms versus roughly 782 ms in a Pi profiling run. Hardware and Node versions differ, so this is not a clean hardware benchmark. Faster hosting would reduce the symptom, but the work should still be removed from the live server loop.

**2. The recordings have corresponding server stalls**

Matching visible player names to production records identified these matches:

| Recording | Match | Largest logged server callback | Largest logged bot-work duration |
|---|---:|---:|---:|
| Ninja versus Ninja | 539 | 628.5 ms | 610.9 ms |
| Ninja versus Huntress | 541 | 644.2 ms | 626.8 ms |
| Ninja versus Wizard, Switzerland VPN | 547 | 128.7 ms | 113.9 ms |
| 3v3, two human players | 552 | 544.9 ms | 530.3 ms |

In the Ninja recording, around 5.2–6.0 seconds, the local player continues moving while the remote bot holds near the left pickup area and then advances. The corresponding match includes a 616.7 ms snapshot gap and 37 catch-up simulation steps. This is consistent with the observed pause/catch-up pattern. The recording has no synchronized diagnostic overlay, so an exact frame-to-log timestamp assignment is not established. A buff triggering graph construction is plausible from the location and code, but the old logs do not record the graph-build trigger.

Huntress looks smoother overall, yet its match still contains a substantial server stall. Its attack-presentation mismatch has an additional timing explanation below. The Swiss Wizard clip combines real server pauses with whatever latency the VPN added; I did not measure that recording's actual round trip. In 3v3, ordinary Ninja boomerang return must be distinguished from correction-induced backward movement.

Visual evidence: [Ninja movement sequence](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/ninja-stall.jpg>), [Huntress attack sequence](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/ninja_v_huntress-detail.jpg>), [Wizard overview](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/ninja_v_wizard-overview.jpg>), [3v3 sequence](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/3v3_test-detail.jpg>). Original production records: [production-before.log](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/production-before.log>).

**3. Remote Ninja attacks can be cancelled after one frame**

The newer Ninja packet adapter starts the remote throw animation directly in [network.js](</Users/nisch/Desktop/code/Bro Battles/src/characters/ninja/network.js:120>). The coordinator [returns immediately after the adapter handles the packet](</Users/nisch/Desktop/code/Bro Battles/src/match/matchCoordinator.js:901>), bypassing its generic animation-duration lock.

The next remote-render update [chooses an animation from the buffered movement snapshot](</Users/nisch/Desktop/code/Bro Battles/src/game.js:2251>). Ninja's inherited animation chooser simply returns that snapshot animation. With no matching lock, a running snapshot replaces the attack.

The reproduction starts `ninja-throw` at 1,000 ms and replaces it with `ninja-running` at 1,016.7 ms. The normal throw lasts about 266.7 ms. This is a deterministic application-logic failure and requires no packet loss. Bots can further shorten the visible attack because their minimum attack-state hold is 150 ms. Evidence: [animation reproduction](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/animation-repro.json>).

Huntress does have a separate remote windup path; it is incorrect to describe its basic attack as never starting an animation. Its remaining mismatch needs an integrated presentation trace. Characters are displayed on a buffered timeline, while projectiles use an estimated current-server timeline and windups start on event receipt. Those clocks can visibly disagree, particularly during stalls. Huntress also has inconsistent special-animation lock fields worth checking during that work. These are narrower findings than claiming that Ninja's exact defect explains every character.

**4. Ninja correction can reverse a projectile with constant latency**

The owner predicts an attack immediately. The server creates its authoritative projectile later, after receiving the request. On confirmation, [the renderer replaces predicted state and removes the positional difference over 60 ms](</Users/nisch/Desktop/code/Bro Battles/src/characters/ninja/network.js:99>). The authoritative projectile can therefore be younger than the one already shown.

Using the existing renderer test harness, a stationary owner, and constant synthetic latency produced:

| Simulated round trip | Total backward travel during correction |
|---|---:|
| 10 ms | 0 px |
| 50 ms | 0 px |
| 150 ms | 26.2 px |
| 250 ms | 136.9 px |
| 350 ms | 173.4 px |

These values demonstrate a mechanism; they are not estimates of the Swiss connection. Correcting over 60 ms can overpower forward travel and produce the backtracking the user describes. Returning projectiles also home toward a displayed owner whose timeline differs between local and remote views, adding another potential divergence. Evidence: [correction reproduction](</Users/nisch/Desktop/code/Bro Battles/output/realtime-diagnosis/ninja-correction-repro.json>).

**How the architecture contributes**

The system has several competing notions of “now”: locally responsive player movement, server simulation, buffered remote actors, event-driven animations, and predicted/reconciled projectiles. A bot opponent removes the other human's upstream connection, but still exercises server scheduling and every remote-presentation path.

The server simulates at 60 Hz and normally sends snapshots at 30 Hz. The remote buffer settles around 100 ms at that cadence and can extrapolate up to 1,000 ms. Its remote position projection does not reproduce all world collisions. A long source pause can therefore leave an actor frozen or projected past a surface, followed by correction when snapshots resume. Projectile timing has a different extrapolation policy. Increasing the interpolation delay alone would add latency without addressing 600 ms stalls.

**Hosting and measurement limits**

The Pi was wired over Ethernet. Sampling found substantial available memory, no active swap-in/swap-out, and little I/O wait. Temperature was about 52°C; the throttle flags indicated a historical soft temperature limit, not a current one. Mostly idle aggregate CPU does not rule out a single blocked Node event loop. PM2's displayed process was an npm wrapper, so its small memory/loop figures were not measurements of the actual game process.

The public bundle matched the deployed build. Cloudflare development mode is unnecessary for these tests. WebSocket gameplay is a persistent proxied connection rather than cached snapshots; see [Cloudflare's WebSocket documentation](https://developers.cloudflare.com/network/websockets/).

No browser performance trace, GPU timing, synchronized video telemetry, or Swiss packet capture was collected. Browser rendering may contribute additional hitches, and the Huntress presentation needs a focused follow-up trace. These limits do not weaken the directly measured server stalls or the two deterministic Ninja reproductions.

**What to change, in priority order**

1. **Keep navigation construction off the live server loop.** Use a bounded reusable cache keyed by map geometry/version, character tuning, and supported movement modifiers; prepare graphs outside active ticks, preferably in a worker or offline. Room startup must also avoid blocking existing matches. Define a safe fallback while a graph is unavailable. Memoize immutable body configuration as a supporting optimization, not the entire fix.
2. **Give remote attacks one animation owner.** Route character adapters and buffered movement through a shared interruption/priority contract. Protect one-shot attacks through their duration, while explicitly permitting death/stun interruption. Test an attack event followed immediately by older running/idle snapshots, including skins, repeated attacks, and supers.
3. **Make Ninja prediction reconciliation preserve visual continuity.** Align predicted and authoritative launch ages and define correction behavior that does not reverse a normal outbound attack. Keep server validation authoritative. Test steady 10–350 ms round trips, jitter, moving owners, returns, and both owner/observer views.
4. **Align remote actors, windups, and projectile presentation.** Make their intended timeline relationship explicit. Validate Huntress separately with timestamped animation starts, projectile release, snapshot selection, and interruptions. Then tune extrapolation against collision-related overshoot.
5. **Repair the logger before another tuning round.** Record arrival gaps separately from server publication gaps; unclamped event-loop delay; graph cache misses, modifiers and duration; remote animation interruptions; and projectile correction magnitude/direction. Use rolling windows and identify the actual game PID/build.

The old logger is useful, but some labels are misleading: client `snapAvg/snapMax` use source/simulation spacing; newer adapters return before generic action logging; server loop delta is capped at 1,000 ms before some diagnostics; and lifetime maxima can keep warning severity elevated after recovery. The 1.63-second measured gap versus the capped server report demonstrates why these distinctions matter.

After those targeted changes, deploy and verify the public build identity, then repeat the same production probes while creating another bot room and triggering speed/jump buffs. Success means room creation no longer pauses other matches, graph work stays outside the simulation budget, complete remote attacks survive intervening snapshots, and stable-latency outbound Ninja attacks do not reverse during confirmation. No hosting purchase or Cloudflare cache change is justified as the first corrective step by this evidence.
