// Runtime dispatch only. Each module owns construction and simulation together.
const { getResolvedAttackDescriptor } = require('./attackDescriptorResolver.js');
const projectiles = require('./attackRuntimes/projectiles.js');
const melee = require('./attackRuntimes/melee.js');
const hook = require('./attackRuntimes/hook.js');
const returning = require('./attackRuntimes/returningProjectile.js');
const ATTACK_RUNTIMES = {
  'projectile-linear': { create: projectiles.buildProjectileLinearAttack, tick: projectiles.tickLinearProjectile },
  'projectile-bounce': { create: projectiles.buildProjectileBounceAttack, tick: projectiles.tickBouncingProjectile },
  'attached-rect': { create: melee.buildAttachedRectAttack, tick: melee.tickAttachedRect },
  'attached-cone': { create: melee.buildAttachedConeAttack, tick: melee.tickAttachedCone },
  'attached-charge': { create: melee.buildAttachedChargeAttack, tick: melee.tickAttachedCharge },
  'path-rect': { create: melee.buildPathRectAttack, tick: melee.tickPathRect },
  'returning-projectile': { create: returning.buildReturningProjectileAttack, tick: returning.tickReturningProjectile },
  'hook-projectile': { create: hook.buildHookProjectileAttack, tick: hook.tickHookProjectile },
};

function createRuntimeAttack(playerData, actionData, now = Date.now()) {
  const descriptor = getResolvedAttackDescriptor(actionData?.type);
  const kind = String(descriptor?.runtime?.kind || '').toLowerCase();
  return ATTACK_RUNTIMES[kind]?.create(playerData, actionData, descriptor, now) || null;
}
function tickRuntimeAttack(room, attack, now = Date.now()) {
  const descriptor = getResolvedAttackDescriptor(attack?.descriptorKey);
  const kind = String(attack?.runtimeKind || '').toLowerCase();
  if (!descriptor?.runtime || !ATTACK_RUNTIMES[kind]) return true;
  return ATTACK_RUNTIMES[kind].tick(room, attack, descriptor, now);
}
module.exports = { ATTACK_RUNTIMES, createRuntimeAttack, tickRuntimeAttack, tickRuntimeControlEffects: hook.tickRuntimeControlEffects };
