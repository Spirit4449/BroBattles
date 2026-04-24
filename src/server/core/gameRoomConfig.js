// Centralized GameRoom tuning/config constants.
// Keep values identical to preserve gameplay behavior during refactor.

const MOVEMENT_PHYSICS = require("../../shared/movementPhysics.json");

// ========== FEATURE FLAGS ==========
// Rollout flags for Phase 2 netcode improvements
const USE_SERVER_MOVEMENT_SIMULATION_V1 = false;

const WORLD_BOUNDS = {
  width: 3600,
  height: 1000,
  margin: 400,
};

const GAME_DURATION_MS = 2.5 * 60 * 1000;
const SD_RISE_SPEED = 15;
const SD_RISE_FAST_PHASE_MS = 12000;
const SD_RISE_FAST_MULT = 2.2;
const SD_DAMAGE_PER_SEC = 400;
const SUDDEN_DEATH_MAX_MS = 80 * 1000;
const TIMER_EMIT_INTERVAL_MS = 500;
const ALL_DEAD_GAME_OVER_DELAY_MS = 3000;

const POWERUP_SPAWN_INTERVAL_MS = 25000;
const POWERUP_STARTING_COUNT = 2;
const POWERUP_MAX_ACTIVE = 3;
const POWERUP_PICKUP_RADIUS = 70;
const POWERUP_DESPAWN_MS = 10000;
const POWERUP_OMEN_MS = 2000;
const POWERUP_SPAWN_Y_LIFT = 22;
const POWERUP_TYPES = ["rage", "health", "shield", "poison", "gravityBoots"];
const POWERUP_TYPE_ROTATION = [
  "rage",
  "health",
  "shield",
  "poison",
  "gravityBoots",
];
const POWERUP_DURATIONS_MS = {
  rage: 10000,
  health: 10000,
  shield: 10000,
  poison: 8000,
  gravityBoots: 7000,
};
const POWERUP_RAGE_DAMAGE_MULT = 1.35;
const POWERUP_SHIELD_DAMAGE_MULT = 0.7;
const POWERUP_HEALTH_REGEN_PER_SEC = 600;
const POWERUP_POISON_DPS = 600;
const POWERUP_EFFECT_TICK_MS = 500;
const POWERUP_AMBIENT_TICK_MS = 1200;

const DEATH_DROP_DESPAWN_MS = 12000;
const DEATH_DROP_BLINK_MS = 3000;
const DEATH_DROP_PICKUP_RADIUS = 110;
const DEATH_DROP_MAX_CLIENT_POS_DELTA = 420;
const DEATH_DROP_COIN_MIN = 7;
const DEATH_DROP_COIN_MAX = 15;
const DEATH_DROP_GEM_MIN = 2;
const DEATH_DROP_GEM_MAX = 6;
const DEATH_DROP_LAUNCH_VX_STEP = 34;
const DEATH_DROP_LAUNCH_VX_JITTER = 16;
const DEATH_DROP_LAUNCH_VY_BASE = 220;
const DEATH_DROP_LAUNCH_VY_JITTER = 36;
const DEATH_DROP_LAUNCH_VY_SPREAD_BONUS = 12;

const NINJA_SWARM_HIT_DAMAGE = 300;
const NINJA_SWARM_CHARGE_RATIO = 0.35;

const HIT_REWIND_MAX_MS = 200;
const HIT_STALENESS_MAX_MS = 300;
const HIT_FUTURE_TOLERANCE_MS = 120;
// Allow modest client/server wall-clock drift (NTP skew, mobile devices, SBCs).
// We still clamp future timestamps to `now`, so this only affects rejection.
const HIT_CLOCK_SKEW_ALLOWANCE_MS = 2500;
const POSITION_HISTORY_DEPTH = 50;

const MOVE_PLAUSIBLE_SPEED_H = 320;
const MOVE_PLAUSIBLE_SPEED_V = 1100;
const MOVE_PLAUSIBLE_LAG_PAD_H = 80;
const MOVE_PLAUSIBLE_LAG_PAD_V = 100;
const ACTION_MIN_INTERVAL_MS = 50;
const ACTION_SPAM_WINDOW_MS = 1000;
const ACTION_SPAM_MAX_IN_WINDOW = 12;
const ACTION_SPAM_SUPPRESS_MS = 800;
const MOVE_CLAMP_WINDOW_MS = 6000;
const MOVE_CLAMP_MAX_IN_WINDOW = 8;
const MOVE_CLAMP_SUPPRESS_MS = 1200;
const MELEE_FACING_TOLERANCE = 50;

const ATTACK_MAX_DIST_MAP = {
  "draven|basic": 380,
  "thorg|basic": 450,
  "wizard|basic": 1250,
  "ninja|basic": 720,
  "ninja|special": 800,
  "hunteress|huntress-arrow": 1050,
  "hunteress|huntress-burning-arrow": 1150,
  "any|basic": 520,
  "any|special": 800,
  "any|ninja-special-swarm": 800,
};

const POWERUP_PLATFORM_POINTS = {
  1: [
    { x: 935, y: 487.15 },
    { x: 1150, y: 487.15 },
    { x: 1365, y: 487.15 },
    { x: 1005, y: 147.14999999999998 },
    { x: 1150, y: 147.14999999999998 },
    { x: 1295, y: 147.14999999999998 },
    { x: 645, y: 169.14999999999998 },
    { x: 814, y: 249 },
    { x: 1489, y: 255 },
    { x: 1646, y: 137 },
    { x: 574, y: 500 },
    { x: 1727, y: 498 },
  ],
  2: [
    { x: 1007, y: 496 },
    { x: 1147, y: 364 },
    { x: 1292, y: 512 },
    { x: 725, y: 619.3499999999999 },
    { x: 1664, y: 456 },
    { x: 870, y: 306.34999999999997 },
    { x: 611, y: 444 },
    { x: 720, y: 181.34999999999997 },
    { x: 1580, y: 181.34999999999997 },
    { x: 1008, y: 55 },
    { x: 1295, y: 61 },
  ],
  3: [
    { x: 950, y: 500 },
    { x: 1150, y: 500 },
    { x: 1350, y: 500 },
    { x: 760, y: 260 },
    { x: 1490, y: 340 },
    { x: 1000, y: 230 },
    { x: 1225, y: 230 },
    { x: 1500, y: 230 },
    { x: 860, y: 340 },
  ],
  4: [
    { x: 744, y: 377 },
    { x: 2409, y: 28 },
    { x: 2948, y: 368 },
    { x: 1194, y: 34 },
    { x: 1800, y: 87 },
    { x: 2137, y: 251 },
    { x: 748, y: -210 },
    { x: 2848, y: -203 },
    { x: 1489, y: 255 },
    { x: 1468, y: -126 },
    { x: 178, y: 273 },
    { x: 3453, y: 268 },
  ],
};

module.exports = {
  MOVEMENT_PHYSICS,
  USE_SERVER_MOVEMENT_SIMULATION_V1,
  WORLD_BOUNDS,
  GAME_DURATION_MS,
  SD_RISE_SPEED,
  SD_RISE_FAST_PHASE_MS,
  SD_RISE_FAST_MULT,
  SD_DAMAGE_PER_SEC,
  SUDDEN_DEATH_MAX_MS,
  TIMER_EMIT_INTERVAL_MS,
  ALL_DEAD_GAME_OVER_DELAY_MS,
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
  POWERUP_RAGE_DAMAGE_MULT,
  POWERUP_SHIELD_DAMAGE_MULT,
  POWERUP_HEALTH_REGEN_PER_SEC,
  POWERUP_POISON_DPS,
  POWERUP_EFFECT_TICK_MS,
  POWERUP_AMBIENT_TICK_MS,
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
  NINJA_SWARM_HIT_DAMAGE,
  NINJA_SWARM_CHARGE_RATIO,
  HIT_REWIND_MAX_MS,
  HIT_STALENESS_MAX_MS,
  HIT_FUTURE_TOLERANCE_MS,
  HIT_CLOCK_SKEW_ALLOWANCE_MS,
  POSITION_HISTORY_DEPTH,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
  ACTION_MIN_INTERVAL_MS,
  ACTION_SPAM_WINDOW_MS,
  ACTION_SPAM_MAX_IN_WINDOW,
  ACTION_SPAM_SUPPRESS_MS,
  MOVE_CLAMP_WINDOW_MS,
  MOVE_CLAMP_MAX_IN_WINDOW,
  MOVE_CLAMP_SUPPRESS_MS,
  MELEE_FACING_TOLERANCE,
  ATTACK_MAX_DIST_MAP,
  POWERUP_PLATFORM_POINTS,
};
