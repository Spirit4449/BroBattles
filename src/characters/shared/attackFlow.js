export function executeDefaultAttack({
  scene,
  ammo,
  emitAction,
  payloadBuilder,
  onAfterFire,
  attackResetMs = 300,
  cooldownFallbackMs = 450,
}) {
  const {
    getAmmoCooldownMs,
    tryConsume,
    setCanAttack,
    setIsAttacking,
    drawAmmoBar,
  } = ammo || {};

  if (typeof tryConsume !== "function" || !tryConsume()) {
    return { fired: false, clearAttack: () => {} };
  }

  let cleared = false;
  const clearAttack = () => {
    if (cleared) return;
    cleared = true;
    if (typeof setIsAttacking === "function") setIsAttacking(false);
  };

  if (typeof setIsAttacking === "function") setIsAttacking(true);
  if (typeof setCanAttack === "function") setCanAttack(false);

  const cooldownMs =
    typeof getAmmoCooldownMs === "function"
      ? Number(getAmmoCooldownMs()) || cooldownFallbackMs
      : cooldownFallbackMs;

  const schedule = (ms, fn) => {
    if (!Number.isFinite(ms) || ms < 0 || typeof fn !== "function") return;
    if (scene?.time?.delayedCall) {
      scene.time.delayedCall(ms, fn);
    } else {
      setTimeout(fn, ms);
    }
  };

  schedule(cooldownMs, () => {
    if (typeof setCanAttack === "function") setCanAttack(true);
  });

  if (Number.isFinite(attackResetMs)) {
    schedule(Number(attackResetMs), clearAttack);
  }

  const payload =
    typeof payloadBuilder === "function" ? payloadBuilder() : payloadBuilder;
  if (payload && typeof emitAction === "function") emitAction(payload);

  if (typeof drawAmmoBar === "function") drawAmmoBar();
  if (typeof onAfterFire === "function") onAfterFire();

  return {
    fired: true,
    clearAttack,
    cooldownMs,
  };
}

export function resolveSessionDamage(
  characterStatsDamage,
  fallbackDamage = 1000,
) {
  const session =
    (typeof window !== "undefined" && window.__MATCH_SESSION__) || {};
  const statDamage = session?.stats?.damage;
  if (typeof statDamage === "number" && Number.isFinite(statDamage)) {
    return statDamage;
  }
  if (
    typeof characterStatsDamage === "number" &&
    Number.isFinite(characterStatsDamage)
  ) {
    return characterStatsDamage;
  }
  return fallbackDamage;
}
