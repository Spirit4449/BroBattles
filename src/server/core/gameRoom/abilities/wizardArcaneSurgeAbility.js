const { POWERUP_TYPES } = require("../../gameRoomConfig");
const { getResolvedCharacterSpecialConfig } = require("../../../../shared/characters/characterTuning.js");

// Tuning lives in src/shared/characters/wizard.json (special.arcaneSurge).
const SURGE = getResolvedCharacterSpecialConfig("wizard", "arcaneSurge");
// Only helpful powerups: the caster and every teammate roll from the same pool.
// Shockwave is left out because it also knocks back the caster's own team.
const SURGE_POWERUPS = (Array.isArray(SURGE.powerups) ? SURGE.powerups : [])
  .filter((type) => POWERUP_TYPES.includes(type));
const FALLBACK_POWERUP = SURGE.fallbackPowerup;
const ARCANE_SURGE_POWER_SCALE = SURGE.powerScale;
const ARCANE_SURGE_DURATION_SCALE = SURGE.durationScale;

function randomFrom(list) {
  const pool = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!pool.length) return FALLBACK_POWERUP;
  const index = Math.floor(Math.random() * pool.length);
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

    const type = randomFrom(getAllowedPowerupsForTarget());

    room._applyPowerupToPlayer(target, type, now, {
      powerScale: ARCANE_SURGE_POWER_SCALE,
      durationScale: ARCANE_SURGE_DURATION_SCALE,
      source: "wizard:arcane-surge",
    });
    target.lastCombatAt = now;

    recipients.push({
      username: target.name,
      type,
      team: target.team || null,
      isCaster: target.name === caster.name,
    });
  }

  room.io.to(`game:${room.matchId}`).emit("wizard:arcane-surge", {
    caster: caster.name,
    at: now,
    recipients,
  });
}

module.exports = {
  key: "wizard",
  activate,
  SURGE_POWERUPS,
  ARCANE_SURGE_POWER_SCALE,
};
