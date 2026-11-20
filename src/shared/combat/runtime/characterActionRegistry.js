const { characterDefinitions } = require('../../characters');
const { SOCKET_EVENTS } = require("../../net/socketEvents.js");
const { combatNow } = require("./clock");
const { slimeLaunch } = require("../../characters/gloopProjectile");
const { getResolvedCharacterAttackConfig } = require("../../characters/characterTuning.js");
const { participantId } = require('./participants');
const attackRuntimeManager = require("./attackRuntimeManager.js");
const { getResolvedAttackDescriptor } = require("./attackDescriptorResolver.js");

// Terrain rectangles never go back out: the server flies every shot against
// the room's own colliders, and clients have them from the match bootstrap
// (moving platforms and built walls included). Echoing a client's or the
// map's list sent a whole map's worth of rectangles with every slimeball.
function withoutUnusedTerrain(action) {
  if (!action?.mapCollisionRects) return action;
  const { mapCollisionRects: _unused, ...rest } = action;
  return rest;
}

function broadcastAction(room, playerData, action, timestamp = combatNow(room)) {
  if (getDescriptor(action?.type)?.character === playerData.char_class) {
    playerData._visibleAttack = { at: timestamp, startupMs: Number(action.startup) || 0,
      angle: Number.isFinite(action.angle) ? action.angle : (playerData.flip ? Math.PI : 0) };
  }
  room.broadcast(SOCKET_EVENTS.GAME_ACTION, {
    playerId: playerData.user_id,
    playerName: playerData.name,
    origin: { x: playerData.x, y: playerData.y },
    flip: !!playerData.flip,
    character: playerData.char_class,
    action: withoutUnusedTerrain(action),
    t: timestamp,
  });
}

// A released projectile's packet says where the server launched it and when
// (`launchMono`, simulation clock: its runtime `elapsed` is s - launchMono at
// every step s) and the view rewind it is tested with, so every client draws
// it by server age, and victims lead it (CombatClock.enemyLeadMs).
function stampRelease(room, playerData, action, launchMono) {
  const launched = room.activeAttacks?.findLast(attack => attack.instanceId === action.id && attack.attackerParticipantId === participantId(playerData));
  if (!launched) return action;
  if (Number.isFinite(launched.x) && Number.isFinite(launched.y)) action.start = { x: launched.x, y: launched.y };
  if (Number.isFinite(launchMono)) action.launchMono = Math.round(launchMono * 10) / 10;
  action.viewRewindMs = launched.viewRewindMs || 0;
  return action;
}

function getDescriptor(actionType) {
  return getResolvedAttackDescriptor(actionType);
}

function claimActionInstance(room, playerData, actionData, now = combatNow(room)) {
  const actionId = String(actionData?.id || "").trim();
  if (!actionId) return true;
  room.recentCharacterActions = room.recentCharacterActions || new Map();
  const key =
    `${String(participantId(playerData) || "")}|` +
    `${String(actionData?.type || "").toLowerCase()}|` +
    actionId;
  for (const [entryKey, seenAt] of room.recentCharacterActions.entries()) {
    if (now - seenAt > 8000) {
      room.recentCharacterActions.delete(entryKey);
    }
  }
  if (room.recentCharacterActions.has(key)) return false;
  room.recentCharacterActions.set(key, now);
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
    const fallback = slimeLaunch(castOrigin, target, cfg);
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

  const interruptSeq = playerData._attackInterruptSeq || 0;
  // A charge that bursts on someone during the windup replaces the release.
  const windup = { burst: false };
  if (flow.chargeActionType) {
    attackRuntimeManager.registerAttackFromAction(room, playerData, {
      ...actionData, type: String(flow.chargeActionType).toLowerCase(), _windup: windup,
    }, actionNow);
  }
  const emitRelease = () => {
    if (windup.burst) return;
    if ((playerData._attackInterruptSeq || 0) !== interruptSeq) return;
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
    }
    const launchMono = attackRuntimeManager.releaseLaunchMono(room);
    attackRuntimeManager.registerAttackFromAction(
      room,
      playerData,
      releaseAction,
      combatNow(room),
    );
    stampRelease(room, playerData, releaseAction, launchMono);
    broadcastAction(room, playerData, releaseAction, combatNow(room));
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
  actionNow = combatNow(room),
) {
  const descriptor = getDescriptor(actionData?.type);
  if (!descriptor) return null;

  const expectedCharacter = String(descriptor?.character || "").toLowerCase();
  const actualCharacter = String(playerData?.char_class || "").toLowerCase();
  if (!expectedCharacter || expectedCharacter !== actualCharacter) return null;

  const flowKind = String(descriptor?.actionFlow?.kind || "").toLowerCase();
  if (!claimActionInstance(room, playerData, actionData, actionNow)) {
    return { handled: true };
  }
  if (characterDefinitions[actualCharacter]?.basicAction === actionData.type) {
    room.gameMode?.onAttackAccepted?.(playerData, actionData);
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
  // Started by the server inside another attack (a ozzy's charge); a
  // client may not trigger it on its own.
  if (flowKind === "server-internal") return { handled: true };
  if (flowKind === "server-runtime-only") {
    registerRuntimeAttack(room, playerData, actionData, actionNow);
    return { handled: true };
  }
  return null;
}

module.exports = {
  stampRelease,
  withoutUnusedTerrain,
  broadcastAction,
  handleCharacterAction,
};
