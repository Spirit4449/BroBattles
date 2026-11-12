const { combatRandom } = require("../clock");
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

function activate(caster, now, room) {
  if (!caster || !room) return;

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

    room._applyPowerupToPlayer(target, type, now, {
      powerScale: ARCANE_SURGE_POWER_SCALE,
      durationScale: ARCANE_SURGE_DURATION_SCALE,
      source: "ozzy:arcane-surge",
    });
    target.lastCombatAt = now;

    recipients.push({
      username: target.name,
      type,
      team: target.team || null,
      isCaster: target.name === caster.name,
    });
  }

  room.io.to(`game:${room.matchId}`).emit("ozzy:arcane-surge", {
    caster: caster.name,
    at: now,
    recipients,
  });
}

module.exports = {
  key: "ozzy",
  activate,
  SURGE_POWERUPS,
  ARCANE_SURGE_POWER_SCALE,
};
