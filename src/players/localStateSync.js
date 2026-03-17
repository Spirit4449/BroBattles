// players/localStateSync.js

export function createLocalStateSync({
  Phaser,
  getPlayer,
  getDead,
  setDead,
  getMaxHealth,
  setMaxHealth,
  getCurrentHealth,
  setCurrentHealth,
  getSuperCharge,
  setSuperCharge,
  getMaxSuperCharge,
  setMaxSuperCharge,
  getAmmoCapacity,
  setAmmoCapacity,
  getAmmoCharges,
  setAmmoCharges,
  getAmmoCooldownMs,
  setAmmoCooldownMs,
  getAmmoReloadMs,
  setAmmoReloadMs,
  getReloadTimerMs,
  setReloadTimerMs,
  getNextFireTime,
  setNextFireTime,
  setMovementSpeedMult,
  setMovementJumpMult,
  updateHealthBar,
}) {
  function setSuperStats(charge, maxCharge) {
    setSuperCharge(charge);
    setMaxSuperCharge(maxCharge);
    updateHealthBar();
  }

  function applyAuthoritativeState(state) {
    if (!state || typeof state !== "object") return;

    if (typeof state.maxHealth === "number" && state.maxHealth > 0) {
      setMaxHealth(state.maxHealth);
    }
    if (typeof state.health === "number") {
      setCurrentHealth(
        Math.max(0, Math.min(getMaxHealth(), Math.round(state.health))),
      );
    }
    if (typeof state.superCharge === "number") {
      setSuperCharge(Math.max(0, Math.round(state.superCharge)));
    }
    if (typeof state.maxSuperCharge === "number" && state.maxSuperCharge > 0) {
      setMaxSuperCharge(Math.round(state.maxSuperCharge));
    }

    const ammo = state.ammoState;
    if (ammo && typeof ammo === "object") {
      const cap = Number(ammo.capacity);
      const charges = Number(ammo.charges);
      const cooldown = Number(ammo.cooldownMs);
      const reload = Number(ammo.reloadMs);
      const reloadTimer = Number(ammo.reloadTimerMs);
      const nextFireIn = Number(ammo.nextFireInMs);

      if (Number.isFinite(cap) && cap > 0) {
        setAmmoCapacity(Math.max(1, Math.round(cap)));
      }
      if (Number.isFinite(charges)) {
        setAmmoCharges(
          Phaser.Math.Clamp(Math.round(charges), 0, getAmmoCapacity()),
        );
      }
      if (Number.isFinite(cooldown) && cooldown > 0) {
        setAmmoCooldownMs(cooldown);
      }
      if (Number.isFinite(reload) && reload > 0) {
        setAmmoReloadMs(reload);
      }
      if (Number.isFinite(reloadTimer) && reloadTimer >= 0) {
        setReloadTimerMs(Phaser.Math.Clamp(reloadTimer, 0, getAmmoReloadMs()));
      }
      if (Number.isFinite(nextFireIn)) {
        setNextFireTime(Date.now() + Math.max(0, nextFireIn));
      }
    }

    if (typeof state.isAlive === "boolean") {
      setDead(!state.isAlive);
      const player = getPlayer();
      if (!getDead() && player) {
        player.alpha = 1;
        if (player.body) player.body.enable = true;
      }
    }

    updateHealthBar();
  }

  function getAmmoSyncState() {
    return {
      capacity: getAmmoCapacity(),
      charges: getAmmoCharges(),
      cooldownMs: getAmmoCooldownMs(),
      reloadMs: getAmmoReloadMs(),
      reloadTimerMs: getReloadTimerMs(),
      nextFireInMs: Math.max(0, Math.round(getNextFireTime() - Date.now())),
    };
  }

  function setPowerupMobility(speedMult = 1, jumpMult = 1) {
    setMovementSpeedMult(
      Number.isFinite(speedMult) ? Math.max(0.5, speedMult) : 1,
    );
    setMovementJumpMult(
      Number.isFinite(jumpMult) ? Math.max(0.5, jumpMult) : 1,
    );
  }

  return {
    setSuperStats,
    applyAuthoritativeState,
    getAmmoSyncState,
    setPowerupMobility,
  };
}
