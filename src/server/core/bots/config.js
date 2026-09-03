const { createRandom } = require("./random");

const defaults = Object.freeze({
  enabled: false,
  rolloutPercent: 0,
  startAfterMs: 5000,
  randomWindowMs: 3500,
  minIntervalMs: 1000,
  intervalVarianceMs: 2000,
  fillByMs: 18000,
});

function getBotConfig(runtimeConfig) {
  const value = { ...defaults, ...(runtimeConfig?.get?.()?.bots || {}) };
  return {
    ...value,
    enabled: value.enabled === true,
    rolloutPercent: Math.max(
      0,
      Math.min(100, Number(value.rolloutPercent) || 0),
    ),
    startAfterMs: Number(value.startAfterMs) || defaults.startAfterMs,
    randomWindowMs: Number(value.randomWindowMs) || defaults.randomWindowMs,
    minIntervalMs: Number(value.minIntervalMs) || defaults.minIntervalMs,
    intervalVarianceMs:
      Number(value.intervalVarianceMs) || defaults.intervalVarianceMs,
    fillByMs: Number(value.fillByMs) || defaults.fillByMs,
  };
}

function difficultyForTrophies(trophies) {
  const points = [
    // trophies, reaction max/min, aim error, mistakes, lead, dodge, tactics
    [0, 420, 300, 0.18, 0.16, 0.25, 0.5, 0.35],
    [500, 310, 220, 0.11, 0.1, 0.5, 0.62, 0.55],
    [1250, 220, 150, 0.055, 0.055, 0.82, 0.76, 0.8],
    [2000, 170, 105, 0.02, 0.018, 1.08, 0.9, 1],
  ];
  const t = Math.max(0, Number(trophies) || 0);
  const upper = points.findIndex((p) => p[0] > t);
  const lo = upper < 0 ? points[3] : points[Math.max(0, upper - 1)];
  const hi = upper < 0 ? lo : points[upper];
  const f = hi[0] === lo[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
  const lerp = (i) => lo[i] + (hi[i] - lo[i]) * f;
  return {
    trophies: t,
    reactionMaxMs: lerp(1),
    reactionMinMs: lerp(2),
    aimError: lerp(3),
    mistakeChance: lerp(4),
    prediction: lerp(5),
    dodgeChance: lerp(6),
    tacticalAwareness: lerp(7),
  };
}

function getSeatSchedule(ticket, config = defaults, maxSeats = 5) {
  const seed =
    ticket?.seed != null
      ? Number(ticket.seed) >>> 0
      : ticket?.ticket_id != null
        ? Number(ticket.ticket_id) >>> 0
        : ticket?.created_at != null
          ? new Date(ticket.created_at).getTime() >>> 0
          : 42;
  const rng = createRandom(seed);
  const startAfter = Number(config?.startAfterMs ?? defaults.startAfterMs);
  const randomWindow = Number(
    config?.randomWindowMs ?? defaults.randomWindowMs,
  );
  const minInterval = Number(config?.minIntervalMs ?? defaults.minIntervalMs);
  const intervalVariance = Number(
    config?.intervalVarianceMs ?? defaults.intervalVarianceMs,
  );

  const schedule = [];
  let currentDelay = startAfter + Math.floor(rng() * randomWindow);
  schedule.push(currentDelay);
  for (let i = 1; i < maxSeats; i++) {
    currentDelay += minInterval + Math.floor(rng() * intervalVariance);
    schedule.push(currentDelay);
  }
  return schedule;
}

function stagedSeatCount(ticket, now = Date.now(), config = defaults) {
  if (!ticket?.created_at) return 0;
  const age = now - new Date(ticket.created_at).getTime();
  const startAfter = Number(config?.startAfterMs ?? defaults.startAfterMs);
  if (age < startAfter) return 0;
  const schedule = getSeatSchedule(ticket, config);
  let count = 0;
  for (let i = 0; i < schedule.length; i++) {
    if (age >= schedule[i]) count++;
    else break;
  }
  return Math.min(schedule.length, count);
}

module.exports = {
  defaults,
  getBotConfig,
  difficultyForTrophies,
  getSeatSchedule,
  stagedSeatCount,
};
