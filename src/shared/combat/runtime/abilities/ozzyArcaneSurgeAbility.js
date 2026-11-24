const { SOCKET_EVENTS } = require("../../../net/socketEvents.js");
const { combatRandom, combatNow } = require("../clock");
const { POWERUP_TYPES } = require("../../matchConfig.js");
const { getResolvedCharacterSpecialConfig } = require("../../../characters/characterTuning.js");

// Tuning lives in src/shared/characters/ozzy.json (special.arcaneSurge).
const SURGE = getResolvedCharacterSpecialConfig("ozzy", "arcaneSurge");
// Only helpful powerups: the caster and every teammate roll from the same pool.
// Shockwave is left out because it also knocks back the caster's own team.
const SURGE_POWERUPS = (Array.isArray(SURGE.powerups) ? SURGE.powerups : [])
  .filter((type) => POWERUP_TYPES.includes(type));
const FALLBACK_POWERUP = SURGE.fallbackPowerup;
const ARCANE_SURGE_POWER_SCALE = SURGE.powerScale;
const ARCANE_SURGE_DURATION_SCALE = SURGE.durationScale;

function randomFrom(list, room) {
  const pool = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!pool.length) return FALLBACK_POWERUP;
  const index = Math.floor(combatRandom(room) * pool.length);
  return pool[index] || FALLBACK_POWERUP;
}

function getAllowedPowerupsForTarget() {
  return SURGE_POWERUPS.length ? SURGE_POWERUPS.slice() : [FALLBACK_POWERUP];
}

// The surge goes off when the cast's flames burst, surgeMs into the super
// pose (characters/ozzy/anim.js draws them at that frame): the powerups land
// as the beams leave the burning staff. A caster knocked out or gone before
// then casts nothing.
function activate(caster, now, room) {
  if (!caster || !room) return;
  const delay = Math.max(0, Number(SURGE.surgeMs) || 0);
  if (!delay || typeof room.scheduleAction !== "function") return surge(caster, now, room);
  room.scheduleAction(() => {
    if (room.status !== "active" || !caster.isAlive || caster.connected === false) return;
    surge(caster, combatNow(room), room);
  }, delay);
}

function surge(caster, now, room) {

  const recipients = [];
  for (const target of room.players.values()) {
    if (!target || !target.isAlive || target.loaded !== true) continue;
    if (
      !caster.team ||
      !target.team ||
      String(target.team) !== String(caster.team)
    ) {
      continue;
    }

    const type = randomFrom(getAllowedPowerupsForTarget(), room);

    room.applyPowerupToPlayer(target, type, now, {
      powerScale: ARCANE_SURGE_POWER_SCALE,
      durationScale: ARCANE_SURGE_DURATION_SCALE,
      source: SOCKET_EVENTS.OZZY_ARCANE_SURGE,
    });
    target.lastCombatAt = now;

    recipients.push({
      username: target.name,
      type,
      team: target.team || null,
      isCaster: target.name === caster.name,
    });
  }

  room.broadcast(SOCKET_EVENTS.OZZY_ARCANE_SURGE, {
    caster: caster.name,
    at: now,
    recipients,
  });
}

module.exports = {
  key: "ozzy",
  activate,
  SURGE_POWERUPS,
};
