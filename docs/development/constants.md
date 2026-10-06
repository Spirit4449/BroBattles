# Game constants

This page maps the main tuning domains to their owning files. Shared values are imported or derived from those owners; feature-local constants remain beside their implementation. Numeric defaults below were checked against the source on 2026-10-05 and are not a substitute for the running configuration. JSON files can't hold comments, so their fields are described here. JavaScript constants are commented where they are defined.

Rule of thumb: values both client and server need go in `src/shared/`. Cross-cutting server match values go in `src/server/core/gameRoomConfig.js`; service-specific limits remain in their services. Values that belong to one character, powerup, mode, or map go in that thing's content file.

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
| Trophy gains/losses, reward track and unlock milestones | `src/shared/catalogs/trophySystem.catalog.json` |
| Bot fill timing | `src/server/core/bots/config.js` (`defaults`) or `runtime-overrides.json` → `bots` |
| Bot skill by trophies | `src/server/core/bots/config.js` (`difficultyForTrophies`) |
| Per-character bot behavior (ranges, super use) | `src/server/core/bots/characterProfiles.js` |
| Reward multipliers, maintenance, bot rollout (live through admin updates) | `runtime-overrides.json` (admin panel writes it) |
| Username/password rules | `src/server/services/auth/authAccountService.js` |

## Shared: `src/shared/gameConstants.js`

These constants are used by the server, the client, bots, and the replicated projectile models.

| Constant | Meaning |
| --- | --- |
| `SERVER_TICK_HZ` | Server simulation rate (60). |
| `FIXED_DT_MS` | Derived as `1000 / SERVER_TICK_HZ`. Used by the room loop, bots, Ninja/Huntress projectile replays, and client snapshot interpolation. |
| `SNAPSHOT_EVERY_TICKS` | Ticks between player snapshots (2 → 30 Hz). The client's expected snapshot spacing is derived from it. |
| `WORLD_STATE_EVERY_TICKS` | Ticks between world-state packets (8 → 7.5 Hz). |
| `WORLD_MARGIN` | How far past the world edges players, hooks and projectiles may travel. Each mode's world rectangle lives in `src/shared/maps/arenas.json`. |
| `PARTY_JOIN_REQUEST_TIMEOUT_MS` | Lifetime of a party join request. The server enforces it and the client shows it as a countdown. |

## Server match tuning: `src/server/core/gameRoomConfig.js`

The file is split into commented sections:

- **Match clock and sudden death:** `GAME_DURATION_MS`, the `SD_*` poison-rise values, `SUDDEN_DEATH_MAX_MS`, `ALL_DEAD_GAME_OVER_DELAY_MS`, `ABANDON_MATCH_GRACE_MS`.
- **Passive regen:** `REGEN_DELAY_MS`, `REGEN_TICK_MS`, `REGEN_MISSING_RATIO`, `REGEN_MIN_ABS`. `GameRoom` copies these onto `room.REGEN_*` so tests can override them per room.
- **Powerup spawning:** interval, starting count, max active, pickup radius, despawn, omen, spawn lift. Map documents configure each variant's `powerups` block (interval, max active, pickup radius, despawn, omen and lift); `geometryFromMap` exposes these as runtime `geometry.settings`. Spawn points come from the variant's `spawns.powerups`. The initial count remains the room default.
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
| `wallKickFull` | Horizontal speed of a wall kick (px/s). |
| `wallKickVerticalBonus` / `wallKickMinVerticalSpeed` | Extra speed added to `jumpSpeed` / minimum speed before applying the vertical wall-kick multiplier (px/s). Scale with jump speed and gravity. |
| `wallKickVerticalMult` | Vertical scale on a wall kick. |
| `wallKickLockMs` | Steering lockout after a wall kick. |
| `minSpeedMult` / `maxSpeedMult` | Clamp on combined slow/haste effects. |
| `dashSpeed` / `dashDownSpeed` | Dash burst speed in any normalized direction / the straight-down override (px/s). |
| `dashDurationMs` | Length of the dash burst. |
| `dashCooldownMs` | Cooldown after the burst; ordinary launch-to-launch spacing is `dashDurationMs + dashCooldownMs`. |
| `dashMaxSpeed` | Per-axis burst cap; straight-down vertical motion uses `dashDownSpeed` instead. Coast/normal movement restore their own limits. |
| `dashSteerAccel` | Grounded burst steering acceleration (px/s²). Steering stops once that burst becomes airborne. |
| `dashCoastMs` / `dashCoastDrag` | Maximum coast window (ms) / airborne horizontal deceleration (px/s²). Ground coast uses `dashSurfaceDrag`; interruption can end coasting sooner. |
| `dashSurfaceDrag` | Drag while dashing along the ground or a ceiling. |
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
| `stats.tuning.attack.aim`, `stats.tuning.special.aim` | Aim reticle shape and range. Draven's inferno also uses its `aim.radius` as its damage radius. |
| `stats.tuning.attack.<name>` | Basic-attack projectile or melee numbers (speed, range, radius, timings). |
| `stats.tuning.special.<name>` | Super numbers, for example `ninja.swarm`, `draven.inferno` (now includes `damageTickMs`, `damageScale`, `minDamagePerTick`, `firstDamageDelayMs`, `bobWaveMs`), `wizard.arcaneSurge` (`powerScale`, `durationScale`, `castMs`, `beamMs`, `teammateBlockedPowerups`, `fallbackPowerup`), `gloop.hook`, and Thorg's `rageDurationMs` / `rageModifiers` / `knockback`. |
| `presentation` | Client-only visual settings (art scale, animation locks, dash poses). |
| `attacks` | Network action descriptors and authoritative runtime selection. Update these when adding or changing an attack mechanism; keep action IDs and damage types aligned with emitters and validators. |

The Ninja swarm's per-shard fan (spawn offset, arc, speed) is computed once by `swarmShard()` in `src/shared/characters/ninjaProjectile.js`. The server, bots, and client renderer all call it.

## Powerups: `src/shared/catalogs/powerups.catalog.json`

Each powerup has these fields: `assetDir`, `color` (main tint), `lightColor` (HUD badge fill), `durationMs`, optional `tickVolume`/`touchVolume`, `modifiers` (`damageMult`, `damageTakenMult`, `speedMult`, `jumpMult`), and type-specific values (`healingPerSecond`, `damagePerSecond`, shockwave `radius`/`forceX`/`forceY`). The list of types comes from the catalog's keys. The catalog derives type/color/preload lists. A working new powerup also needs its server effect definition, assets, validation and applicable map configuration; see [contributing](contributing.md).

Wizard's Arcane Surge reads `stats.tuning.special.arcaneSurge` in `wizard.json`. Duration scales by `durationScale`. For rage, shield and gravity boots, strength scales the modifier's distance from neutral: `1 + (baseModifier - 1) * powerScale`, clamped nonnegative. Health healing scales its per-second amount separately. This is not direct multiplication of every modifier.

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

The admin panel calls the runtime configuration service, which updates in-memory values and writes this file without a deploy. The file is read at startup; direct file edits require a restart. `maintenanceUntil` determines whether maintenance is active. It holds `maintenanceMode`/`maintenanceUntil`, `bots` (`enabled`, `rolloutPercent`, plus any `config.js` timing default), `announcements`, `rewardMultipliers`, `rewardFloor`, and `rewardCeiling`.

## Default values and precedence

| Owner | Current defaults |
| --- | --- |
| `gameConstants.js` | 60 Hz simulation; snapshots every 2 ticks; world state every 8 ticks; fallback world 3600 × 1000px with 400px margin; party join requests expire after 15s |
| `gameRoomConfig.js`: match | Duels regular time 150s; poison rises at 15px/s, ×2.2 for the first 12s; poison damage 400/s; sudden-death cap 80s; timer broadcast 500ms; elimination finish delay 3s; all-human departure grace 15s |
| `gameRoomConfig.js`: regen | Starts after 3.5s out of combat; ticks every 1.5s for 25% of missing health, minimum 500, capped at max health |
| `gameRoomConfig.js`: powerups | Spawn interval 25s; starting count 2; max active 3; pickup radius 70px; despawn 10s after the 2s omen; anchored spawn lift 22px |
| `gameRoomConfig.js`: drops | Lifetime 12s; final 3s blinking; pickup radius 110px; 4–8 coin drops and 1–3 gem drops |
| `gameRoomConfig.js`: validation | Hit rewind cap 300ms; future tolerance 120ms; history 1s / 128 samples; duplicate-hit window 80ms; stomp radius 110px and interruption 300ms |
| `movementPhysics.json` | Run speed 260px/s; ground/air acceleration 3000/3300px/s²; gravity 990px/s²; jump speed parameter 468px/s; dash 560px/s (straight down 840), burst 160ms, cooldown 5000ms, coast up to 850ms |
| `ducking.js` | Body height ×0.55; movement ×0.25; damage taken ×0.8; reentry delay 200ms |
| `characterStats.js` | Level cap 10; levels 2–5 add 500 HP / 100 damage / 200 special damage per level; levels 6–10 add 400 / 80 / 100; next-level coin costs 200, 400, 800, 1600, 2400, 3300, 4500, 6100, 8200 |
| `gameModes.catalog.json`: Bank Bust | Vault HP 50,000; match 210s; respawn 3500ms; respawn shield 3000ms; unlock 250 peak trophies |
| `bankBust/state.js`: loose gold | Cap 6; value 10 each; pickup radius 42px; spawn interval 3200ms; collection event retention 1800ms |

These are code defaults. Map documents override room geometry and per-map powerup settings; saved map overrides take precedence over built-ins. Mode settings supply Bank Bust's clock instead of the Duels default. Character level, effects and application-specific parameters change resolved stats. Admin overrides change reward multipliers/limits and bot filling. Editing a fallback does not change maps that explicitly store the old value. Review saved overrides and rebuild/restart the affected client/server before comparing behavior.

When changing a shared value, check its consumers and the related guide: [gameplay](gameplay.md), [networking](networking.md), [progression](progression.md), or [maps](maps.md). Keep art-source measurements in provenance separate from gameplay tuning.
