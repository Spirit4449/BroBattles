# Realtime follow-up: bot planning and combat presentation

## Changes

- Bot thinking uses resumable generators for target selection, tactical candidate scoring, dodge candidates and attack candidates. Each bot gets a 1.5 ms cooperative slice; a room shares a 4 ms planning allowance and rotates the first bot each tick. Physics continues every tick using the current intent. Completed searches keep the existing scoring rules. Damage, control locks, death and plans older than 500 ms invalidate pending work. Individual operations can exceed the cooperative allowance; this is not a hard CPU deadline.
- Navigation avoids queuing dominated/visited states, indexes surfaces once per search and avoids poison-frame allocation when no poison exists. Combat tuning is reused within one room tick; Huntress does not solve cover twice, and straight projectile cover checks use one segment.
- Local falling starts from physical movement rather than waiting for a jump clip to finish. Each local wall kick forces a jump replay; remote characters use movement state and jump event sequences, with existing attack locks retained.
- Huntress no longer freezes at a speculative contact against buffered opponent sprites. Only authoritative terminal events end or embed arrows. Confirmation errors converge over a speed-dependent interval.
- Ninja uses speed-dependent correction intervals and authoritative remote return targets instead of delayed rendered owner positions. Local owner prediction and authoritative collision/terminal handling remain intact.

## Verification before deployment

The existing 156 bot tests passed, including route reachability, cover, dodges, counterattacks and sudden-death escapes. Renderer regressions cover delayed/duplicate launches, local confirmation at 10–350 ms RTT, remote return trajectories, false Huntress contacts, and repeated wall kicks. New scheduler tests cover yield/resume, exhausted room budgets and stale-plan cancellation. Webpack production build passed; its existing bundle-size warnings remain.

The full suite's two failures remain the previously reproduced duck-art cell and currency reward-sound expectations; neither is changed here.

Bounded Pi 4 comparison: six bots, map 1, seed 17, 20 simulated seconds, same character roster. Instrumented bot update time excludes synchronous graph builds used only by this offline harness:

| Metric | Before | After |
|---|---:|---:|
| Total bot update CPU over 7,200 calls | 3,558.6 ms | 1,962.7 ms |
| Worst individual bot update | 114.3 ms | 38.0 ms |
| Simulation p95 tick | 13.12 ms | 6.34 ms |

This is approximately 45% less accumulated bot update time, 67% lower worst bot update and 52% lower p95 simulation tick in this short workload. Bot behavior diverges after scheduling changes, so this is not a universal capacity multiplier. An additional behavior run confirmed that all six characters moved and attacked. Offline max tick still includes synchronous graph construction; production uses the existing graph worker. A remaining operation can exceed one frame, so the changes reduce stalls without claiming to eliminate every spike.

No Wizard protocol changes are included in this patch. Its previously identified receipt-relative fireball timing remains separate work. Existing uncommitted team-color/visual edits in the user's main checkout were preserved and excluded from deployment.

## Live verification and cache-safe delivery

Production gameplay commit `558bed9` was pulled, built and restarted through PM2. The public bundle matched the Pi output. A live guest/5-bot match (582) delivered 486 snapshots: arrival p95 41.22 ms, source p95 39.20 ms, worst source gap 67.33 ms, RTT median 11.00 ms. Server logs recorded worst combined bot work of 19.22 ms. The immediately preceding live baseline (581) had arrival p95 45.33 ms, worst source gap 84.29 ms and worst combined bot work 48.26 ms. Different rosters and durations prevent treating these as controlled efficiency measurements.

A separate two-human-protocol guest PvP match (583) ran for 35 seconds. The second client added 80 ms upstream and 150–180 ms downstream delay: measured RTT median 259.54 ms, p95 273.02 ms. All 48 launches received by both clients contained identical authoritative projectile data. This verifies transport and authoritative replication, not subjective visual smoothness; renderer regression tests separately exercise presentation. Both guests disconnected and left the private test party afterward.

Production HTML now references content-addressed copies of the JS/CSS bundles. This prevents other Cloudflare regions or browser caches from serving an older bundle to a fresh page load. Original filenames remain available for compatibility. Verified the generated hashes against all 17 emitted bundle references; the existing unused matchmaking page references a bundle absent from the build and is unchanged. This packaging change does not alter gameplay logic.
