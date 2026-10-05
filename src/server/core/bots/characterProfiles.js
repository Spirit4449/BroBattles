// Per-character bot knowledge. Attack identity and tuning still come from the
// shared character definitions; this table holds only how a bot *plays* each
// kit. Adding a character means adding one entry here (content validation
// fails until it exists).
const { DEFAULT_CHARACTER } = require('../../../shared/characters/characterStats.js');
const effects = require('../gameRoom/effects/effectManager');

const healthFraction = (player) =>
  Math.max(0, Math.min(1, Number(player.health) / Math.max(1, Number(player.maxHealth))));

/**
 * Profile fields (all optional except `spacing`):
 * - spacing: { fraction, cap, clearance, height } preferred engagement spacing.
 * - melee: close-range kit; teammates and threat estimates treat it as such.
 * - aim.bodyCenter: aim at the target's standing hitbox, not its sprite origin.
 * - aim.ballistic: solve projectile arcs; `coverCheck` also rejects arcs through
 *   map colliders, `powerScaled` varies launch speed with drag distance.
 * - aim.rangeFromRuntime: prefer the attack runtime range over aim defaultRange.
 * - aim.errorScale: { factor, add, max } widens profile aim error.
 * - clearShot: 'trajectory' reuses the aim's cover check; { radius,
 *   radiusFromAttack } checks a straight line using that attack's collision
 *   radius (or `radius`); absent means the shot is never blocked by cover.
 * - pressureShots: may fire near (not at) a target that has no clean line.
 * - lobLimited: high arcs are rate-limited unless the target is above.
 * - serverOwnsAmmo(room): the character's combat engine consumes ammo itself.
 * - decorateBasicAction(action): add protocol fields to a bot basic action.
 * - hesitation: { min, max, awarenessPenalty } fixed follow-up window.
 * - superRange: preferred spacing while a super is charged (null = none).
 * - buffSuper: self/team buff; usable while retreating, as an emergency, and
 *   without an enemy range limit.
 * - specialRange: { fallback, fromBasicAim } distance limit for casting the
 *   special: the special aim's defaultRange/radius (or the basic aim's
 *   defaultRange when `fromBasicAim`), else `fallback`.
 * - specialLockMs: action lock after casting the special.
 * - shouldUseSuper(context): tactical decision once the super is charged.
 */
const PROFILES = {
  ninja: {
    spacing: { fraction: 0.68, cap: 330, clearance: 145, height: 35 },
    aim: { bodyCenter: true },
    clearShot: { radiusFromAttack: 'ninja-shuriken', radius: 18 },
    pressureShots: true,
    serverOwnsAmmo: (room) => !!room.ninjaCombatVersion,
    superRange: 340,
    specialLockMs: 720,
    shouldUseSuper({ player, target, enemies, distance, heldMs }) {
      const linedUp = enemies.filter((enemy) =>
        Math.abs(enemy.y - player.y) < 105 && Math.hypot(enemy.x - player.x, enemy.y - player.y) <= 470);
      return linedUp.length >= 2 || (distance <= 440 && Math.abs(target.y - player.y) < 105 &&
        (healthFraction(target) < 0.58 || heldMs > 2600));
    },
  },
  thorg: {
    spacing: { fraction: 0.65, cap: 125, clearance: 60, height: 20 },
    melee: true,
    superRange: 145,
    buffSuper: true,
    specialRange: { fallback: 250 },
    shouldUseSuper({ player, distance, emergency }) {
      // Rage lasts several seconds, so activate at the start of a real melee
      // engagement rather than after the opponent has already escaped.
      return distance <= 235 && (healthFraction(player) > 0.28 || emergency);
    },
  },
  draven: {
    spacing: { fraction: 0.65, cap: 220, clearance: 95, height: 45 },
    melee: true,
    superRange: 165,
    shouldUseSuper({ player, target, distance, nearby }) {
      // Inferno anchors Draven in place. Require a close/clustered target that
      // is grounded or moving toward the radius.
      return nearby(235).length >= 2 ||
        (distance <= 190 && (target.grounded || Math.sign(target.vx || 0) !== Math.sign(target.x - player.x)));
    },
  },
  wizard: {
    spacing: { fraction: 0.7, cap: 480, clearance: 225, height: 100 },
    aim: { ballistic: { coverCheck: false }, rangeFromRuntime: true },
    pressureShots: true,
    superRange: null,
    buffSuper: true,
    specialRange: { fromBasicAim: true, fallback: 1000 },
    shouldUseSuper({ brain, player, now, heldMs }) {
      const allies = [...brain.room.players.values()].filter((ally) =>
        ally.team === player.team && ally.isAlive && ally.loaded && ally.connected !== false);
      const allyNeedsHelp = allies.some((ally) => healthFraction(ally) < 0.62);
      const alreadyBuffed = effects.isActive(player, 'rage', now) || effects.isActive(player, 'shield', now);
      return allyNeedsHelp || (!alreadyBuffed && (allies.length > 1 || heldMs > 3500));
    },
  },
  huntress: {
    spacing: { fraction: 0.65, cap: 370, clearance: 200, height: 85 },
    aim: { ballistic: { coverCheck: true, powerScaled: true }, errorScale: { factor: 1.45, add: 0.025, max: 0.22 } },
    clearShot: 'trajectory',
    pressureShots: true,
    lobLimited: true,
    serverOwnsAmmo: () => true,
    decorateBasicAction(action) {
      action.power = require('../../../shared/characters/huntressProjectile').powerFromSpeed(action.angle, action.speed);
    },
    // Her three-arrow spread is already forgiving, so give opponents a
    // readable punish window instead of chaining every available charge.
    hesitation: { min: 360, max: 620, awarenessPenalty: 120 },
    superRange: 600,
    shouldUseSuper({ target, enemies, distance }) {
      const clustered = enemies.filter((enemy) => Math.hypot(enemy.x - target.x, enemy.y - target.y) < 180).length;
      return distance >= 180 && distance <= 930 &&
        (clustered >= 2 || target.grounded || Math.abs(target.vy || 0) < 140);
    },
  },
  gloop: {
    spacing: { fraction: 0.65, cap: 330, clearance: 170, height: 70 },
    clearShot: { radius: 8 },
    pressureShots: true,
    superRange: 520,
    shouldUseSuper({ player, target, distance, heldMs }) {
      const movingAway = Math.sign(target.vx || 0) === Math.sign(target.x - player.x) && Math.abs(target.vx || 0) > 35;
      return distance >= 210 && distance <= 730 &&
        (movingAway || healthFraction(target) < 0.55 || heldMs > 3000);
    },
  },
};

const DEFAULT_SPECIAL_LOCK_MS = 450;
const DEFAULT_SPECIAL_RANGE = 700;

function hasBotProfile(character) {
  return Object.hasOwn(PROFILES, character);
}

// Unknown characters play with the default character's spacing but no
// character-specific behaviour, matching the previous fallbacks.
function botProfile(character) {
  if (hasBotProfile(character)) return PROFILES[character];
  return { spacing: PROFILES[DEFAULT_CHARACTER].spacing, superRange: null };
}

module.exports = {
  BOT_PROFILES: PROFILES,
  DEFAULT_SPECIAL_LOCK_MS,
  botProfile,
  DEFAULT_SPECIAL_RANGE,
  hasBotProfile,
  healthFraction,
};
