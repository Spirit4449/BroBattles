const { createRuntimeAttack, tickRuntimeAttack } = require("./characterAttackRegistry");

function ensureAttackState(room) {
  if (!room._activeAttacks) room._activeAttacks = [];
  return room._activeAttacks;
}

function registerAttackFromAction(room, playerData, actionData, now = Date.now()) {
  const runtimeAttack = createRuntimeAttack(playerData, actionData, now);
  if (!runtimeAttack) return false;
  runtimeAttack.sourceType = String(actionData?.type || "").toLowerCase();
  ensureAttackState(room).push(runtimeAttack);
  return true;
}

function tickActiveAttacks(room, now = Date.now()) {
  const attacks = ensureAttackState(room);
  if (!attacks.length) return;
  room._activeAttacks = attacks.filter((attack) => {
    try {
      return !tickRuntimeAttack(room, attack, now);
    } catch (_) {
      return false;
    }
  });
}

module.exports = {
  ensureAttackState,
  registerAttackFromAction,
  tickActiveAttacks,
};
