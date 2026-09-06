# Huntress authoritative projectiles

## Enable and rollback

`npm run dev` enables protocol 2 for newly created rooms. Production remains opt-in:
start the server with `BB_HUNTRESS_COMBAT_V2=1`, deploy the rebuilt client, reload
both browsers, and create a new match. Existing rooms retain their original protocol.
For rollback, restart with `BB_HUNTRESS_COMBAT_V2=0` and create new rooms.
Protocol 2 rooms reject joins from clients that do not advertise support, with a reload message.
The dev watcher includes `src/shared` and `src/lib` so projectile math and tuning
changes restart the server as well as rebuilding the client. Restart `npm run dev`
once to pick up the updated watcher configuration.

## Behavior

Normal and burning arrows share launch tuning, fixed 60 Hz flight, inset player
bounds, and earliest swept contact. Terrain uses point contact; players use the
configured radius. Humans and bots use the same server runtime. Client input
provides aim and normalized power; damage, launch coordinates, spread, gravity,
ammunition and eligibility are resolved by the server. Bot decision-making is unchanged.

The aim preview now samples the shared fixed-step flight instead of a decorative
throw curve. A low-flight-time solution accounts for the muzzle offset and gravity
to reach the selected target; unreachable targets show the actual attainable path.
Normal arrows interpolate from 459.2 to 900 px/s with aim distance; burning
arrows use 960 px/s. Reload time is 1667 ms per arrow (40% lower reload rate). Aiming upward no longer cuts speed by up to 32%; this
previously cut vertical reach by roughly half. Lifetimes are 5/6 seconds so the
higher arcs can finish. Burning volleys spread around the preview's centerline.
These tuning changes apply equally to human and bot arrows. Burning visuals emit
layered flames in flight and flames plus rising smoke at confirmed attachments,
with a bounded cosmetic particle pool and cleanup on scene reset.

Local arrows appear after the existing windup, without waiting for the server.
Accepted launch state replaces predicted state by ID. Remote arrows are sampled
at estimated server simulation age rather than launched from interpolated actors.
Visual contacts may pause briefly awaiting confirmation; they never apply damage.
Terminals carry exact impact coordinates plus a body-clamped attachment offset.
The legacy confirmation path also clamps attachment to the current body to avoid
arrows floating behind a victim. That legacy cosmetic fix does not fix legacy collision authority.

`game:join` adds `huntressCombatVersion: 2`. `game:init` adds `huntressCombat`
with version, epoch, clocks, collision geometry, active projectiles, and bounded
terminal history. `game:clock` is a lightweight acknowledged clock exchange.
Existing `game:action` carries `huntress-result`, `huntress-projectiles`, and
`huntress-terminal`. Existing health/super updates remain authoritative. No per-arrow
per-frame network stream is added. Actor snapshot cadence and movement authority remain unchanged.

## Verification

Run `npm run test:network`, `node --test tests/*.test.js tests/*.test.mjs`, and
`npm run build`. `node scripts/benchmark-huntress.cjs` compares six firing
Huntresses over identical headless workloads. `node scripts/huntress-network-lab.cjs`
starts an isolated two-client Phaser/Socket.IO lab at http://127.0.0.1:3017.
Use `?version=2&rtt=100&jitter=1`, or version 1 for comparison; supported RTTs
are 0, 50, 100 and 150 ms. This uses no production accounts or database.

Browser diagnostics: `window.__BB_HUNTRESS_DIAGNOSTICS__()` includes prediction
windup overrun, reconciliation distance, pre-confirmation visual error, confirmation
age and target movement-report age. Server `_huntress.metrics` holds bounded tick costs.

The isolated 100 ms RTT/jitter browser run measured approximately 8.41 ms p95
frame time versus 8.42 ms for legacy. Stationary-target confirmed impact alignment
was within 0.002 px in the sampled revised run. The six-shooter headless benchmark
measured p95 tick cost around 0.09–0.11 ms for v2 versus 0.05–0.07 ms for legacy,
with serialized room traffic approximately 91 KB/s versus 84 KB/s. This is a small
absolute CPU increase, not a claim that server processing became faster.

These measurements cover the isolated lab, not deployed-server load or a complete
moving-player match. Deterministic tests cover 30–240 Hz flight, simulated 50/100/150 ms
RTT, jitter, stalls, duplicate/reordered terminal handling, shield, vault, burn, death,
protocol gating and restoration. Production playtesting remains necessary.

Human collision positions still come from received movement reports. A last-moment
dodge can disagree with the server under latency. This change deliberately does not
predict authoritative human movement, rewind projectiles, or enlarge hitboxes to hide
that remaining limitation.
