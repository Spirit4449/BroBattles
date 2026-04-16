const {
  createRuntimeAttack,
  tickRuntimeAttack,
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
  if (!claimAttackInstance(room, playerData, actionData, now)) return false;
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
