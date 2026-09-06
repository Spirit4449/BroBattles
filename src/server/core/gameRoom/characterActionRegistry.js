const { slimeLaunch } = require("../../../shared/gloopProjectile");
const { getResolvedCharacterAttackConfig } = require("../../../lib/characterTuning");
const { participantId } = require('./participants');
const attackRuntimeManager = require("./attackRuntimeManager");
const { getResolvedAttackDescriptor } = require("./attackDescriptorResolver");

function maybeHandleNinjaReturnSignal(room, playerData, actionData) {
  const actionType = String(actionData?.type || "").toLowerCase();
  if (actionType !== "ninja-shuriken-return") return null;
  if (String(playerData?.char_class || "").toLowerCase() !== "ninja") {
    return { handled: true };
  }
  attackRuntimeManager.requestReturningProjectilePhase(
    room,
    playerData,
    actionData,
  );
  return { handled: true };
}

function broadcastAction(room, playerData, action, timestamp = Date.now()) {
  if (getDescriptor(action?.type)?.character === playerData.char_class && action?.type !== 'ninja-shuriken-return') {
    playerData._visibleAttack = { at: timestamp, startupMs: Number(action.startup) || 0,
      angle: Number.isFinite(action.angle) ? action.angle : (playerData.flip ? Math.PI : 0) };
  }
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
  return getResolvedAttackDescriptor(actionType);
}

function claimActionInstance(room, playerData, actionData, now = Date.now()) {
  const actionId = String(actionData?.id || "").trim();
  if (!actionId) return true;
  room._recentCharacterActions = room._recentCharacterActions || new Map();
  const key =
    `${String(participantId(playerData) || "")}|` +
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

function scheduleWindupRelease(
  room,
  playerData,
  actionData,
  actionNow,
  descriptor,
) {
  const flow = descriptor?.actionFlow || {};
  const startupMs = Math.max(0, Number(flow.startupMs) || 0);
  // Preserve the aimed impulse; translate its origin with the caster during windup.
  let slimeCast = null;
  const castOrigin = { x: playerData.x, y: playerData.y };
  if (actionData.type === "gloop-slimeball") {
    const cfg = getResolvedCharacterAttackConfig("gloop", "slimeball");
    const target = actionData.target || { x: playerData.x + (actionData.direction === -1 ? -320 : 320), y: playerData.y + 40 };
    const fallback = slimeLaunch({ x: playerData.x, y: playerData.y,
      width: playerData._lastWidth || 80, height: playerData._lastHeight || 100 }, target, cfg);
    const { start, angle, speed, initialVy } = actionData;
    const valid = start && [start.x, start.y, angle, speed, initialVy].every(Number.isFinite)
      && Math.hypot(start.x - playerData.x, start.y - playerData.y) <= 100
      && speed > 0 && speed <= cfg.maxLaunchSpeed + 0.001
      && initialVy >= -cfg.maxUpwardSpeed - 0.001
      && Math.abs(Math.sin(angle) * speed - initialVy) < 0.001;
    slimeCast = { ...cfg, ...(valid ? { start: { ...start }, angle, speed, initialVy,
      direction: Math.cos(angle) < 0 ? -1 : 1, target } : fallback) };
  }

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
      type: String(
        flow.releaseActionType || actionData?.type || "",
      ).toLowerCase(),
      startup: 0,
      ownerEcho: flow.releaseOwnerEcho === true,
    };
    if (releaseAction.type === "gloop-slimeball-release") {
      Object.assign(releaseAction, slimeCast, { start: {
        x: slimeCast.start.x + playerData.x - castOrigin.x,
        y: slimeCast.start.y + playerData.y - castOrigin.y,
      } });
      if (room.geometry?.colliders) releaseAction.mapCollisionRects = room.geometry.colliders.map(
        ({ left, right, top, bottom }) => ({ left, right, top, bottom }));
    }
    attackRuntimeManager.registerAttackFromAction(
      room,
      playerData,
      releaseAction,
      Date.now(),
    );
    broadcastAction(room, playerData, releaseAction, Date.now());
  };

  if (startupMs > 0) {
    room.scheduleAction(emitRelease, startupMs);
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

function handleCharacterAction(
  room,
  playerData,
  actionData,
  actionNow = Date.now(),
) {
  const ninjaReturnResult = maybeHandleNinjaReturnSignal(
    room,
    playerData,
    actionData,
  );
  if (ninjaReturnResult?.handled) {
    return ninjaReturnResult;
  }

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
