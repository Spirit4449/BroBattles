const {
  ATTACK_MAX_DIST_MAP,
  NINJA_CHARGE_RANGE_SCALE_MAX,
  THORG_CHARGE_RANGE_SCALE_MAX,
  HIT_STALENESS_MAX_MS,
  HIT_FUTURE_TOLERANCE_MS,
  HIT_CLOCK_SKEW_ALLOWANCE_MS,
  MELEE_FACING_TOLERANCE,
} = require("../gameRoomConfig");

function clampChargeRatio(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n <= 0) return 0;
  if (n >= 1) return 1;
  return n;
}

function getAttackMaxDist(charClass, attackType, chargeRatio = 0) {
  const key = `${charClass}|${attackType}`;
  const ratio = clampChargeRatio(chargeRatio);
  if (ATTACK_MAX_DIST_MAP[key] !== undefined) {
    const base = ATTACK_MAX_DIST_MAP[key];
    if (attackType === "basic" && charClass === "ninja") {
      return base * (1 + (NINJA_CHARGE_RANGE_SCALE_MAX - 1) * ratio);
    }
    if (attackType === "basic" && charClass === "thorg") {
      return base * (1 + (THORG_CHARGE_RANGE_SCALE_MAX - 1) * ratio);
    }
    return base;
  }
  const fallbackKey = `any|${attackType}`;
  return ATTACK_MAX_DIST_MAP[fallbackKey] ?? 600;
}

function getHistoricalPosition(playerData, targetTimeMs) {
  const hist = playerData._posHistory;
  if (!hist || hist.length === 0) return { x: playerData.x, y: playerData.y };

  if (targetTimeMs <= hist[0].t) return { x: hist[0].x, y: hist[0].y };
  const last = hist[hist.length - 1];
  if (targetTimeMs >= last.t) return { x: last.x, y: last.y };

  for (let i = hist.length - 1; i > 0; i--) {
    const newer = hist[i];
    const older = hist[i - 1];
    if (targetTimeMs < older.t || targetTimeMs > newer.t) continue;

    const dt = Math.max(1, newer.t - older.t);
    const alpha = Math.max(0, Math.min(1, (targetTimeMs - older.t) / dt));
    return {
      x: older.x + (newer.x - older.x) * alpha,
      y: older.y + (newer.y - older.y) * alpha,
    };
  }

  // Fallback for sparse/out-of-order history samples.
  return { x: last.x, y: last.y };
}

function evaluateHitRange({
  attacker,
  target,
  attackType,
  chargeRatio,
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
  const maxDist = getAttackMaxDist(
    attacker.char_class,
    attackType,
    chargeRatio,
  );
  const attackWasFuture =
    attackTimeRaw > now + HIT_FUTURE_TOLERANCE_MS + HIT_CLOCK_SKEW_ALLOWANCE_MS;
  return {
    attackTimeClamped,
    aPos,
    tPos,
    dist,
    maxDist,
    attackWasFuture,
  };
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
  clampChargeRatio,
};
