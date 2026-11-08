# Gameplay

## Wall movement

Wall jumps use the shared movement tuning in `src/shared/physics/movementPhysics.json`. The horizontal kick is 360 px/s, and a 450 ms cooldown spaces successive kicks; the upward kick scales with jump speed so existing climbs remain reachable. Wall slides and wall jumps need a real wall: a side whose top is less than `wallMinFaceHeight` above the ground under the body is a step. A body falls past a step at normal speed, and pressing jump beside one waits for the landing instead of kicking away from the climb. Wall jumps play the character's existing jump frames over roughly 450 ms without slowing ordinary jumps. The wall-slide pose stays visible for 120 ms after natural separation from the wall, while a wall jump or landing replaces it immediately. This pose hold changes presentation only; wall contact, slide friction, and jump input still use the physical state.

When tuning this movement, check repeated wall jumps, narrow wall climbs, dash interruption, and both players' animation timing in a live match. The bot movement simulation reads the same kick and cooldown values.

Wall kicks flash at the contact point, send a pixel pressure arc and a few horizontal speed lines away from the wall, squeeze clouds out along the wall, and leave a short cloud wake behind the launching fighter. Wall slides lay clouds against the wall per distance slid, so faster slides leave a denser column. Local and remote players use the same effects.

The local player's wall jump adds a 3 screen-pixel horizontal camera recoil toward the wall and a subtle 1% zoom in, easing in together over 80 ms and returning over 220 ms. Recoil applies to the final camera render transform, after follow smoothing, dead zones, and bounds, so its strength stays consistent across maps and heights. The zoom pulse uses the current resting view at takeoff; height-based zoom pauses during the pulse and resumes gradually over 220 ms afterward. These combine with aim framing, dash zoom, and damage shake without accumulating drift, and respect reduced-motion preferences. Camera feedback clears on input release, spectating, scene shutdown, or camera destruction.

## Dash

The local dash camera eases toward a 2.5% zoom-in pulse based on the resting view when the dash begins. Height-based zoom pauses during the burst, then resumes gradually as the pulse fades, keeping upward and downward dashes as readable as horizontal ones across maps. Dash and wall-jump zoom add together; input release, spectating, and scene cleanup clear both effects. Reduced-motion preferences suppress the pulses.

Press Space with WASD or arrow keys to dash in any of eight directions. With no net directional input, dash horizontally in the direction the character faces. Opposing keys cancel on each axis. Diagonals are normalized. W / Up still jump outside a dash; Space no longer jumps.

Shared movement tuning is in `src/shared/physics/movementPhysics.json`; [Game constants](constants.md) documents ownership and override precedence. Dash applies 590 px/s to the normalized horizontal component and 560 px/s to the normalized vertical component (840 px/s straight down), independent of incoming speed, for a 160 ms burst. Upward and diagonal vertical launch speeds are unchanged. Held movement keys steer grounded bursts at 6500 px/s². Once airborne, steering is disabled for the rest of that burst. Collision and friction can reduce that velocity during the burst. Steering away from contact works immediately; input into a contacted face cannot rebuild blocked velocity. Dash clears old wall-jump control locks, and normal movement resumes as soon as the burst ends. Cooldown lasts 5000 ms from the end of the 160 ms burst and is shared across ground and air. Landing does not refresh it. Gravity pauses during the burst and resumes afterward without replacing the resulting velocity. Excess horizontal speed coasts down with drag (900 px/s² in air, 600 on the ground), while opposite input brakes it sooner.

Wall contact cancels only the blocked velocity component. The blocked component stays cancelled for the rest of the burst; only motion along the surface continues. Ground/ceiling friction slows tangential motion by 600 px/s² during the burst. Walls use proportional vertical drag (rate 1.2/s), which cannot cancel gravity into a stationary hover; wall impact also restores gravity during the burst; normal ground drag continues during the slowdown. Vertical air resistance scales smoothly with speed squared (coefficient 0.0015), weakens near the apex, and fades out throughout coasting. There is no hard velocity threshold or forced stop. Normal gravity handles the return downward; the extra fast-fall gravity multiplier stays off during dash coasting. Jump and wall jump cancel dash coasting. Normal wall slide caps descent without applying inward horizontal velocity or overriding steering. Continuous AABB sweeps cover the whole physics-step displacement, including thin walls and low frame rates, preserve tangential sliding, and respect disabled/one-way faces. The sweep rebuilds contacts and restores pre-separation tangential velocity, with a microscopic clearance to prevent fractional platform landings from creating false side contacts. The server independently sweeps dash/coast position packets against canonical map colliders and grants a bounded, decaying speed allowance.

Movement packets preserve fractional positions to 0.0001 px. The server still clamps positions against surfaces, but ignores subpixel packet rounding when deciding whether to send a correction. Collision corrections include the contacted faces and preserve velocity and acceleration along the surface; they only cancel motion into the struck face. This avoids repeated `Body.reset()` calls clearing both axes on fractional platform tops and sides.

There is no dash damage or invulnerability. Attacks/specials cannot start during the burst; active attacks, control locks, and knockback prevent activation. A compact bottom-center Dash HUD fills over the five-second cooldown after the burst, turns green when full, flashes during activation, and pulses after six seconds ready without use. Battle overlays share the chat button’s stepped pixel frame and chroma mosaic. Fading cyan-white character afterimages and tapered speed streaks follow actual movement, with dense white/cyan segmented fast-fall-style lines aligned to the actual dash direction; stationary wall pressure emits no extra trail. The dash sound plays once on an accepted local launch, including invisible dashes, at volume 0.7. Nearby opponents start at 90% of that level and fade with distance through the shared player-audio utility. The watched fighter gets the full local level in spectator mode. Its pitch varies slightly between uses. See `public/assets/movement/README.md` for the sound source and permission note.

### Adding character animation rows

Add frames to the character/skin atlas named `dashing00`, `dashing01`, etc. (`dash00`, etc. also work). Keep the existing frame size and anchor alignment. The generic animation resolver discovers these names, sorts them numerically, and registers `<texture-key>-dashing` as a one-shot spanning the dash duration. Alternatively, register that animation key explicitly in the character animation module. For skins, add frames to each skin atlas to preserve its appearance. Until the row exists, local dash uses the falling pose; remote rendering uses its normal fallback.

No character sheets are modified by this implementation. Dash activates from the keyboard or the mobile dash button; on mobile the movement stick steers the dash direction. Bots dash to escape pressure, close on enemies at or below half health, dodge predicted attacks, and cover long stretches of safe ground. Navigation includes direct upward/diagonal dashes and jump-then-dash routes for higher ledges and wider gaps. Bots compare those routes with ordinary jumps and use faster climbs when useful. Each planned route uses at most one dash; after landing, the bot replans with its remaining cooldown. The same movement solver verifies takeoff, burst, coast, and a stable landing, and the navigation worker builds the extra routes off the live game loop. Bots reserve their dash during a committed approach/jump so an attack cannot prevent the planned midair activation.

Combat opportunities are checked with delayed observations, with rolls spaced 0.35–0.7 seconds apart. Successful dashes add a randomized 0.25–1.1 second pause after the shared cooldown. Bots still require a useful escape, dodge, pursuit, or travel destination rather than activating whenever ready. Attacks cannot start during the burst, and knockback interrupts it.

### Verification

`node --test tests/botDash.test.js tests/botDashNavigation.test.js` covers bot dash decisions, restraint, landing safety, collision, interruption, and controller execution. `node --test tests/dash.test.js tests/keyBindings.test.mjs` covers direction normalization, ground/air use, facing fallback, cooldown boundaries, interruption/gravity restoration, server replay rejection, and saved-key migration. `npm run build` checks browser bundling. Manual playtesting should tune distance and timing and check diagonal wall/corner contact plus two-client rendering under latency.

### Downward stomp

Straight-down dash launches at 840 px/s (50% faster than the normal 560 px/s dash).
An airborne straight-down dash arms one stomp until the end of its 850 ms coast.
The server resolves the landing against map geometry. `STOMP_RADIUS` and `STOMP_INTERRUPT_MS` in `src/server/core/gameRoomConfig.js` control reach and interruption. It pushes opponents within
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

## Draven's Inferno

Draven takes 60% less incoming damage while channeling Inferno. A translucent,
circular shield with the same shaded shell and reflections as spawn protection
surrounds him for the channel and disappears when it ends or is interrupted. The incoming damage multiplier lives in
`stats.tuning.special.inferno.damageTakenMult` in his shared character definition
and stacks multiplicatively with other damage modifiers.

## Bank Bust: coins in the vault

The mode runs on exactly one number per team, `vaults[team].coins`, and the
server owns it. There is no player wallet, no team gold balance and no separate
vault health: the coins in a vault are simultaneously its survivability and the
team's spending power, and a vault at zero coins is destroyed.

Every movement of that number goes through `applyVaultCoins(team, delta, meta)`
in `src/server/core/gameModes/bankBust/BankBustGameMode.js`. Nothing else may
write `coins`. It clamps the value, marks the vault destroyed at zero, and
appends one entry to `coinEvents`, the single ledger the client renders all coin
feedback from. `meta.reason` says what moved it — `pickup`, `mine`, `deathDrop`,
`centerGold`, `enemyAttack`, `purchase-turret`, `purchase-wall`.

Attack damage comes off the vault one for one: a 1200 hit takes 1200 coins, the
same number it takes off a player's health bar. Every amount in the mode's
economy (mine yield, pickups, centre gold, purchase costs) is on that scale. The
one conversion left is death drops, whose coin is worth 1 to the player's wallet
and `deathDropVaultCoins` when it is banked.

Purchases are paid out of the vault through `spendVaultCoins`, which refuses any
purchase that would leave the vault below `purchaseFloorCoins`. Purchases must also leave strictly positive coins, even if the configured floor is zero, and are refused after the match is finished. That floor is
what stops a team buying itself into a loss; it is a rule about one value, not a
second pool, and the HUD draws it as a mark on the same bar.

When the clock expires, `onTimerExpired` compares the two teams' remaining
coins. Code outside the mode that reads a vault — `damageResolver.js`,
`dravenInfernoAbility.js`, `huntressCombat.js`, `ninjaCombat.js` — reads
`coins`, never `health`.

A vault reaching zero does not end the match on that tick. `evaluateVictoryState`
asks for `VAULT_BUST_FINISH_DELAY_MS` first, because the client draws the bust
from the snapshot showing the vault at zero and finishing at once stopped the
loop before it was sent. `applyVaultCoins` refuses every change during that wait,
so the result is already settled.

Everything the vault does on screen lives in
`src/client/game/modes/bankBust/vaultEffects.js`: the reaction to a hit, the
smoke, sparks and alarm as it empties, and the bust (wind-up, blown-off door, coin
eruption, camera focus on the vault). It is driven by the `coinEvents` ledger and
the vault's coin count, is purely local, and honours reduced motion.

Claimed turret barrels use the replicated server aim angle directly, including
on the first shot and target changes. An unchanged aim does not time out into
an idle sweep; recoil keeps the barrel on the bullet's direction.

### Contested centre gold

`centerGold` is a locked crate on a fixed schedule, not a random drop: it moves
`scheduled -> announced -> active -> cooldown` at one visible site taken from
the map's `objectiveLayout.bankBust.centerGold`. Both teams see the announcement
before it lands, and a drop that could not be reached before the match ends is
not scheduled at all. Several drops per match is the point: no single one
decides the result.

While `active`, the crate is a hit target for either team under the name
`crate:center`. `getObjectiveTargets` in `attackRuntimes/targets.js` hands it to
every attack runtime alongside the enemy vault, and `damageCenterCrate` takes the
damage. Breaking it pays nobody directly: the reward splits into piles thrown
across the hilltop as `randomGold` pickups, which the first player to reach each
one collects into their own vault through `applyVaultCoins` with the reason
`centerGold`. A crate left alone expires and spills nothing. It is not a player,
so hitting it records no combat stats and builds no super. Crate-hunter bots move toward its announced site, attack the active crate,
and compete for its spilled coins.

## Bots and matchmaking

Bots are server participants, not user accounts or browser sessions. Bots can participate in the playable modes, including Bank Bust. Bank Bust uses the objective planner in `src/server/core/bots/bankBust.js`; other modes retain standard combat tactics. Seeded personality preferences vary vault pressure, coin/mine farming, crate hunting, lower-route flanking, player aggression, and home-vault defense. Preferences are reviewed every 30 seconds, independently of think frequency. Each team assigns one dedicated infiltrator per three bots (at least one): roughly two thirds flank and one third rush directly. Other bots retain supporting preferences. Infiltrators prioritize the vault over incidental rewards and bypass more distant defenders, but still respond to immediate contact, recovery needs, and base threats. Active roles adapt: quiet-base defenders push, idle farmers and crate hunters raid, and a nearby bot covers an undefended vault when an observed intruder appears. Defensive alerts linger briefly after a threat disappears to avoid turning back and forth at the boundary. Reachable firing positions pull attackers toward the enemy vault; nearby threats and vault defenders return control to combat tactics, and low-health recovery and poison escape still take precedence. Bots take clear vault/crate shots even without a player target. Mines collect by proximity; turrets and home-side walls use the normal interaction action and authoritative purchase checks. Only a 12% opening willingness roll permits early claiming; the next review occurs 12–28 seconds after match start. Later willingness checks are spaced 8–14 seconds apart, with infiltrators less likely to buy than defenders. Planning and interaction share the same result so frequent thinks cannot force a purchase. Bots recheck the current balance at interaction time, keep the larger of an additional purchase-cost reserve above the mode floor or 35% of the current vault, and refuse purchases that surrender a winning score in the last 15 seconds. They avoid duplicating teammates’ side objectives. Valid objectives retain their exact stance for a minimum commitment window; later switches need a meaningful utility gain. Completed, unaffordable, or unreachable goals release immediately, and defense/recovery can override commitments. The generic team-role planner cannot cancel Bank Bust approaches; local combat uses separate enter/leave distances so distant target changes do not redirect objective travel. Flanking commitments are bounded and reset on death. `tests/botObjectives.test.js` covers planning, shooting priorities, roles, and purchases. Mid-match replacement is not an automatic recovery mechanism.

The party slot UI supports explicit bot slots. Automatic queue filling is separately controlled by `bots.enabled` and `bots.rolloutPercent` in `src/server/lib/runtimeConfig.js` / `runtime-overrides.json`; defaults are disabled and zero. Apply the adaptive-bots migration before enabling it. Admin runtime changes apply live; direct override-file edits require a restart. Disabling filling leaves existing rooms running.

`src/server/core/bots/config.js` owns fill timing and trophy-based difficulty. Ordinary staged seats begin after 5–8.5 seconds; ratings above 3,000 wait at least 20 seconds before staging. Additional seats use randomized intervals. Cohorts are stable by user/party ID. Human grouping preserves ticket/team assignments and assembly revalidates tickets transactionally. Check the matchmaking implementation for the current rating windows and ready-check behavior.

Participants use `participantId` / `isBot`; bots have no account `user_id`. Input identity comes from authenticated sockets. Bots use shared character stats, damage/effects and authoritative projectile runtimes. Results include bot combat statistics, but account rewards go only to humans. Cleanup removes temporary bot participants, never accounts based on names.

Bot battle cards are cosmetic. `src/server/core/bots/playerCards.js` weights the catalog's card rarities by each bot's trophy count, which is generated near the human lobby average. Trophy Road cards appear only once that bot meets their unlock threshold. The bot's saved seed makes its card choice stable from the ready check through match loading; no account ownership or extra database field is involved.

The `src/server/core/bots/` directory owns perception, navigation workers, movement execution, tactics, objectives, profiles and seeded simulation. `characterProfiles.js` defines spacing, aim model and super decisions. Shared map documents supply geometry. Navigation simulates movement and verifies stable landings, including jump/dash routes; actual takeoff state is revalidated. Difficulty scales through trophy anchors up to 4,000, retaining reaction delay, aim error and missed opportunities. Invisible opponents are not tracked by reading their live positions.

Sudden-death routing treats poison exposure as a cost, preserving necessary submerged routes. Ordinary combat positioning continues away from danger; near full coverage, bots stop treating gas as a routing constraint. Headless tests do not establish production balance or browser smoothness.

Huntress bots limit vertical movement prediction to a short window configured in `characterProfiles.js`, so a jump does not make them extrapolate upward velocity over the arrow's entire flight. Horizontal interception, arrow-drop compensation, and cover checks still use the full flight path.

Run `npm run test:bots` and `npm run simulate:bots -- --matrix --seconds=30`. Add `--sudden-death=10` for poison scenarios. The simulator prints tick and per-bot cost on the machine it runs on, graph builds and the slowest bot ticks; run it on the Pi for real numbers, and under `node --cpu-prof` with `scripts/dev/cpuprofile-top.cjs` to find hot spots. `--deterministic` finishes every plan in the tick it starts, so its play fingerprint must match before and after a performance-only change. Test mixed human/bot matches, explicit slots, concurrent queue/cancel/ready requests, abandoned matches, and deployment capacity before expanding automatic fill.

## Damage hitbox debugging

Admins can check **Debug hitboxes** next to **Edit map** in the map picker. The
editor inherits that option, and the checkbox in its playtest settings (the gear beside Playtest) controls the next playtest.
Blue/green outlines show map and physics bodies; pink outlines show server damage
volumes. Ctrl+M hides/shows the overlay during a debug playtest.

`src/shared/combat/runtime/damageHitboxes.js` is the common damage-shape publisher.
It runs only in editor rooms with debug enabled. Normal matches send no additional
hitbox data. The debug transport itself does not alter damage rules; attack
geometry remains controlled by the shared character tuning and collision helpers.

For new attacks:

- Prefer `hitCircleTargets` or `hitRectTargets`; both publish their exact input
  geometry before searching targets, including when no enemies are present.
- Straight projectiles can declare `splashRadius` (Wizard's fireball does):
  the shot stops on the first target it touches, a wall, or the end of its
  range, bursts on the struck player's body centre (or the contact point for a
  wall, mode object or range end), damages every target within that radius of
  the burst once, and
  broadcasts `impactActionType` with the burst point so every client's drawn
  flight stops there.
- A `windup-release` flow can declare `chargeActionType` (Wizard's fireball
  does): while the caster winds up, an `attached-charge` capsule over his head
  and behind his back (`src/shared/characters/wizardCharge.js`, tuned in
  `attack.fireball.charge`) bursts on the first enemy touching it with the
  same damage and splash, and the release is cancelled. Its flow kind is
  `server-internal`, so a client cannot start it on its own. The caster's
  client predicts it with the same shape; other clients burst the charging
  ball from the impact broadcast.
- Straight projectiles can declare `collisionForwardOffset` in character tuning
  when the damaging part of asymmetric artwork is ahead of or behind its motion
  origin. The shared runtime rotates that offset with the attack angle.
- Sprite-sheet attacks can declare `collisionOffsetY` for a world-space vertical
  correction. This preserves their aim direction and forward reach.
- Connected melee weapons should use `hitCapsuleTargets` from the wielder's body
  center to the weapon tip, with the shape defined in
  `src/shared/combat/attackDelivery.js` so the attacker's client predicts the
  same volume (see [Attack delivery](networking.md#attack-delivery)). This prevents a detached head-only box and keeps the
  debug outline identical to the authoritative damage query.
- Dedicated collision protocols must call `exposeDamageHitbox(room, source,
  shape, now, part)` immediately before collision evaluation. Reuse the same
  coordinates/radius as that evaluation. Source IDs must identify each projectile;
  use `part` for independently damaging pieces or sweep segments.
- Supported shapes are `circle` (`x`, `y`, `radius`), `rect` (`left`, `right`,
  `top`, `bottom`), `sweep` (`a`, `b`, `radius`), and `sector` (`x`, `y`, `radius`,
  `innerRadius`, `angle`, `halfSpread`). Angles are radians.
- A new shape kind needs support in `src/client/game/scene/damageHitboxDebug.js` and a test.
  Extend `tests/damageHitboxes.test.js` when adding a new collision protocol.

Generic projectiles, splash rectangles, Thorg's hammer, returning projectiles,
hooks, cones, Ninja shurikens, Huntress arrows, Inferno, turret shots, and sudden
death poison use this API. Attached burn/poison status effects have no separate
spatial collision volume: their originating attack and affected player already
have outlines.

The overlay shows authoritative server samples, so it may trail client-predicted
art. Samples persist for 120 ms to expose impacts occurring between snapshots;
this retention does not extend damage windows. Disconnected/stalled snapshot
streams clear the client overlay after 250 ms. Scene shutdown removes listeners.

Thorg’s regular attack timing is owned by `src/shared/characters/thorg.json`.
Keep the windup, strike, and recovery durations synchronized with the corresponding
poses in `src/shared/characters/thorgAttackFrames.json`; rendering and authoritative
hit detection share that clock. `ammoCooldownMs` controls the interval between attacks.
