// Released projectiles outlive their owner; attached attacks and hooks do not.
function isDetachedProjectile(attack) {
  return ['projectile-linear', 'projectile-bounce', 'returning-projectile'].includes(attack?.runtimeKind);
}

// The contact a live server runtime is reporting right now.
function isRuntimeContact(room, attack, payload) {
  return !!attack && room._activeAttacks?.includes(attack) &&
    attack.attackerName === payload.attacker &&
    attack.attackType === payload.attackType &&
    attack.instanceId === payload.instanceId &&
    attack.contactTarget === payload.target;
}

function isTrustedProjectileContact(room, attack, payload) {
  return isDetachedProjectile(attack) && isRuntimeContact(room, attack, payload);
}

module.exports = { isDetachedProjectile, isRuntimeContact, isTrustedProjectileContact };
