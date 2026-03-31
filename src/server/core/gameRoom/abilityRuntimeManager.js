const thorgRageAbility = require("./abilities/thorgRageAbility");
const dravenInfernoAbility = require("./abilities/dravenInfernoAbility");
const wizardArcaneSurgeAbility = require("./abilities/wizardArcaneSurgeAbility");

const abilitiesByCharacter = {
  [thorgRageAbility.key]: thorgRageAbility,
  [dravenInfernoAbility.key]: dravenInfernoAbility,
  [wizardArcaneSurgeAbility.key]: wizardArcaneSurgeAbility,
};

function getAbility(character) {
  return abilitiesByCharacter[String(character || "").toLowerCase()] || null;
}

function activateSpecial(room, player, now, payload = null) {
  const ability = getAbility(player?.char_class);
  if (!ability || typeof ability.activate !== "function") return;
  ability.activate(player, now, room, payload);
}

function tickActiveAbilities(room, now) {
  for (const caster of room.players.values()) {
    const ability = getAbility(caster?.char_class);
    if (!ability || typeof ability.tick !== "function") continue;
    ability.tick(room, caster, now);
  }
}

function isMovementSuppressed(player, now) {
  const ability = getAbility(player?.char_class);
  if (!ability || typeof ability.isMovementSuppressed !== "function") {
    return false;
  }
  return !!ability.isMovementSuppressed(player, now);
}

function applyOutgoingDamageMultiplier(attacker, damage, now) {
  const ability = getAbility(attacker?.char_class);
  if (!ability || typeof ability.applyOutgoingDamageMultiplier !== "function") {
    return damage;
  }
  return ability.applyOutgoingDamageMultiplier(attacker, damage, now);
}

function requiresMeleeFacingCheck(attacker, attackType, isSelf) {
  const ability = getAbility(attacker?.char_class);
  if (!ability || typeof ability.requiresMeleeFacingCheck !== "function") {
    return false;
  }
  return !!ability.requiresMeleeFacingCheck(attackType, isSelf);
}

function getKnockback(attacker, target, now) {
  const ability = getAbility(attacker?.char_class);
  if (!ability || typeof ability.getKnockback !== "function") {
    return null;
  }
  return ability.getKnockback(attacker, target, now);
}

module.exports = {
  activateSpecial,
  tickActiveAbilities,
  isMovementSuppressed,
  applyOutgoingDamageMultiplier,
  requiresMeleeFacingCheck,
  getKnockback,
};
