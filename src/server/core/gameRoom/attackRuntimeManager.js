const {
  createRuntimeAttack,
  tickRuntimeAttack,
  tickRuntimeControlEffects,
} = require("./characterAttackRegistry");

function ensureAttackState(room) {
  if (!room._activeAttacks) room._activeAttacks = [];
  return room._activeAttacks;
}

function claimAttackInstance(room, playerData, actionData, now = Date.now()) {
  const instanceId = String(actionData?.id || "").trim();
  if (!instanceId) return true;
  room._recentAttackInstances = room._recentAttackInstances || new Map();
  const key =
    `${String(playerData?.socketId || "")}|` +
    `${String(actionData?.type || "").toLowerCase()}|` +
    instanceId;
  for (const [seenKey, seenAt] of room._recentAttackInstances.entries()) {
    if (now - seenAt > 12000) {
      room._recentAttackInstances.delete(seenKey);
    }
  }
  if (room._recentAttackInstances.has(key)) return false;
  room._recentAttackInstances.set(key, now);
  return true;
}

function registerAttackFromAction(
  room,
  playerData,
  actionData,
  now = Date.now(),
) {
  const actionType = String(actionData?.type || "").toLowerCase();
  // Huntress projectiles are client-collision authoritative for now.
  if (
    actionType === "huntress-arrow-release" ||
    actionType === "huntress-burning-arrow"
  ) {
    return false;
  }
  if (!claimAttackInstance(room, playerData, actionData, now)) return false;
  const runtimeAttack = createRuntimeAttack(playerData, actionData, now);
  if (!runtimeAttack) return false;
  const attacks = Array.isArray(runtimeAttack)
    ? runtimeAttack
    : [runtimeAttack];
  const sourceType = String(actionData?.type || "").toLowerCase();
  for (const attack of attacks) {
    if (!attack) continue;
    attack.sourceType = sourceType;
    ensureAttackState(room).push(attack);
  }
  return true;
}

function tickActiveAttacks(room, now = Date.now()) {
  const attacks = ensureAttackState(room);
  if (attacks.length) {
    room._activeAttacks = attacks.filter((attack) => {
      try {
        return !tickRuntimeAttack(room, attack, now);
      } catch (_) {
        return false;
      }
    });
  }
  tickRuntimeControlEffects(room, now);
}

function requestReturningProjectilePhase(room, playerData, actionData) {
  const attacks = ensureAttackState(room);
  if (!attacks.length) return false;
  const socketId = String(playerData?.socketId || "");
  const instanceId = String(actionData?.id || "").trim();
  if (!socketId || !instanceId) return false;

  let applied = false;
  for (const attack of attacks) {
    if (
      !attack ||
      String(attack.runtimeKind || "") !== "returning-projectile"
    ) {
      continue;
    }
    if (String(attack.attackerSocketId || "") !== socketId) continue;
    if (String(attack.instanceId || "") !== instanceId) continue;
    if (String(attack.phase || "") === "return") {
      applied = true;
      continue;
    }
    attack.phase = "return";
    attack.phaseElapsed = 0;
    applied = true;
  }
  return applied;
}

module.exports = {
  ensureAttackState,
  registerAttackFromAction,
  tickActiveAttacks,
  requestReturningProjectilePhase,
};
