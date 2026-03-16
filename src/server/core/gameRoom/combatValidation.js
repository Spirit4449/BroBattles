const {
  ATTACK_MAX_DIST_MAP,
  HIT_STALENESS_MAX_MS,
  MELEE_FACING_TOLERANCE,
} = require("../gameRoomConfig");

function getAttackMaxDist(charClass, attackType) {
  const key = `${charClass}|${attackType}`;
  if (ATTACK_MAX_DIST_MAP[key] !== undefined) return ATTACK_MAX_DIST_MAP[key];
  const fallbackKey = `any|${attackType}`;
  return ATTACK_MAX_DIST_MAP[fallbackKey] ?? 600;
}

function getHistoricalPosition(playerData, targetTimeMs) {
  const hist = playerData._posHistory;
  if (!hist || hist.length === 0) return { x: playerData.x, y: playerData.y };
  let best = hist[hist.length - 1];
  let bestDiff = Math.abs(best.t - targetTimeMs);
  for (let i = hist.length - 2; i >= 0; i--) {
    const diff = Math.abs(hist[i].t - targetTimeMs);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = hist[i];
    }
    if (hist[i].t < targetTimeMs - 500) break;
  }
  return { x: best.x, y: best.y };
}

function evaluateHitRange({
  attacker,
  target,
  attackType,
  attackTimeRaw,
  now,
}) {
  const attackTimeClamped = Math.max(
    now - HIT_STALENESS_MAX_MS,
    Math.min(now, attackTimeRaw),
  );
  const aPos = getHistoricalPosition(attacker, attackTimeClamped);
  const tPos = getHistoricalPosition(target, attackTimeClamped);
  const dist = Math.hypot(aPos.x - tPos.x, aPos.y - tPos.y);
  const maxDist = getAttackMaxDist(attacker.char_class, attackType);
  return { attackTimeClamped, aPos, tPos, dist, maxDist };
}

function isMeleeFacingValid({ attacker, aPos, tPos }) {
  const facingRight = !attacker.flip;
  const relX = tPos.x - aPos.x;
  if (facingRight && relX < -MELEE_FACING_TOLERANCE) return false;
  if (!facingRight && relX > MELEE_FACING_TOLERANCE) return false;
  return true;
}

module.exports = {
  getAttackMaxDist,
  getHistoricalPosition,
  evaluateHitRange,
  isMeleeFacingValid,
};
