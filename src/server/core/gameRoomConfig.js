// Server-side match tuning: timers, sudden death, powerup spawning, death
// drops, regen, and anti-cheat tolerances. Everything here is read by
// src/server/core/gameRoom/*. See docs/development/constants.md for where every other
// kind of constant lives.
//
// Values owned by content files are re-exported, never copied:
//   - powerup stats  -> src/shared/catalogs/powerups.catalog.json
//   - character stats -> src/shared/characters/<name>.json
//   - world fallback  -> src/shared/gameConstants.js

const { WORLD_BOUNDS } = require("../../shared/gameConstants");
const { POWERUP_CATALOG, POWERUP_TYPES, POWERUP_DURATIONS_MS } = require("../../shared/powerups");
const { getResolvedCharacterSpecialConfig } = require("../../shared/characters/characterTuning");

// ---------------------------------------------------------------------------
// Match clock & sudden death
// ---------------------------------------------------------------------------

// Regular-time length of a Duels match. Modes with their own clock (Bank Bust)
// set `settings.matchDurationMs` in gameModes.catalog.json instead.
const GAME_DURATION_MS = 2.5 * 60 * 1000;
// Once regular time ends, poison rises from the floor at this speed (px/s).
const SD_RISE_SPEED = 15;
// For the first N ms of sudden death the poison rises faster...
const SD_RISE_FAST_PHASE_MS = 12000;
// ...by this multiplier on SD_RISE_SPEED.
const SD_RISE_FAST_MULT = 2.2;
// Damage per second dealt to anyone standing in the poison.
const SD_DAMAGE_PER_SEC = 400;
// Hard cap on sudden death; after this long a tiebreak decides the winner.
const SUDDEN_DEATH_MAX_MS = 80 * 1000;
// How often the match timer is broadcast to clients.
const TIMER_EMIT_INTERVAL_MS = 500;
// Pause between a team being wiped out and the game-over screen (unless the
// mode supplies its own finishDelayMs).
const ALL_DEAD_GAME_OVER_DELAY_MS = 3000;
// If every human leaves, the room waits this long before abandoning the match.
const ABANDON_MATCH_GRACE_MS = 15000;

// ---------------------------------------------------------------------------
// Passive health regen (out of combat)
// ---------------------------------------------------------------------------

// Time since last damage/attack before regen kicks in.
const REGEN_DELAY_MS = 3500;
// Regen heals in discrete ticks this far apart.
const REGEN_TICK_MS = 1500;
// Each tick heals this fraction of *missing* health (so it slows near full)...
const REGEN_MISSING_RATIO = 0.25;
// ...but never less than this flat amount.
const REGEN_MIN_ABS = 500;
// Minimum spacing between health-update broadcasts caused by regen.
const REGEN_BROADCAST_MIN_MS = 120;

// ---------------------------------------------------------------------------
// Powerup spawning (per-powerup stats live in powerups.catalog.json; spawn
// points live in each map file under `spawns.powerups`)
// ---------------------------------------------------------------------------

// A new powerup spawns this often.
const POWERUP_SPAWN_INTERVAL_MS = 25000;
// Powerups placed when the fight starts.
const POWERUP_STARTING_COUNT = 2;
// Never more than this many on the map at once.
const POWERUP_MAX_ACTIVE = 3;
// Server pickup distance from player to powerup center (px).
const POWERUP_PICKUP_RADIUS = 70;
// Uncollected powerups vanish after this long. Maps may override (`settings.despawnMs`).
const POWERUP_DESPAWN_MS = 10000;
// Warning "omen" shown before a powerup becomes collectible. Maps may override (`settings.omenMs`).
const POWERUP_OMEN_MS = 2000;
// Platform-anchored spawn points are raised by this much (px). Maps may override (`settings.spawnLift`).
const POWERUP_SPAWN_Y_LIFT = 22;
// Healing/poison effects apply their per-second amounts in steps this far apart.
const POWERUP_EFFECT_TICK_MS = 500;
// Cadence for ambient effect sounds/particles (rage, shield, ...).
const POWERUP_AMBIENT_TICK_MS = 1200;

// Derived from powerups.catalog.json — edit the catalog, not these.
const POWERUP_TYPE_ROTATION = [...POWERUP_TYPES];
const POWERUP_HEALTH_REGEN_PER_SEC = POWERUP_CATALOG.health.healingPerSecond;
const POWERUP_POISON_DPS = POWERUP_CATALOG.poison.damagePerSecond;
const POWERUP_SHOCKWAVE_RADIUS = POWERUP_CATALOG.shockwave.radius;
const POWERUP_SHOCKWAVE_FORCE_X = POWERUP_CATALOG.shockwave.forceX;
const POWERUP_SHOCKWAVE_FORCE_Y = POWERUP_CATALOG.shockwave.forceY;
const POWERUP_FREEZE_SPEED_MULT = POWERUP_CATALOG.freeze.modifiers.speedMult;
const POWERUP_FREEZE_JUMP_MULT = POWERUP_CATALOG.freeze.modifiers.jumpMult;

// ---------------------------------------------------------------------------
// Death drops (coins/gems that burst out of a defeated player)
// ---------------------------------------------------------------------------

// Drops disappear after this long.
const DEATH_DROP_DESPAWN_MS = 12000;
// They start blinking this long before despawning.
const DEATH_DROP_BLINK_MS = 3000;
// Server pickup distance from player to drop (px).
const DEATH_DROP_PICKUP_RADIUS = 110;
// Reject client pickup claims whose drop position strayed further than this
// from where the server spawned it (px).
const DEATH_DROP_MAX_CLIENT_POS_DELTA = 420;
// Random coin count per death (inclusive range).
const DEATH_DROP_COIN_MIN = 4;
const DEATH_DROP_COIN_MAX = 8;
// Random gem count per death (inclusive range).
const DEATH_DROP_GEM_MIN = 1;
const DEATH_DROP_GEM_MAX = 3;
// Horizontal launch speed: VX_STEP per step from center, plus up to VX_JITTER random.
const DEATH_DROP_LAUNCH_VX_STEP = 15;
const DEATH_DROP_LAUNCH_VX_JITTER = 10;
// Upward launch speed: VY_BASE + SPREAD_BONUS per step from center + up to VY_JITTER random.
const DEATH_DROP_LAUNCH_VY_BASE = 220;
const DEATH_DROP_LAUNCH_VY_JITTER = 36;
const DEATH_DROP_LAUNCH_VY_SPREAD_BONUS = 5;

// ---------------------------------------------------------------------------
// Combat rules
// ---------------------------------------------------------------------------

// Landing on an enemy's head within this radius counts as a stomp (px).
const STOMP_RADIUS = 110;
// A stomp interrupts the victim's actions for this long.
const STOMP_INTERRUPT_MS = 300;
// Two hits with the same attacker/target/attack instance inside this window
// are treated as one (guards against double-reported contacts).
const DUPLICATE_HIT_WINDOW_MS = 80;
// Per-shard damage of Ninja's swarm. Derived from ninja.json.
const NINJA_SWARM_HIT_DAMAGE = getResolvedCharacterSpecialConfig("ninja", "swarm").damage;

// ---------------------------------------------------------------------------
// Anti-cheat & lag compensation
// ---------------------------------------------------------------------------

// Hit claims are rewound at most this far into the past (older timestamps are clamped).
const HIT_STALENESS_MAX_MS = 300;
// Hit claims stamped this far in the future (clock drift) are still accepted;
// anything later is rejected. Future timestamps are clamped to `now`.
const HIT_FUTURE_TOLERANCE_MS = 120;
// Per-player position history kept for lag-compensated hit checks.
const POSITION_HISTORY_DEPTH = 128; // max samples
const POSITION_HISTORY_MS = 1000; // max age

// Movement plausibility: fastest horizontal/vertical speed (px/s) a normal
// client may report before dashes, wall kicks, and knockback are added on top.
const MOVE_PLAUSIBLE_SPEED_H = 320;
const MOVE_PLAUSIBLE_SPEED_V = 1100;
// Extra distance (px) allowed on top of the speed budget to absorb lag.
const MOVE_PLAUSIBLE_LAG_PAD_H = 80;
const MOVE_PLAUSIBLE_LAG_PAD_V = 100;
// Unused movement budget can bank up to this much time (ms) of travel.
const MAX_MOVEMENT_CREDIT_MS = 500;
// MAX movement clamps within WINDOW logs a "repeated movement clamps" warning
// (reported only; clamping itself already bounds the packet).
const MOVE_CLAMP_WINDOW_MS = 6000;
const MOVE_CLAMP_MAX_IN_WINDOW = 8;

// Attack/action spam limits.
const ACTION_MIN_INTERVAL_MS = 50; // min gap between two actions
const ACTION_SPAM_WINDOW_MS = 1000; // sliding window for the spam counter
const ACTION_SPAM_MAX_IN_WINDOW = 12; // actions allowed per window
const ACTION_SPAM_SUPPRESS_MS = 800; // lockout after exceeding the limit

// Melee hits may land this far (px) behind the attacker's facing direction.
const MELEE_FACING_TOLERANCE = 50;

// Maximum attacker→target distance (px) accepted for a hit, keyed by
// "character|attackType". "any|..." rows are fallbacks; unknown keys use 600.
// Keep these a little above each attack's real reach (see <name>.json).
const ATTACK_MAX_DIST_MAP = {
  "draven|basic": 380,
  "thorg|basic": 450,
  "wizard|basic": 1250,
  "ninja|basic": 720,
  "ninja|special": 800,
  "gloop|basic": 1200,
  "gloop|special": 1500,
  "huntress|huntress-arrow": 1050,
  "huntress|huntress-burning-arrow": 1150,
  "any|basic": 520,
  "any|special": 800,
  "any|ninja-special-swarm": 800,
};

module.exports = {
  WORLD_BOUNDS,
  GAME_DURATION_MS,
  SD_RISE_SPEED,
  SD_RISE_FAST_PHASE_MS,
  SD_RISE_FAST_MULT,
  SD_DAMAGE_PER_SEC,
  SUDDEN_DEATH_MAX_MS,
  TIMER_EMIT_INTERVAL_MS,
  ALL_DEAD_GAME_OVER_DELAY_MS,
  ABANDON_MATCH_GRACE_MS,
  REGEN_DELAY_MS,
  REGEN_TICK_MS,
  REGEN_MISSING_RATIO,
  REGEN_MIN_ABS,
  REGEN_BROADCAST_MIN_MS,
  POWERUP_SPAWN_INTERVAL_MS,
  POWERUP_STARTING_COUNT,
  POWERUP_MAX_ACTIVE,
  POWERUP_PICKUP_RADIUS,
  POWERUP_DESPAWN_MS,
  POWERUP_OMEN_MS,
  POWERUP_SPAWN_Y_LIFT,
  POWERUP_TYPES,
  POWERUP_TYPE_ROTATION,
  POWERUP_DURATIONS_MS,
  POWERUP_HEALTH_REGEN_PER_SEC,
  POWERUP_POISON_DPS,
  POWERUP_EFFECT_TICK_MS,
  POWERUP_AMBIENT_TICK_MS,
  POWERUP_SHOCKWAVE_RADIUS,
  POWERUP_SHOCKWAVE_FORCE_X,
  POWERUP_SHOCKWAVE_FORCE_Y,
  POWERUP_FREEZE_SPEED_MULT,
  POWERUP_FREEZE_JUMP_MULT,
  DEATH_DROP_DESPAWN_MS,
  DEATH_DROP_BLINK_MS,
  DEATH_DROP_PICKUP_RADIUS,
  DEATH_DROP_MAX_CLIENT_POS_DELTA,
  DEATH_DROP_COIN_MIN,
  DEATH_DROP_COIN_MAX,
  DEATH_DROP_GEM_MIN,
  DEATH_DROP_GEM_MAX,
  DEATH_DROP_LAUNCH_VX_STEP,
  DEATH_DROP_LAUNCH_VX_JITTER,
  DEATH_DROP_LAUNCH_VY_BASE,
  DEATH_DROP_LAUNCH_VY_JITTER,
  DEATH_DROP_LAUNCH_VY_SPREAD_BONUS,
  STOMP_RADIUS,
  STOMP_INTERRUPT_MS,
  DUPLICATE_HIT_WINDOW_MS,
  NINJA_SWARM_HIT_DAMAGE,
  HIT_STALENESS_MAX_MS,
  HIT_FUTURE_TOLERANCE_MS,
  POSITION_HISTORY_DEPTH,
  POSITION_HISTORY_MS,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
  MAX_MOVEMENT_CREDIT_MS,
  MOVE_CLAMP_WINDOW_MS,
  MOVE_CLAMP_MAX_IN_WINDOW,
  ACTION_MIN_INTERVAL_MS,
  ACTION_SPAM_WINDOW_MS,
  ACTION_SPAM_MAX_IN_WINDOW,
  ACTION_SPAM_SUPPRESS_MS,
  MELEE_FACING_TOLERANCE,
  ATTACK_MAX_DIST_MAP,
};
