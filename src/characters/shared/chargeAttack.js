import {
  ATTACK_CHARGE_MAX_HOLD_MS,
  getAttackChargeConfig,
} from "../../lib/characterStats";

export function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function clampChargeHoldMs(
  value,
  maxHoldMs = ATTACK_CHARGE_MAX_HOLD_MS,
) {
  const ms = Number(value);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  return Math.min(ms, Number(maxHoldMs) || ATTACK_CHARGE_MAX_HOLD_MS);
}

export function getChargeRatioFromHold(
  holdMs,
  maxHoldMs = ATTACK_CHARGE_MAX_HOLD_MS,
) {
  const clampedHold = clampChargeHoldMs(holdMs, maxHoldMs);
  const maxMs = Math.max(1, Number(maxHoldMs) || ATTACK_CHARGE_MAX_HOLD_MS);
  return clamp01(clampedHold / maxMs);
}

export function getChargeRatioFromContext(context) {
  if (!context || typeof context !== "object") return 0;
  if (Number.isFinite(context.chargeRatio)) return clamp01(context.chargeRatio);
  return getChargeRatioFromHold(context.holdMs, context.maxHoldMs);
}

export function resolveCharacterChargeConfig(character) {
  return getAttackChargeConfig(character) || {};
}

export function scaleByCharge({
  baseValue,
  chargeRatio,
  maxScale = 1,
  minScale = 1,
}) {
  const base = Number(baseValue);
  if (!Number.isFinite(base)) return baseValue;
  const ratio = clamp01(chargeRatio);
  const min = Number.isFinite(minScale) ? minScale : 1;
  const max = Number.isFinite(maxScale) ? maxScale : 1;
  const scale = min + (max - min) * ratio;
  return base * scale;
}
