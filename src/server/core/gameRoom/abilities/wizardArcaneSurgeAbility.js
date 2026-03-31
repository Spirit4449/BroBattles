const { POWERUP_TYPES } = require("../../gameRoomConfig");

const TEAMMATE_BLOCKED_POWERUPS = ["poison"];
const FALLBACK_POWERUP = "shield";
const ARCANE_SURGE_POWER_SCALE = 1.5;
const ARCANE_SURGE_DURATION_SCALE = 1.5;

function randomFrom(list) {
  const pool = Array.isArray(list) ? list.filter(Boolean) : [];
  if (!pool.length) return FALLBACK_POWERUP;
  const index = Math.floor(Math.random() * pool.length);
  return pool[index] || FALLBACK_POWERUP;
}

function getAllowedPowerupsForTarget(caster, target) {
  const all = Array.isArray(POWERUP_TYPES) ? POWERUP_TYPES.slice() : [];
  if (!all.length) return [FALLBACK_POWERUP];
  if (target?.name === caster?.name) return ["rage"];

  const sameTeam =
    caster?.team && target?.team && String(caster.team) === String(target.team);
  if (!sameTeam) return all;

  const blocked = new Set(
    (Array.isArray(TEAMMATE_BLOCKED_POWERUPS)
      ? TEAMMATE_BLOCKED_POWERUPS
      : []
    ).map((value) => String(value)),
  );
  const filtered = all.filter((type) => !blocked.has(String(type)));
  return filtered.length ? filtered : ["rage"];
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

    const allowed = getAllowedPowerupsForTarget(caster, target);
    const type =
      target.name === caster.name ? "rage" : randomFrom(allowed);

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
  TEAMMATE_BLOCKED_POWERUPS,
  ARCANE_SURGE_POWER_SCALE,
};
