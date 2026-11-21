# Game constants

This page maps the main tuning domains to their owning files. Shared values are imported or derived from those owners; feature-local constants remain beside their implementation. The defaults table is generated from code. Check the running configuration when diagnosing a live match. JSON files can't hold comments, so their fields are described here. JavaScript constants are commented where they are defined.

Rule of thumb: values both client and server need go in `src/shared/`. Cross-cutting server match values go in `src/shared/combat/matchConfig.js`; service-specific limits remain in their services. Values that belong to one character, powerup, mode, or map go in that thing's content file.

## Quick lookup

| I want to change… | Edit |
| --- | --- |
| Server tick rate, snapshot rate, world margin and fall-out depth, party join-request timeout | `src/shared/gameConstants.js` |
| Match length, sudden death, regen, powerup spawn cadence, death drops, stomp, anti-cheat limits | `src/shared/combat/matchConfig.js` |
| Run/jump/wall/dash feel | `src/shared/physics/movementPhysics.json` |
| Ducking (height, speed, damage reduction) | `src/shared/physics/ducking.js` |
| A character's HP, damage, ammo, super charge, hitbox, attack/special tuning | `src/shared/characters/<name>.json` |
| Level-up stat gains, level cap, upgrade prices, default character and ammo fallbacks | [characterStats.js](../../src/shared/characters/characterStats.js) |
| Powerup duration, strength, color, sound | `src/shared/catalogs/powerups.catalog.json` |
| Generic status defaults (slow, stun, damage boost) | `src/shared/catalogs/statusEffects.catalog.cjs` |
| Mode team sizes, unlock trophies, Bank Bust vault coins/clock/respawn | `src/shared/catalogs/gameModes.catalog.json` |
| Bank Bust vault dimension fallbacks and loose gold arrival timing | [bankBustSettings.js](../../src/shared/bankBustSettings.js) |
| Bank Bust loose gold economy and centre crate defaults | [bankBust/state.js](../../src/server/core/gameModes/bankBust/state.js) |
| Bank Bust purchase costs, mine yields, centre crate overrides and vault geometry | `objectiveLayout.bankBust` in `src/shared/maps/4.json` (built by `scripts/maps/build-iron-junction.cjs`) |
| Map platforms, player/powerup spawn points, per-map powerup overrides | `src/shared/maps/<id>.json` (edit in Map Studio) |
| Pregame flythrough, countdown, start deadline | `src/shared/matchIntroTiming.js` |
| Trophy gains/losses, reward track and unlock milestones | `src/shared/catalogs/trophySystem.catalog.json` |
| Bot fill timing | `src/server/services/match/bots/config.js` (`defaults`) or `runtime-overrides.json` → `bots` |
| Bot skill by trophies | `src/server/services/match/bots/config.js` (`difficultyForTrophies`) |
| Per-character bot behavior (ranges, super use) | `src/shared/combat/characterProfiles.js` |
| Reward multipliers, maintenance, bot rollout (live through admin updates) | `runtime-overrides.json` (admin panel writes it) |
| Username/password, chat, and player-report message limits | [textRules.js](../../src/shared/social/textRules.js) |
| Signup and account verification code format and resend delay | [shared form rules](../../src/shared/social/verificationCode.js) |
| Verification code generation, lifetime and attempt limit | [verification policy](../../src/server/services/email/verificationCode.js) |
| Verification send window and address-correction exception | [email cooldown](../../src/server/services/email/emailCooldown.js) |
| Maximum number of players ranked on the leaderboard | [leaderboardService.js](../../src/server/services/trophies/leaderboardService.js) |
| Support request and feedback validation | [supportRules.js](../../src/shared/site/supportRules.js) |
| Cosmetic rarity identifiers and sort order | [rarities.js](../../src/shared/catalogs/rarities.js) |
| Suspension display cookies shared by the server and the banned page | [accountBan.js](../../src/shared/moderation/accountBan.js) |
| Events exchanged between browser modules | [browserEvents.js](../../src/client/lib/browserEvents.js) |
| Browser storage keys used by multiple features or tools | [storageKeys.js](../../src/shared/storageKeys.js) |
| Artwork version hashes for portraits, badge animations and player cards | [asset-version.cjs](../../scripts/art/asset-version.cjs) |
| Versioned bundle filenames and compression formats for build, pruning and HTTP caching | [bundleVersion.js](../../src/shared/net/bundleVersion.js) |

## Shared simulation and network

See [gameConstants.js](../../src/shared/gameConstants.js) for definitions.

The room, client, bots, and Ninja and Sparrow projectile models share the fixed simulation step. Gloop’s slimeball uses its own finer integration step. [gloopProjectile.js](../../src/shared/characters/gloopProjectile.js)

| Constant | Meaning |
| --- | --- |
| `SERVER_TICK_HZ` | Authoritative simulation ticks per second. |
| `FIXED_DT_MS` | Derived as `1000 / SERVER_TICK_HZ`. Used by the room loop, bots, Ninja/Sparrow projectile replays, and client snapshot interpolation. |
| `SNAPSHOT_EVERY_TICKS` | Default ticks between player snapshots. The server converts `BB_SNAPSHOT_HZ` to a whole tick interval through `snapshotEveryTicksFor()` and sends that interval in `game:init`. |
| `WORLD_STATE_EVERY_TICKS` | Ticks between world-state packets. |
| `MAX_RENDER_DELAY_MS` | Cap on client snapshot interpolation delay and on the reported render delay used for hit validation. |
| `FALL_OUT_DEPTH` | Distance below the world bottom at which players are eliminated. |
| `WORLD_MARGIN` | How far past the world edges players, hooks and projectiles may travel. Each mode's world rectangle lives in [arenas.json](../../src/shared/maps/arenas.json). |
| `PARTY_JOIN_REQUEST_TIMEOUT_MS` | Lifetime of a party join request. The server enforces it and the client shows it as a countdown. |

## Match tuning

[matchConfig.js](../../src/shared/combat/matchConfig.js) defines these groups.

- **Match clock and sudden death:** `GAME_DURATION_MS`, the `SD_*` poison-rise values, `SUDDEN_DEATH_MAX_MS`, `ALL_DEAD_GAME_OVER_DELAY_MS`, `ABANDON_MATCH_GRACE_MS`.
- **Passive regen:** `REGEN_DELAY_MS`, `REGEN_TICK_MS`, `REGEN_MISSING_RATIO`, `REGEN_MIN_ABS`. `GameRoom` copies these onto `room.REGEN_*` so tests can override them per room.
- **Powerup spawning:** interval, first-spawn delay, starting count, max active, pickup radius, despawn, omen, spawn lift. Map documents configure each variant's `powerups` block (interval, max active, pickup radius, despawn, omen and lift); `geometryFromMap` exposes these as runtime `geometry.settings`. Spawn points come from the variant's `spawns.powerups`. The initial count remains the room default.
- **Derived from the powerup catalog:** shockwave radius/force, health regen, poison DPS, freeze multipliers. Don't edit these here; edit the catalog.
- **Death drops:** lifetime, blink, pickup radius, coin/gem ranges, launch velocities.
- **Combat rules:** `STOMP_RADIUS`, `STOMP_INTERRUPT_MS`, `DUPLICATE_HIT_WINDOW_MS`. `NINJA_SWARM_HIT_DAMAGE` is derived from `ninja.json`.
- **Anti-cheat and lag compensation:** hit rewind cap, position history, attack replay window, movement plausibility budget, action spam limits, melee facing tolerance, `ATTACK_MAX_DIST_MAP`. The released-shot delivery policy reads the same rewind ceiling from this file. The distance table is a validation policy. Keep each max distance a little above that attack's real reach in its character JSON. [attackDelivery.js](../../src/shared/combat/attackDelivery.js)

## Movement: `src/shared/physics/movementPhysics.json`

The local player, the server's movement validation, and the bot physics all read this file.

| Field | Meaning |
| --- | --- |
| `maxSpeed` | Top run speed (px/s). |
| `accel` / `airAccel` | Run acceleration on the ground / in the air (px/s²). |
| `dragGround` / `dragAir` | Deceleration with no input (px/s²). |
| `gravity` | Downward acceleration (px/s²). |
| `maxVerticalSpeed` | Normal vertical speed cap (px/s); the server's vertical movement allowance adds 10% headroom. Scale with jump speed and gravity to preserve capped jump airtime. |
| `fallGravityFactor` | Gravity multiplier while falling. Higher values give a snappier arc. |
| `fallGravityMinSpeed` | Downward speed (px/s) that enables the falling gravity multiplier; scales with jump speed and gravity. |
| `jumpSpeed` | Jump launch speed (px/s). |
| `jumpLaunchSpeedMult` | Scale on `jumpSpeed` when the jump starts. |
| `jumpStartSpeedRatio` / `jumpRampMs` | The jump begins at this fraction of launch speed and ramps to full over `jumpRampMs`. |
| `jumpBoost` | Extra jump speed added in proportion to horizontal speed. |
| `coyoteTimeMs` | Grace after leaving a ledge when a jump still counts. |
| `wallJumpCooldownMs` | Minimum time between wall jumps. |
| `wallSlideMaxFallSpeed` | Fall-speed cap while wall sliding. |
| `wallSlideBrakeFallSpeed` | Lower cap while holding down on a wall. |
| `wallSlideSnapDistance` | How close (px) to a wall counts as touching it. |
| `wallSlideAttachDelayMs` | Delay before a wall slide engages. |
| `wallSlideReentryDelayMs` | Delay before re-attaching to a wall after leaving it. |
| `wallJumpHorizontalGracePx` | Extra horizontal reach (px) for detecting a wall jump. |
| `wallMinFaceHeight` | A side must rise this far (px) above the ground under the body to be wall-slid on or wall-jumped off. Shorter ones are steps. |
| `wallKickFull` | Horizontal speed of a wall kick (px/s). |
| `wallKickVerticalBonus` / `wallKickMinVerticalSpeed` | Extra speed added to `jumpSpeed` / minimum speed before applying the vertical wall-kick multiplier (px/s). Scale with jump speed and gravity. |
| `wallKickVerticalMult` | Vertical scale on a wall kick. |
| `wallKickLockMs` | Steering lockout after a wall kick. |
| `minSpeedMult` / `maxSpeedMult` | Clamp on combined slow/haste effects. |
| `dashSpeed` / `dashDownSpeed` | Dash vertical launch speed, applied to the normalized vertical component / the straight-down override (px/s). |
| `dashDurationMs` | Length of the dash burst. |
| `dashCooldownMs` | Cooldown after the burst; ordinary launch-to-launch spacing is `dashDurationMs + dashCooldownMs`. |
| `dashHorizontalSpeed` | Horizontal dash launch speed and horizontal burst cap (px/s); `dashSpeed` still sets the vertical component. |
| `dashMaxSpeed` | Vertical burst cap; straight-down vertical motion uses `dashDownSpeed` instead. Coast/normal movement restore their own limits. |
| `dashSteerAccel` | Grounded burst steering acceleration (px/s²). Steering stops once that burst becomes airborne. |
| `dashCoastMs` / `dashCoastDrag` / `dashGroundCoastDrag` | Maximum coast window (ms) and horizontal deceleration (px/s²) while coasting in the air or on the ground. Interruption can end coasting sooner. |
| `dashSurfaceDrag` | Drag while the dash burst runs along the ground or a ceiling. |
| `dashWallDragRate` | Vertical damping while dashing into a wall. |
| `dashVerticalResistance` | Speed-dependent vertical resistance coefficient; its contribution fades during coasting. |

## Characters: `src/shared/characters/<name>.json`

| Path | Meaning |
| --- | --- |
| `stats.baseHealth`, `baseDamage`, `specialBaseDamage` | Level 1 values. Per-level gains are in `characterStats.js`. |
| `stats.ammoCapacity`, `ammoCooldownMs`, `ammoReloadMs` | Shots held, minimum gap between shots, and reload time per shot. |
| `stats.specialChargeHits` | Basic hits needed to fill the super. |
| `stats.specialChargePerHit` | Charge a super hit gives back, as a fraction of one basic hit. |
| `stats.spriteScale`, `stats.body` | Render scale and hitbox shrink and offset. Defaults are in `characterTuning.js` (`CHARACTER_BODY_DEFAULTS`). |
| `stats.tuning.attack.aim`, `stats.tuning.special.aim` | Aim reticle shape and range. `reticleScale`, `radiusY`, and `reticleOffsetY` control a round reticle's drawn size and placement without changing range or damage. Draven's inferno also uses its `aim.radius` as its damage radius. |
| `stats.tuning.attack.<name>` | Basic-attack projectile or melee numbers (speed, range, radius, timings). |
| `stats.tuning.special.<name>` | Super numbers, including `swarm` in [Ninja](../../src/shared/characters/ninja.json), `inferno` in [Draven](../../src/shared/characters/draven.json), `arcaneSurge` in [Ozzy](../../src/shared/characters/ozzy.json), `hook` in [Gloop](../../src/shared/characters/gloop.json), and `rageDurationMs`, `rageModifiers` and `knockback` in [Thorg](../../src/shared/characters/thorg.json). |
| `presentation` | Client-only visual settings (art scale, animation locks, dash poses). |
| `attacks` | Network action descriptors and authoritative runtime selection. Update these when adding or changing an attack mechanism; keep action IDs and damage types aligned with emitters and validators. |

Sparrow's displayed basic damage is the full three-arrow volley; actual contacts use `stats.tuning.attack.arrowSpread.damagePerArrow`. Keep `stats.baseDamage` consistent with the arrow count and per-arrow damage when balancing her basic attack. Burning Volley uses its separate `damagePerArrow` field. Each attack's `aim.quickTargetOffsetY` sets its default target height relative to the aim anchor (positive points down); the basic and super defaults aim slightly below their anchors.

The [shared Ninja projectile model](../../src/shared/characters/ninjaProjectile.js) uses `swarmShard()` inside `launch()` to compute each shard's spawn offset, arc and speed. [Authoritative combat](../../src/shared/combat/runtime/ninjaCombat.js) and [client prediction](../../src/client/game/characters/ninja/network.js) call `launch()`.

## Powerups: `src/shared/catalogs/powerups.catalog.json`

Each powerup has these fields: `assetDir`, `color` (main tint), `lightColor` (HUD badge fill), `durationMs`, optional `tickVolume`/`touchVolume`, `modifiers` (`damageMult`, `damageTakenMult`, `speedMult`, `jumpMult`), and type-specific values (`healingPerSecond`, `damagePerSecond`, shockwave `radius`/`forceX`/`forceY`). The list of types comes from the catalog's keys. The catalog derives type/color/preload lists. A working new powerup also needs its server effect definition, assets, validation and applicable map configuration; see [contributing](contributing.md).

Ozzy's Arcane Surge reads `stats.tuning.special.arcaneSurge` in `ozzy.json`. Duration scales by `durationScale`. For rage, shield and gravity boots, strength scales the modifier's distance from neutral: `1 + (baseModifier - 1) * powerScale`, clamped nonnegative. Health healing scales its per-second amount separately. This is not direct multiplication of every modifier.

## Client-only feel and presentation

These values only change what the local player sees or feels, so each one stays next to its feature, with a comment:

- Netcode smoothing: `src/client/game/match/snapshotBuffer.js` (`DEFAULT_SNAPSHOT_BUFFER_CONFIG`), `src/client/game/scene/remoteSmoothing.js`, `src/client/game/players/movementCorrection.js`
- Camera and shake: `src/client/game/scene/cameraDynamics.js`, `src/client/game/scene/matchIntro.js` (`FOLLOW_LERP`, pregame audio)
- Mouse and aim: `src/client/game/scene/combatMouse.js`, `src/client/game/characters/shared/attackAim.js`
- Movement VFX: `src/client/game/scene/effects.js` (`MOVEMENT_VFX_CONFIG`)
- Movement clouds: `src/client/game/scene/clouds/` (simulation limits in `cloudSim.js`, palette in `cloudRaster.js`, cloud pixel size in `cloudLayer.js`, shape sizes, speeds and per-action opacity in `cloudEmitters.js`, layer opacity in `cloudLayer.js`)
- Render order: `src/client/game/scene/renderLayers.js`
- Viewport dimensions and resize policy (`GAME_VIEW`) [gameViewport.js](../../src/client/game/scene/gameViewport.js)
- Storage keys and their client wrapper: `src/shared/storageKeys.js`, `src/client/lib/storageKeys.js`

## Live overrides: `runtime-overrides.json`

The admin panel uses [the runtime configuration service](../../src/server/lib/runtimeConfig.js) to update memory and persist overrides to this file. The service reads it at startup. Direct file edits require a restart. Maintenance status comes from `maintenanceUntil`. Queue filling merges `bots` overrides into [bot defaults](../../src/server/services/match/bots/config.js). [Reward settlement](../../src/server/services/match/rewardSettlement.js) reads `rewardMultipliers`, `rewardFloor` and `rewardCeiling`.

## Constant ownership in lint

`npm run lint` checks declarations in `src/` through
`bro-battles/constant-owners`. The rule reads uppercase scalar
export names from the registered gameplay, account, support and build policy modules. A variable
with one of those exact names and a literal initializer, including arithmetic
on literals, must be declared in its owner. Consumers can import the name,
alias it, or calculate a value from an imported setting.
[Rule and tuning owners](../../scripts/lint/constant-owners.mjs)

The rule checks names, so it cannot detect a copy under another name. Object
fields, JSON content, unexported constants, and files outside `src/` are outside
its scope. Add new cross-layer tuning modules to the rule's owner list when their
exported scalar names should be enforced.

## Default values and precedence

Run `node scripts/dev/print-constants.cjs --write` to refresh the table after tuning changes. CI runs `node scripts/dev/print-constants.cjs --check` to detect drift.

<!-- BEGIN GENERATED DEFAULTS -->
| Area | Code defaults |
| --- | --- |
| Simulation and network | 60 Hz simulation, player snapshot tick interval 1 (60 Hz), world state every 8 ticks (7.5 Hz), maximum render delay 115 ms |
| World and party | 400 px world margin, elimination 50 px below the world, join request expires after 15 s |
| Duels clock and sudden death | 150 s regular time, poison rises at 15 px/s (×2.2 for 12 s), 65 poison damage/s, 80 s sudden-death cap, 500 ms timer broadcast interval, 3 s elimination finish delay, 15 s all-human departure grace |
| Passive regen | 3.8 s out of combat, every 1.5 s for 25% of missing health, minimum 85 HP per tick and capped at max health |
| Powerup spawns | 25 s interval, 2 first spawns after 5 s, 3 active cap, 34 px pickup radius, 10 s despawn, 2 s omen, 22 px anchored spawn lift |
| Death drops | 12 s lifetime, 3 s blinking, 110 px pickup radius, 2–4 coins, 0–1 gems |
| Hit checks | 300 ms rewind cap, 1 s / 128 history samples, 80 ms duplicate-hit window, 12 s runtime action-ID and Sparrow result retention, 110 px stomp radius and 300 ms interruption |
| Movement | 260 px/s run speed, 3000/3300 px/s² ground/air acceleration, 990 px/s² gravity, 506 px/s jump speed parameter, 660/670 px/s horizontal/vertical dash launch components (938 px/s straight down), 160 ms burst, 5 s cooldown, up to 850 ms coast with 1600/900 px/s² ground/air drag |
| Ducking | Body height ×0.55, movement ×0.25, 50 ms minimum hold, 100 ms reentry delay |
| Character upgrades | Level cap 10. Next-level coin costs from level 1 in order: 150, 300, 550, 900, 1400, 2100, 3000, 4200, 5800 |
| Bank Bust mode | 20000 starting vault coins, 25 vault coins per banked death-drop coin, 1500 purchase floor, 25% low vault warning, 210 s match, 3.5 s respawn, 250 peak trophies to unlock, 1.8 s vault bust finish delay |
| Bank Bust loose gold | 5 pickups max, 250 coins each, 42 px pickup radius, 3.6 s spawn interval, 1.3 s arrival animation, claimable after 0.5 s, coin event retention 1.8 s |
| Bank Bust centre crate | default 2000 HP and 2000 coins in 5 piles, first drop after 45 s, 50 s spawn-to-spawn interval, 8 s advance warning, 30 s crate lifetime |
| Bro Ball touches | 6 px of extra reach for passive player contact, plus 8 px above the head |
<!-- END GENERATED DEFAULTS -->

- For the gain percentages and rounding applied to each level-1 stat, see `STANDARD_LEVEL_GAIN_FRACTION`, `MASTERY_LEVEL_GAIN_FRACTION` and `levelGain()` in [characterStats.js](../../src/shared/characters/characterStats.js).
- For the ducking damage multiplier, see `DUCK_DAMAGE_TAKEN_RATIO` in [ducking.js](../../src/shared/physics/ducking.js).
- For the Bank Bust crate's fallback health and reward, see `createCenterGoldState()` in [state.js](../../src/server/core/gameModes/bankBust/state.js). The map may supply `centerGold.health` and `centerGold.reward`. Iron Junction's crate, turret costs, wall costs and mine yields are in `objectiveLayout.bankBust` in the [Iron Junction map](../../src/shared/maps/4.json).

The published revision takes precedence over a legacy override, which takes precedence over the shipped map. Maps can supply world geometry and powerup settings. Mode settings supply Bank Bust's clock. Character level and active effects change resolved stats. Admin settings can change reward multipliers, limits and bot filling. Review saved overrides and rebuild or restart the affected client and server before comparing behavior.

When changing a shared value, check its consumers and the related guide: [gameplay](gameplay.md), [networking](networking.md), [progression](progression.md), or [maps](maps.md). Keep art-source measurements in provenance separate from gameplay tuning.
