// Centralized constants

const PARTY_STATUS = Object.freeze({
  IDLE: "idle",
  QUEUED: "queued",
  READY_CHECK: "ready_check",
  LIVE: "live",
});

const TEAM_SIZE_BY_MODE = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
});

const DISCONNECT_GRACE_MS = 3000;

function teamSizeForMode(mode) {
  const m = Number(mode);
  if (TEAM_SIZE_BY_MODE[String(m)]) return TEAM_SIZE_BY_MODE[String(m)];
  return Number.isFinite(m) && m > 0 && m <= 5 ? m : 1;
}

function capacityFromMode(mode) {
  const perTeam = Math.max(1, Math.min(3, teamSizeForMode(mode)));
  return { total: perTeam * 2, perTeam };
}

module.exports = {
  PARTY_STATUS,
  TEAM_SIZE_BY_MODE,
  DISCONNECT_GRACE_MS,
  teamSizeForMode,
  capacityFromMode,
};
