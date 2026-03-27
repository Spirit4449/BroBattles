const attackDescriptors = require("../../../shared/attackDescriptors.json");
const attackRuntimeManager = require("./attackRuntimeManager");

function broadcastAction(room, playerData, action, timestamp = Date.now()) {
  room.io.to(`game:${room.matchId}`).emit("game:action", {
    playerId: playerData.user_id,
    playerName: playerData.name,
    origin: { x: playerData.x, y: playerData.y },
    flip: !!playerData.flip,
    character: playerData.char_class,
    action,
    t: timestamp,
  });
}

function getDescriptor(actionType) {
  const key = String(actionType || "").toLowerCase();
  return key ? attackDescriptors?.[key] || null : null;
}

function claimActionInstance(room, playerData, actionData, now = Date.now()) {
  const actionId = String(actionData?.id || "").trim();
  if (!actionId) return true;
  room._recentCharacterActions = room._recentCharacterActions || new Map();
  const key =
    `${String(playerData?.socketId || "")}|` +
    `${String(actionData?.type || "").toLowerCase()}|` +
    actionId;
  for (const [entryKey, seenAt] of room._recentCharacterActions.entries()) {
    if (now - seenAt > 8000) {
      room._recentCharacterActions.delete(entryKey);
    }
  }
  if (room._recentCharacterActions.has(key)) return false;
  room._recentCharacterActions.set(key, now);
  return true;
}

function scheduleWindupRelease(room, playerData, actionData, actionNow, descriptor) {
  const flow = descriptor?.actionFlow || {};
  const startupMs = Math.max(0, Number(flow.startupMs) || 0);
  broadcastAction(
    room,
    playerData,
    {
      ...actionData,
      type: String(flow.broadcastType || actionData?.type || "").toLowerCase(),
      startup: startupMs,
    },
    actionNow,
  );

  const emitRelease = () => {
    if (
      room.status !== "active" ||
      !playerData?.isAlive ||
      playerData.connected === false ||
      playerData.loaded !== true
    ) {
      return;
    }
    const releaseAction = {
      ...actionData,
      type: String(flow.releaseActionType || actionData?.type || "").toLowerCase(),
      startup: 0,
      ownerEcho: flow.releaseOwnerEcho === true,
    };
    attackRuntimeManager.registerAttackFromAction(
      room,
      playerData,
      releaseAction,
      Date.now(),
    );
    broadcastAction(room, playerData, releaseAction, Date.now());
  };

  if (startupMs > 0) {
    setTimeout(emitRelease, startupMs);
  } else {
    emitRelease();
  }

  return { handled: true };
}

function registerRuntimeAttack(room, playerData, actionData, actionNow) {
  const registered = attackRuntimeManager.registerAttackFromAction(
    room,
    playerData,
    actionData,
    actionNow,
  );
  if (!registered) return null;
  return { handled: false };
}

function handleCharacterAction(room, playerData, actionData, actionNow = Date.now()) {
  const descriptor = getDescriptor(actionData?.type);
  if (!descriptor) return null;

  const expectedCharacter = String(descriptor?.character || "").toLowerCase();
  const actualCharacter = String(playerData?.char_class || "").toLowerCase();
  if (!expectedCharacter || expectedCharacter !== actualCharacter) return null;

  const flowKind = String(descriptor?.actionFlow?.kind || "").toLowerCase();
  if (!claimActionInstance(room, playerData, actionData, actionNow)) {
    return { handled: true };
  }
  if (flowKind === "windup-release") {
    return scheduleWindupRelease(
      room,
      playerData,
      actionData,
      actionNow,
      descriptor,
    );
  }
  if (flowKind === "runtime-broadcast") {
    registerRuntimeAttack(room, playerData, actionData, actionNow);
    broadcastAction(room, playerData, actionData, actionNow);
    return { handled: true };
  }
  if (flowKind === "server-runtime-only") {
    registerRuntimeAttack(room, playerData, actionData, actionNow);
    return { handled: true };
  }
  return null;
}

module.exports = {
  broadcastAction,
  handleCharacterAction,
};
