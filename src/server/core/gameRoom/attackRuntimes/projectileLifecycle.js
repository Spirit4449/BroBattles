// Released projectiles outlive their owner; attached attacks and hooks do not.
function isDetachedProjectile(attack) {
  return ['projectile-linear', 'projectile-bounce', 'returning-projectile'].includes(attack?.runtimeKind);
}

function isTrustedProjectileContact(room, attack, payload) {
  return isDetachedProjectile(attack) &&
    room._activeAttacks?.includes(attack) &&
    attack.attackerName === payload.attacker &&
    attack.attackType === payload.attackType &&
    attack.instanceId === payload.instanceId &&
    attack.contactTarget === payload.target;
}

module.exports = { isDetachedProjectile, isTrustedProjectileContact };
