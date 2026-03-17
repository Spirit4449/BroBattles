// Centralized GameRoom tuning/config constants.
// Keep values identical to preserve gameplay behavior during refactor.

const WORLD_BOUNDS = {
  width: 2300,
  height: 1000,
  margin: 200,
};

const GAME_DURATION_MS = 26.5 * 60 * 1000;
const SD_RISE_SPEED = 15;
const SD_RISE_FAST_PHASE_MS = 12000;
const SD_RISE_FAST_MULT = 2.2;
const SD_DAMAGE_PER_SEC = 400;
const TIMER_EMIT_INTERVAL_MS = 500;

const POWERUP_SPAWN_INTERVAL_MS = 20000;
const POWERUP_STARTING_COUNT = 2;
const POWERUP_MAX_ACTIVE = 3;
const POWERUP_PICKUP_RADIUS = 65;
const POWERUP_DESPAWN_MS = 10000;
const POWERUP_RECENT_SPAWN_MEMORY = 4;
const POWERUP_SPAWN_Y_LIFT = 22;
const POWERUP_LAYOUT_BASE_CENTER_X = 650;
const POWERUP_TYPES = ["rage", "health", "shield", "poison", "gravityBoots"];
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

const NINJA_SWARM_HIT_DAMAGE = 300;
const NINJA_SWARM_CHARGE_RATIO = 0.35;

const HIT_REWIND_MAX_MS = 200;
const HIT_STALENESS_MAX_MS = 300;
const POSITION_HISTORY_DEPTH = 50;

const MOVE_PLAUSIBLE_SPEED_H = 320;
const MOVE_PLAUSIBLE_SPEED_V = 1100;
const MOVE_PLAUSIBLE_LAG_PAD_H = 80;
const MOVE_PLAUSIBLE_LAG_PAD_V = 100;
const MELEE_FACING_TOLERANCE = 50;

const ATTACK_MAX_DIST_MAP = {
  "draven|basic": 380,
  "thorg|basic": 450,
  "wizard|basic": 1250,
  "ninja|basic": 720,
  "ninja|special": 800,
  "any|basic": 520,
  "any|special": 800,
  "any|ninja-special-swarm": 800,
};

const POWERUP_PLATFORM_POINTS = {
  1: [
    { x: 435, y: 506 },
    { x: 650, y: 506 },
    { x: 865, y: 506 },
    { x: 505, y: 166 },
    { x: 650, y: 166 },
    { x: 795, y: 166 },
    { x: 145, y: 188 },
    { x: 285, y: 188 },
    { x: 1015, y: 188 },
    { x: 1155, y: 188 },
    { x: 92, y: 468 },
    { x: 1208, y: 468 },
  ],
  2: [
    { x: 590, y: 330 },
    { x: 710, y: 330 },
    { x: 650, y: 520 },
    { x: 225, y: 560 },
    { x: 1075, y: 560 },
    { x: 370, y: 247 },
    { x: 930, y: 247 },
    { x: 220, y: 122 },
    { x: 1080, y: 122 },
    { x: 520, y: 72 },
    { x: 780, y: 72 },
  ],
};

module.exports = {
  WORLD_BOUNDS,
  GAME_DURATION_MS,
  SD_RISE_SPEED,
  SD_RISE_FAST_PHASE_MS,
  SD_RISE_FAST_MULT,
  SD_DAMAGE_PER_SEC,
  TIMER_EMIT_INTERVAL_MS,
  POWERUP_SPAWN_INTERVAL_MS,
  POWERUP_STARTING_COUNT,
  POWERUP_MAX_ACTIVE,
  POWERUP_PICKUP_RADIUS,
  POWERUP_DESPAWN_MS,
  POWERUP_RECENT_SPAWN_MEMORY,
  POWERUP_SPAWN_Y_LIFT,
  POWERUP_LAYOUT_BASE_CENTER_X,
  POWERUP_TYPES,
  POWERUP_DURATIONS_MS,
  POWERUP_RAGE_DAMAGE_MULT,
  POWERUP_SHIELD_DAMAGE_MULT,
  POWERUP_HEALTH_REGEN_PER_SEC,
  POWERUP_POISON_DPS,
  POWERUP_EFFECT_TICK_MS,
  POWERUP_AMBIENT_TICK_MS,
  NINJA_SWARM_HIT_DAMAGE,
  NINJA_SWARM_CHARGE_RATIO,
  HIT_REWIND_MAX_MS,
  HIT_STALENESS_MAX_MS,
  POSITION_HISTORY_DEPTH,
  MOVE_PLAUSIBLE_SPEED_H,
  MOVE_PLAUSIBLE_SPEED_V,
  MOVE_PLAUSIBLE_LAG_PAD_H,
  MOVE_PLAUSIBLE_LAG_PAD_V,
  MELEE_FACING_TOLERANCE,
  ATTACK_MAX_DIST_MAP,
  POWERUP_PLATFORM_POINTS,
};
