const { createRandom } = require("./random");

// Matchmaking bot-fill defaults. Any of these can be overridden live from
// runtime-overrides.json -> "bots" (the admin panel writes that file).
const defaults = Object.freeze({
  enabled: false, // bots join queues at all
  rolloutPercent: 0, // % of tickets eligible for bot fill (0-100)
  startAfterMs: 5000, // queue time before the first bot may join
  randomWindowMs: 3500, // random extra delay before the first bot
  minIntervalMs: 1000, // minimum gap between later bots
  intervalVarianceMs: 2000, // random extra gap between later bots
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
  };
}

function difficultyForTrophies(trophies) {
  const points = [
    // trophies, reaction max/min, aim error, mistakes, lead, dodge, tactics
    [0, 420, 300, 0.18, 0.16, 0.25, 0.5, 0.35],
    [500, 310, 220, 0.11, 0.1, 0.5, 0.62, 0.55],
    [1250, 220, 150, 0.055, 0.055, 0.82, 0.76, 0.8],
    [2000, 190, 130, 0.04, 0.035, 0.9, 0.82, 0.88],
    [4000, 170, 105, 0.025, 0.018, 1, 0.9, 1],
  ];
  const t = Math.max(0, Math.min(4000, Number(trophies) || 0));
  const upper = points.findIndex((p) => p[0] > t);
  const lo = upper < 0 ? points[points.length - 1] : points[Math.max(0, upper - 1)];
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

function recoveryThreshold(awareness = 0.5, recovering = false, morale = 0.5) {
  return recovering ? 0.65 + awareness * 0.1 : 0.35 + awareness * 0.08 + (0.5 - morale) * 0.12;
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
  const startAfter = Math.max(
    Number(config?.startAfterMs ?? defaults.startAfterMs),
    Number(ticket?.mmr) > 3000 ? 20000 : 0,
  );
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
  recoveryThreshold,
  getSeatSchedule,
  stagedSeatCount,
};
