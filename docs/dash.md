# Dash

Press Space with WASD or arrow keys to dash in any of eight directions. With no net directional input, dash horizontally in the direction the character faces. Opposing keys cancel on each axis. Diagonals are normalized. W / Up still jump outside a dash; Space no longer jumps.

Shared tuning is in `src/shared/movementPhysics.json`. Dash launches at 560 px/s (840 px/s straight down) in the selected direction, independent of incoming speed, for a 160 ms burst. Held movement keys steer grounded bursts at 6500 px/s². Once airborne, steering is disabled for the rest of that burst. Collision and friction can reduce that velocity during the burst. Steering away from contact works immediately; input into a contacted face cannot rebuild blocked velocity. Dash clears old wall-jump control locks, and normal movement resumes as soon as the burst ends. Cooldown lasts 5000 ms from the end of the 160 ms burst and is shared across ground and air. Landing does not refresh it. Gravity pauses during the burst and resumes afterward without replacing the resulting velocity. Excess horizontal speed coasts down with drag (900 px/s² in air, 600 on the ground), while opposite input brakes it sooner.

Wall contact cancels only the blocked velocity component. The blocked component stays cancelled for the rest of the burst; only motion along the surface continues. Ground/ceiling friction slows tangential motion by 600 px/s² during the burst. Walls use proportional vertical drag (rate 1.2/s), which cannot cancel gravity into a stationary hover; wall impact also restores gravity during the burst; normal ground drag continues during the slowdown. Vertical air resistance scales smoothly with speed squared (coefficient 0.0015), weakens near the apex, and fades out throughout coasting. There is no hard velocity threshold or forced stop. Normal gravity handles the return downward; the extra fast-fall gravity multiplier stays off during dash coasting. Jump and wall jump cancel dash coasting. Normal wall slide caps descent without applying inward horizontal velocity or overriding steering. Continuous AABB sweeps cover the whole physics-step displacement, including thin walls and low frame rates, preserve tangential sliding, and respect disabled/one-way faces. The sweep rebuilds contacts and restores pre-separation tangential velocity, with a microscopic clearance to prevent fractional platform landings from creating false side contacts. The server independently sweeps dash/coast position packets against canonical map colliders and grants a bounded, decaying speed allowance.

Movement packets preserve fractional positions to 0.0001 px. The server still clamps positions against surfaces, but ignores subpixel packet rounding when deciding whether to send a correction. Collision corrections include the contacted faces and preserve velocity and acceleration along the surface; they only cancel motion into the struck face. This avoids repeated `Body.reset()` calls clearing both axes on fractional platform tops and sides.

There is no dash damage or invulnerability. Attacks/specials cannot start during the burst; active attacks, control locks, and knockback prevent activation. A compact bottom-center Dash HUD fills over the five-second cooldown after the burst, turns green when full, flashes during activation, and pulses after six seconds ready without use. Battle overlays share the chat button’s stepped pixel frame and chroma mosaic. Fading cyan-white character afterimages and tapered speed streaks follow actual movement, with dense white/cyan segmented fast-fall-style lines aligned to the actual dash direction; stationary wall pressure emits no extra trail. The dash sound plays once on an accepted local launch, including invisible dashes, at volume 0.7. Nearby opponents start at 90% of that level and fade with distance through the shared player-audio utility. The watched fighter gets the full local level in spectator mode. Its pitch varies slightly between uses. See `public/assets/movement/README.md` for the sound source and permission note.

## Adding character animation rows

Add frames to the character/skin atlas named `dashing00`, `dashing01`, etc. (`dash00`, etc. also work). Keep the existing frame size and anchor alignment. The generic animation resolver discovers these names, sorts them numerically, and registers `<texture-key>-dashing` as a one-shot spanning the dash duration. Alternatively, register that animation key explicitly in the character animation module. For skins, add frames to each skin atlas to preserve its appearance. Until the row exists, local dash uses the falling pose; remote rendering uses its normal fallback.

No character sheets are modified by this implementation. Dash currently activates from the keyboard; mobile retains its existing movement/jump controls. Bots dash to escape pressure, close on enemies at or below half health, dodge predicted attacks, and cover long stretches of safe ground. Navigation includes direct upward/diagonal dashes and jump-then-dash routes for higher ledges and wider gaps. Bots compare those routes with ordinary jumps and use faster climbs when useful. Each planned route uses at most one dash; after landing, the bot replans with its remaining cooldown. The same movement solver verifies takeoff, burst, coast, and a stable landing, and the navigation worker builds the extra routes off the live game loop. Bots reserve their dash during a committed approach/jump so an attack cannot prevent the planned midair activation.

Combat opportunities are checked with delayed observations, with rolls spaced 0.35–0.7 seconds apart. Successful dashes add a randomized 0.25–1.1 second pause after the shared cooldown. Bots still require a useful escape, dodge, pursuit, or travel destination rather than activating whenever ready. Attacks cannot start during the burst, and knockback interrupts it.

## Verification

`node --test tests/botDash.test.js tests/botDashNavigation.test.js` covers bot dash decisions, restraint, landing safety, collision, interruption, and controller execution. `node --test tests/dash.test.js tests/keyBindings.test.mjs` covers direction normalization, ground/air use, facing fallback, cooldown boundaries, interruption/gravity restoration, server replay rejection, and saved-key migration. `npm run build` checks browser bundling. Manual playtesting should tune distance and timing and check diagonal wall/corner contact plus two-client rendering under latency.

## Downward stomp

Straight-down dash launches at 840 px/s (50% faster than the normal 560 px/s dash).
An airborne straight-down dash arms one stomp until the end of its 850 ms coast.
The server resolves the landing against map geometry, then pushes opponents within
110 px of the impact away and upward without damage. Allies are unaffected.
The stomp interrupts attached attacks, unreleased casts, and pending barrage shots,
and prevents new attacks for 300 ms. Maximum knockback is 299 px/s horizontally
and 182 px/s upward; already released projectiles keep flying.
Knockback, jumping away, death, or expiration cancels the pending stomp.
Straight-down dash uses the character/skin's duck animation. Every client receives
the authoritative impact with 36 smoke puffs (3× the original stomp), debris,
compact twin cyan rings, doubled camera-shake strength (0.006), and the dedicated
CC0 Brian MacIntosh thud sound; only the stomper receives the extra camera shake.

Bots occasionally convert ordinary jumps/falls into straight-down stomps. They
use delayed enemy observations and predicted movement at the simulated landing,
check the live 110 px body-edge radius, and require a safe landing without added
projectile danger. Each opportunity has a 40% roll spaced 600–1000 ms apart;
normal dash cooldown and hesitation still apply. Committed dash routes are kept.
Successful decisions are counted in the `dashStomps` bot metric.
