const { safeWalkDirection } = require("./navigation");
const { isMovementSuppressed } = require("../../../shared/combat/runtime/abilityRuntimeManager.js");

function startDuck(brain, now, duration, kind) {
  const p = brain.player;
  if (!p.grounded || p._controlLockUntil > now || isMovementSuppressed(p, now)) return false;
  const priorDirection = Math.sign(brain.intent.direction || 0);
  const longHold = brain.random() < 0.28;
  const resolvedDuration = longHold
    ? Math.max(duration, brain.between(750, 1300))
    : duration;
  const movingChance = kind === 'strategic' ? 0.34 : 0.6;
  brain.duckDirection = brain.random() < movingChance
    ? priorDirection || (p.flip ? -1 : 1)
    : 0;
  brain.clearTravel();
  brain.intent = { direction: brain.getDuckDirection(), jumpPressed: false };
  brain.duckUntil = now + resolvedDuration;
  p.ducking = true;
  brain.idleUntil = Math.max(brain.idleUntil || 0, brain.duckUntil);
  brain.metrics[kind === 'strategic' ? 'strategicDucks' : 'flavorDucks']++;
  return true;
}

function getDuckDirection(brain) {
  if (!brain.duckDirection) return 0;
  const safeDirection = safeWalkDirection(
    brain.player,
    brain.duckDirection,
    brain.movementGeometry(),
  );
  if (safeDirection) brain.duckDirection = safeDirection;
  return safeDirection;
}

function tryStrategicDuck(brain, threat, now) {
  if (now < brain.nextStrategicDuckAt || Number(threat?.impactIn) > 0.42) return false;
  const awareness = brain.profile.tacticalAwareness ?? 0.5;
  // Even strong bots occasionally mistime a block; brain keeps ducking from
  // becoming a guaranteed response to every unavoidable hit.
  if (brain.random() > 0.74 + awareness * 0.22) return false;
  const duration = Math.max(300, Math.min(680, Number(threat.impactIn || 0) * 1000 + 260));
  if (!brain.startDuck(now, duration, 'strategic')) return false;
  brain.nextStrategicDuckAt = brain.duckUntil + brain.between(1400, 2600);
  brain.nextFlavorDuckAt = Math.max(brain.nextFlavorDuckAt, brain.duckUntil + brain.between(4000, 7000));
  return true;
}

function maybeFlavorDuck(brain, immediatePressure, now) {
  if (now < brain.nextFlavorDuckAt) return false;
  const p = brain.player;
  if (immediatePressure || !p.grounded || brain.traversal || brain.maneuver || brain.approachEdge ||
      p._botActionUntil > now || Math.abs(p.vx || 0) > 18) {
    brain.nextFlavorDuckAt = now + brain.between(1200, 2600);
    return false;
  }
  brain.nextFlavorDuckAt = now + brain.between(7500, 15000);
  if (brain.random() > 0.46) return false;
  return brain.startDuck(now, brain.between(220, 560), 'flavor');
}

module.exports = { startDuck, getDuckDirection, tryStrategicDuck, maybeFlavorDuck };
