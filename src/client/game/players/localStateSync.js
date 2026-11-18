import { resolveLocalEffectMovement } from '../../../shared/effectRules.js';

// players/localStateSync.js

export function createLocalStateSync({
  getPlayer,
  stats,
  ammo,
  setMovementSpeedMult,
  setMovementJumpMult,
  updateHealthBar,
}) {
  function setSuperStats(charge, maxCharge) {
    stats.superCharge = charge;
    stats.maxSuperCharge = maxCharge;
    updateHealthBar();
  }

  function applyAuthoritativeState(state) {
    if (!state || typeof state !== "object") return;

    if (typeof state.maxHealth === "number" && state.maxHealth > 0) {
      stats.maxHealth = state.maxHealth;
    }
    if (typeof state.health === "number") {
      stats.currentHealth = Math.max(0, Math.min(stats.maxHealth, Math.round(state.health)));
    }
    if (typeof state.superCharge === "number") {
      stats.superCharge = Math.max(0, state.superCharge);
    }
    if (typeof state.maxSuperCharge === "number" && state.maxSuperCharge > 0) {
      stats.maxSuperCharge = state.maxSuperCharge;
    }

    if (state.ammoState) ammo.applyAuthoritative(state.ammoState);

    if (typeof state.isAlive === "boolean") {
      stats.dead = !state.isAlive;
      const player = getPlayer();
      if (!stats.dead && player) {
        player.alpha = 1;
        if (player.body) player.body.enable = true;
      }
    }

    updateHealthBar();
  }

  function getAmmoSyncState() {
    return ammo.snapshot();
  }

  function setPowerupMobility(speedMult = 1, jumpMult = 1) {
    setMovementSpeedMult(
      Number.isFinite(speedMult) ? Math.max(0, speedMult) : 1,
    );
    setMovementJumpMult(Number.isFinite(jumpMult) ? Math.max(0, jumpMult) : 1);
  }

  return {
    setSuperStats,
    applyAuthoritativeState,
    getAmmoSyncState,
    setPowerupMobility,
  };
}

// Apply gameplay state independently of whether any aura graphics exist.
export function syncLocalEffects({ effects, authoritative, setMobility, setInvisible }) {
  const movement = resolveLocalEffectMovement(effects, authoritative);
  setMobility(movement.speedMult, movement.jumpMult);
  setInvisible?.((effects.invisibility || 0) > 0);
}
