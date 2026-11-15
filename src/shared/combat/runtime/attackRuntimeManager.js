const { combatNow } = require("./clock");
const { participantId } = require('./participants');
const { FIXED_DT_MS } = require('../../gameConstants');
const {
  createRuntimeAttack,
  tickRuntimeAttack,
  tickRuntimeControlEffects,
} = require("./characterAttackRegistry.js");

function ensureAttackState(room) {
  if (!room._activeAttacks) room._activeAttacks = [];
  return room._activeAttacks;
}

function claimAttackInstance(room, playerData, actionData, now = combatNow(room)) {
  const instanceId = String(actionData?.id || "").trim();
  if (!instanceId) return true;
  room._recentAttackInstances = room._recentAttackInstances || new Map();
  const key =
    `${String(participantId(playerData) || "")}|` +
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
  now = combatNow(room),
) {
  // Dedicated combat protocols accept aim requests, never generic release packets.
  if (playerData.char_class === 'sparrow') return false;
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

// The simulation time at which a runtime projectile registered right now has
// flown 0 ms, so that at every later step s its `elapsed` is s - launchMono.
// tickActiveAttacks advances each attack one step: a release registered
// inside a step before that (scheduled releases, bots) is already one step
// old at this step's time; one registered between steps (a socket request)
// is first advanced by the next step. Release packets carry it so clients
// draw the flight by server age instead of from packet arrival.
function releaseLaunchMono(room) {
  const sim = Number(room?._simulationMono);
  if (!Number.isFinite(sim)) return null;
  return room._attacksAdvancedTick === room._tickId ? sim : sim - (Number(room.FIXED_DT_MS) || FIXED_DT_MS);
}

function tickActiveAttacks(room, now = combatNow(room)) {
  room._attacksAdvancedTick = room._tickId;
  const attacks = ensureAttackState(room);
  if (attacks.length) {
    room._activeAttacks = attacks.filter((attack) => {
      try {
        return !tickRuntimeAttack(room, attack, now);
      } catch (error) {
        room.onCombatError?.(error, attack);
        return false;
      }
    });
  }
  tickRuntimeControlEffects(room, now);
}

module.exports = {
  releaseLaunchMono,
  ensureAttackState,
  registerAttackFromAction,
  tickActiveAttacks,
};
