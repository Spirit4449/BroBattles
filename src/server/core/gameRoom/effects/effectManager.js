// src/server/core/gameRoom/effects/effectManager.js
//
// Manages active status effects on players.
//
// Usage pattern (all callers must pass a monotonic "now" timestamp in ms):
//
//   effectManager.apply(player, "rage", now)
//   effectManager.isActive(player, "rage", now)       // → boolean
//   effectManager.getRemaining(player, "rage", now)   // → ms remaining (0 if inactive)
//   effectManager.getModifiers(player, now)           // → { damageMult, damageTakenMult, speedMult, jumpMult }
//   effectManager.tickAll(player, room, now)          // call each game tick per player
//   effectManager.snapshotAll(player, now)            // → { rage: msRemaining, shield: msRemaining, ... }
//
// Player storage: player.activeEffects = { effectKey: { until: number, nextTickAt: number } }
// The `player.effects` object remains available for ability-specific state (e.g. dravenInferno*).

const { effectDefs } = require("./effectDefs");

const DEFAULT_MODIFIERS = Object.freeze({
  damageMult: 1,
  damageTakenMult: 1,
  speedMult: 1,
  jumpMult: 1,
});

function _state(player) {
  if (!player.activeEffects) player.activeEffects = {};
  return player.activeEffects;
}

function _def(effectKey) {
  const def = effectDefs[effectKey];
  if (!def) throw new Error(`[effectManager] Unknown effect: "${effectKey}"`);
  return def;
}

/**
 * Apply or refresh an effect on a player.
 * @param {object}  player    — live server player object
 * @param {string}  effectKey — key in effectDefs
 * @param {number}  now       — current time in ms
 * @param {object}  [params]  — optional overrides: { durationMs }
 * @param {object}  [room]    — game room instance (required if onApply needs it)
 */
function apply(player, effectKey, now, params = {}, room = null) {
  const def = _def(effectKey);
  const state = _state(player);
  const durationMs =
    params && params.durationMs != null ? params.durationMs : def.durationMs;

  const prevEntry = state[effectKey];
  state[effectKey] = {
    until: now + durationMs,
    nextTickAt: now + (def.tickIntervalMs || 0),
  };

  if (def.onApply) {
    def.onApply(player, room, now, params);
  }

  // If refreshed while still active, keep nextTickAt aligned to the original cadence
  if (prevEntry && prevEntry.nextTickAt > now) {
    state[effectKey].nextTickAt = prevEntry.nextTickAt;
  }
}

/**
 * Returns true if the effect is currently active on the player.
 */
function isActive(player, effectKey, now) {
  const state = _state(player);
  const entry = state[effectKey];
  return !!entry && entry.until > now;
}

/**
 * Returns the remaining duration in ms (0 if not active).
 */
function getRemaining(player, effectKey, now) {
  const state = _state(player);
  const entry = state[effectKey];
  if (!entry || entry.until <= now) return 0;
  return entry.until - now;
}

/**
 * Returns the combined stat modifiers for all active effects.
 * Multipliers are stacked multiplicatively.
 * Always returns a fresh object with all four keys present.
 */
function getModifiers(player, now) {
  const state = _state(player);
  let damageMult = 1;
  let damageTakenMult = 1;
  let speedMult = 1;
  let jumpMult = 1;

  for (const [key, entry] of Object.entries(state)) {
    if (entry.until <= now) continue;
    const def = effectDefs[key];
    if (!def || !def.modifiers) continue;
    const m = def.modifiers;
    if (m.damageMult != null) damageMult *= m.damageMult;
    if (m.damageTakenMult != null) damageTakenMult *= m.damageTakenMult;
    if (m.speedMult != null) speedMult *= m.speedMult;
    if (m.jumpMult != null) jumpMult *= m.jumpMult;
  }

  return { damageMult, damageTakenMult, speedMult, jumpMult };
}

/**
 * Call once per game tick per player.
 * Fires onTick callbacks for each active effect whose tickIntervalMs has elapsed.
 * Expired entries are pruned.
 */
function tickAll(player, room, now) {
  const state = _state(player);
  for (const [key, entry] of Object.entries(state)) {
    if (entry.until <= now) {
      delete state[key];
      continue;
    }
    const def = effectDefs[key];
    if (!def || !def.tickIntervalMs || !def.onTick) continue;
    if (now >= entry.nextTickAt) {
      def.onTick(player, room, now);
      entry.nextTickAt = now + def.tickIntervalMs;
    }
  }
}

/**
 * Returns a snapshot object for the network (client-facing).
 * Shape: { snapshotKey: remainingMs, ... }
 * Every defined effect always appears in the snapshot so the client can clear stale bars.
 */
function snapshotAll(player, now) {
  const state = _state(player);
  const snap = {};
  for (const [key, def] of Object.entries(effectDefs)) {
    const snapKey = def.snapshotKey || key;
    const entry = state[key];
    snap[snapKey] = entry && entry.until > now ? entry.until - now : 0;
  }
  return snap;
}

module.exports = {
  apply,
  isActive,
  getRemaining,
  getModifiers,
  tickAll,
  snapshotAll,
};
