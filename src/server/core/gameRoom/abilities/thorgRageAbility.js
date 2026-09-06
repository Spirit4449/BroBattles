const THORG_RAGE_KNOCKBACK_X = 400;
const THORG_RAGE_KNOCKBACK_Y = 200;
const effectManager = require("../effects/effectManager");

function activate(player, now) {
  effectManager.apply(player, "thorgRage", now);
}

// damageMult (1.3) is declared in effectDefs.thorgRage.modifiers and applied
// automatically by effectManager.getModifiers() in the combat pipeline.
function applyOutgoingDamageMultiplier(attacker, damage /*, now */) {
  return damage;
}

function getKnockback(attacker, target, now) {
  const rage = effectManager.isActive(attacker, "thorgRage", now);
  if (!target) return null;
  const knockDirection = (target.x || 0) >= (attacker.x || 0) ? 1 : -1;
  return {
    amountX: (rage ? THORG_RAGE_KNOCKBACK_X : 140) * knockDirection,
    amountY: rage ? THORG_RAGE_KNOCKBACK_Y : 60,
  };
}

function requiresMeleeFacingCheck(attackType, isSelf) {
  return false; // The mace completes a full revolution, including behind Thorg.
}

module.exports = {
  key: "thorg",
  activate,
  applyOutgoingDamageMultiplier,
  getKnockback,
  requiresMeleeFacingCheck,
};
