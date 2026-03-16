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
  if (!effectManager.isActive(attacker, "thorgRage", now)) return null;
  if (!target?.socketId) return null;
  const knockDirection = (target.x || 0) >= (attacker.x || 0) ? 1 : -1;
  return {
    amountX: THORG_RAGE_KNOCKBACK_X * knockDirection,
    amountY: THORG_RAGE_KNOCKBACK_Y,
  };
}

function requiresMeleeFacingCheck(attackType, isSelf) {
  return !isSelf && attackType === "basic";
}

module.exports = {
  key: "thorg",
  activate,
  applyOutgoingDamageMultiplier,
  getKnockback,
  requiresMeleeFacingCheck,
};
