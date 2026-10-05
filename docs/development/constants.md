# Game constants

This page maps every tunable value to the one file that owns it. Each value has a single source. Code that needs a number either imports it or derives it from that source, and never keeps its own copy. JSON files can't hold comments, so their fields are described here. JavaScript constants are commented where they are defined.

Rule of thumb: values both client and server need go in `src/shared/`. Values only the server needs go in `src/server/core/gameRoomConfig.js`. Values that belong to one character, powerup, mode, or map go in that thing's content file.

## Quick lookup

| I want to change… | Edit |
| --- | --- |
| Server tick rate, snapshot rate, fallback world size, party join-request timeout | `src/shared/gameConstants.js` |
| Match length, sudden death, regen, powerup spawn cadence, death drops, stomp, anti-cheat limits | `src/server/core/gameRoomConfig.js` |
| Run/jump/wall/dash feel | `src/shared/physics/movementPhysics.json` |
| Ducking (height, speed, damage reduction) | `src/shared/physics/ducking.js` |
| A character's HP, damage, ammo, super charge, hitbox, attack/special tuning | `src/shared/characters/<name>.json` |
| Level-up stat gains, level cap, upgrade prices, default character | `src/shared/characters/characterStats.js` |
| Powerup duration, strength, color, sound | `src/shared/catalogs/powerups.catalog.json` |
| Generic statuses (slow, stun, damage boost) | `src/shared/effectRules.js` |
| Mode team sizes, unlock trophies, Bank Bust vault HP/clock/respawn | `src/shared/catalogs/gameModes.catalog.json` |
| Bank Bust loose gold | `src/server/core/gameModes/bankBust/state.js` |
| Map platforms, player/powerup spawn points, per-map powerup overrides | `src/shared/maps/<id>.json` (edit in Map Studio) |
| Pregame flythrough, countdown, start deadline | `src/shared/matchIntroTiming.js` |
| Trophy gains and losses | `src/shared/catalogs/trophySystem.catalog.json` |
| Bot fill timing | `src/server/core/bots/config.js` (`defaults`) or `runtime-overrides.json` → `bots` |
| Bot skill by trophies | `src/server/core/bots/config.js` (`difficultyForTrophies`) |
| Per-character bot behavior (ranges, super use) | `src/server/core/bots/characterProfiles.js` |
| Reward multipliers, maintenance, bot rollout (live, no deploy) | `runtime-overrides.json` (admin panel writes it) |
| Username/password rules | `src/server/services/auth/authAccountService.js` |

## Shared: `src/shared/gameConstants.js`

These constants are used by the server, the client, bots, and the replicated projectile models.

| Constant | Meaning |
| --- | --- |
| `SERVER_TICK_HZ` | Server simulation rate (60). |
| `FIXED_DT_MS` | Derived as `1000 / SERVER_TICK_HZ`. Used by the room loop, bots, Ninja/Huntress projectile replays, and client snapshot interpolation. |
| `SNAPSHOT_EVERY_TICKS` | Ticks between player snapshots (2 → 30 Hz). The client's expected snapshot spacing is derived from it. |
| `WORLD_STATE_EVERY_TICKS` | Ticks between world-state packets (8 → 7.5 Hz). |
| `WORLD_BOUNDS` | Fallback playfield (`width`, `height`, `margin`) for rooms whose map defines no world rect. Gloop's client-side travel limits are derived from it. |
| `PARTY_JOIN_REQUEST_TIMEOUT_MS` | Lifetime of a party join request. The server enforces it and the client shows it as a countdown. |

## Server match tuning: `src/server/core/gameRoomConfig.js`

The file is split into commented sections:

- **Match clock and sudden death:** `GAME_DURATION_MS`, the `SD_*` poison-rise values, `SUDDEN_DEATH_MAX_MS`, `ALL_DEAD_GAME_OVER_DELAY_MS`, `ABANDON_MATCH_GRACE_MS`.
- **Passive regen:** `REGEN_DELAY_MS`, `REGEN_TICK_MS`, `REGEN_MISSING_RATIO`, `REGEN_MIN_ABS`. `GameRoom` copies these onto `room.REGEN_*` so tests can override them per room.
- **Powerup spawning:** interval, starting count, max active, pickup radius, despawn, omen, spawn lift. A map can override despawn, omen, and lift in its `settings`. Spawn *points* come from each map's `spawns.powerups`.
- **Derived from the powerup catalog:** shockwave radius/force, health regen, poison DPS, freeze multipliers. Don't edit these here; edit the catalog.
- **Death drops:** lifetime, blink, pickup radius, coin/gem ranges, launch velocities.
- **Combat rules:** `STOMP_RADIUS`, `STOMP_INTERRUPT_MS`, `DUPLICATE_HIT_WINDOW_MS`. `NINJA_SWARM_HIT_DAMAGE` is derived from `ninja.json`.
- **Anti-cheat and lag compensation:** hit rewind and future tolerance, position history, movement plausibility budget, action spam limits, melee facing tolerance, `ATTACK_MAX_DIST_MAP`. Keep each max distance a little above that attack's real reach in its character JSON.

## Movement: `src/shared/physics/movementPhysics.json`

The local player, the server's movement validation, and the bot physics all read this file.

| Field | Meaning |
| --- | --- |
| `maxSpeed` | Top run speed (px/s). |
| `accel` / `airAccel` | Run acceleration on the ground / in the air (px/s²). |
| `dragGround` / `dragAir` | Deceleration with no input (px/s²). |
| `gravity` | Downward acceleration (px/s²). |
| `fallGravityFactor` | Gravity multiplier while falling. Higher values give a snappier arc. |
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
| `wallKickFull` | Horizontal speed of a wall kick (px/s). |
| `wallKickVerticalMult` | Vertical scale on a wall kick. |
| `wallKickLockMs` | Steering lockout after a wall kick. |
| `minSpeedMult` / `maxSpeedMult` | Clamp on combined slow/haste effects. |
| `dashSpeed` / `dashDownSpeed` | Dash burst speed horizontally / straight down. |
| `dashDurationMs` | Length of the dash burst. |
| `dashCooldownMs` | Time between dashes. |
| `dashMaxSpeed` | Speed cap during and after a dash. |
| `dashSteerAccel` | How fast you can steer mid-dash. |
| `dashCoastMs` / `dashCoastDrag` | After the burst, momentum fades over `dashCoastMs` at this drag. |
| `dashSurfaceDrag` | Drag while dashing along the ground or a ceiling. |
| `dashWallDragRate` | Vertical damping while dashing into a wall. |
| `dashVerticalResistance` | Damping on vertical speed during a dash. |

## Characters: `src/shared/characters/<name>.json`

| Path | Meaning |
| --- | --- |
| `stats.baseHealth`, `baseDamage`, `specialBaseDamage` | Level 1 values. Per-level gains are in `characterStats.js`. |
| `stats.ammoCapacity`, `ammoCooldownMs`, `ammoReloadMs` | Shots held, minimum gap between shots, and reload time per shot. |
| `stats.specialChargeHits` | Basic hits needed to fill the super. |
| `stats.specialChargePerHit` | Charge a super hit gives back, as a fraction of one basic hit. |
| `stats.spriteScale`, `stats.body` | Render scale and hitbox shrink and offset. Defaults are in `characterTuning.js` (`CHARACTER_BODY_DEFAULTS`). |
| `stats.tuning.attack.aim`, `stats.tuning.special.aim` | Aim reticle shape and range. Draven's inferno also uses its `aim.radius` as its damage radius. |
| `stats.tuning.attack.<name>` | Basic-attack projectile or melee numbers (speed, range, radius, timings). |
| `stats.tuning.special.<name>` | Super numbers, for example `ninja.swarm`, `draven.inferno` (now includes `damageTickMs`, `damageScale`, `minDamagePerTick`, `firstDamageDelayMs`, `bobWaveMs`), `wizard.arcaneSurge` (`powerScale`, `durationScale`, `castMs`, `beamMs`, `teammateBlockedPowerups`, `fallbackPowerup`), `gloop.hook`, and Thorg's `rageDurationMs` / `rageModifiers` / `knockback`. |
| `presentation` | Client-only visual settings (art scale, animation locks, dash poses). |
| `attacks` | Network action descriptors. Contributors normally don't edit these. |

The Ninja swarm's per-shard fan (spawn offset, arc, speed) is computed once by `swarmShard()` in `src/shared/characters/ninjaProjectile.js`. The server, bots, and client renderer all call it.

## Powerups: `src/shared/catalogs/powerups.catalog.json`

Each powerup has these fields: `assetDir`, `color` (main tint), `lightColor` (HUD badge fill), `durationMs`, optional `tickVolume`/`touchVolume`, `modifiers` (`damageMult`, `damageTakenMult`, `speedMult`, `jumpMult`), and type-specific values (`healingPerSecond`, `damagePerSecond`, shockwave `radius`/`forceX`/`forceY`). The list of types comes from the catalog's keys. Adding an entry adds the powerup to spawns, to the HUD badges (`statusIconStack.js`), and to client colors (`powerupConfig.js`).

Wizard's Arcane Surge multiplies `durationMs` and the modifiers by `wizard.json → special.arcaneSurge`.

## Client-only feel and presentation

These values only change what the local player sees or feels, so each one stays next to its feature, with a comment:

- Netcode smoothing: `src/client/game/match/snapshotBuffer.js` (`DEFAULT_SNAPSHOT_BUFFER_CONFIG`), `src/client/game/scene/remoteSmoothing.js`, `src/client/game/players/movementCorrection.js`
- Camera and shake: `src/client/game/scene/cameraDynamics.js`, `src/client/game/scene/matchIntro.js` (`FOLLOW_LERP`, pregame audio)
- Mouse and aim: `src/client/game/scene/combatMouse.js`, `src/client/game/characters/shared/attackAim.js`
- Movement VFX: `src/client/game/scene/effects.js` (`MOVEMENT_VFX_CONFIG`)
- Render order: `src/client/game/scene/renderLayers.js`
- Viewport: `src/client/pages/game.js` (`BASE_GAME_WIDTH/HEIGHT`, the design resolution)
- Storage keys that more than one module uses: `src/client/lib/storageKeys.js`

## Live overrides: `runtime-overrides.json`

The admin panel writes this file at runtime and the server reads it without a deploy. It holds `maintenanceMode`/`maintenanceUntil`, `bots` (`enabled`, `rolloutPercent`, plus any `config.js` timing default), `announcements`, `rewardMultipliers`, `rewardFloor`, and `rewardCeiling`.
