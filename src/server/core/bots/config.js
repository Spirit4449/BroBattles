const defaults = Object.freeze({ enabled: false, rolloutPercent: 0, startAfterMs: 10000, seatIntervalMs: 1000, fillByMs: 15000 });

function getBotConfig(runtimeConfig) {
  const value = { ...defaults, ...(runtimeConfig?.get?.()?.bots || {}) };
  return { ...value, enabled: value.enabled === true,
    rolloutPercent: Math.max(0, Math.min(100, Number(value.rolloutPercent) || 0)),
    startAfterMs: 10000, seatIntervalMs: 1000, fillByMs: 15000 };
}

function difficultyForTrophies(trophies) {
  const points = [
    [0, 500, 350, 0.24, 0.24, 0.10],
    [500, 350, 250, 0.16, 0.16, 0.35],
    [1250, 260, 180, 0.085, 0.09, 0.7],
    [2000, 220, 140, 0.035, 0.035, 1],
  ];
  const t = Math.max(0, Number(trophies) || 0);
  const upper = points.findIndex((p) => p[0] > t);
  const lo = upper < 0 ? points[3] : points[Math.max(0, upper - 1)];
  const hi = upper < 0 ? lo : points[upper];
  const f = hi[0] === lo[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
  const lerp = (i) => lo[i] + (hi[i] - lo[i]) * f;
  return { trophies: t, reactionMaxMs: lerp(1), reactionMinMs: lerp(2), aimError: lerp(3), mistakeChance: lerp(4), prediction: lerp(5) };
}

function stagedSeatCount(ticket, now = Date.now()) {
  const age = now - new Date(ticket.created_at).getTime();
  return age < defaults.startAfterMs ? 0 : Math.min(5, 1 + Math.floor((age - defaults.startAfterMs) / defaults.seatIntervalMs));
}

module.exports = { defaults, getBotConfig, difficultyForTrophies, stagedSeatCount };
