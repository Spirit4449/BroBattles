const { getResolvedCharacterSpecialConfig } = require("../../../../shared/characterTuning");
const HOOK = getResolvedCharacterSpecialConfig("gloop", "hook");
const { getParticipant, participantId } = require('../participants');
const effectManager = require("../effects/effectManager");
const { clampToWorld, circleAabbOverlap, getPlayerBounds } = require('./geometry');
const { buildProjectileLinearAttack } = require('./projectiles');
const { getEnemyVaultTarget, emitServerHit, buildTargetList } = require('./targets');

function resolveLiveGloopPullDestination(room, target, pull) {
  const source = getParticipant(room, String(pull?.sourceSocketId || ""));
  const stopDistance = Math.max(1, Number(pull?.stopDistance ?? HOOK.pulledStopDistance));
  const ax = Number(source?.x);
  const ay = Number(source?.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
    return {
      x: clampToWorld(Number(pull?.toX ?? target?.x ?? 0), "x", room),
      y: clampToWorld(Number(pull?.toY ?? target?.y ?? 0), "y", room),
    };
  }

  const tx = Number(target?.x ?? ax);
  const ty = Number(target?.y ?? ay);
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x: clampToWorld(ax + ux * stopDistance, "x", room),
    y: clampToWorld(ay + uy * stopDistance, "y", room),
  };
}

function applyGloopPull(room, attacker, target, attack, now) {
  if (!room || !attacker || !target || !target.isAlive) return;
  const stopDistance = Math.max(1, Number(attack.pulledStopDistance ?? HOOK.pulledStopDistance));
  const pullDurationMs = Math.max(120, Number(attack.pullDurationMs ?? HOOK.pullDurationMs));
  const lockPaddingMs = Math.max(0, Number(attack.pullLockPaddingMs ?? HOOK.pullLockPaddingMs));
  const ax = Number(attacker.x) || 0;
  const ay = Number(attacker.y) || 0;
  const tx = Number(target.x) || 0;
  const ty = Number(target.y) || 0;
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;

  target._gloopPullState = {
    sourceSocketId: participantId(attacker),
    sourceName: attacker.name,
    startedAt: now,
    until: now + pullDurationMs,
    fromX: tx,
    fromY: ty,
    stopDistance,
    toX: clampToWorld(ax + ux * stopDistance, "x", room),
    toY: clampToWorld(ay + uy * stopDistance, "y", room),
    lastStepAt: now,
    slowDurationMs: Math.max(1, Number(attack.slowDurationMs ?? HOOK.slowDurationMs)),
    slowSpeedMult: Math.max(0, Number(attack.slowSpeedMult ?? HOOK.slowSpeedMult)),
    slowJumpMult: Math.max(0, Number(attack.slowJumpMult ?? HOOK.slowJumpMult)),
  };
  target._controlLockUntil = now + pullDurationMs + lockPaddingMs;
  target.vx = 0;
  target.vy = 0;
  target.inputBuffer = [];
  if (Array.isArray(target._inputIntentQueue)) {
    target._inputIntentQueue.length = 0;
  }
  try {
    effectManager.apply(
      target,
      "stun",
      now,
      { durationMs: pullDurationMs },
      room,
    );
  } catch (_) {}

  room.io.to(`game:${room.matchId}`).emit("game:action", {
    playerName: attacker.name,
    character: attacker.char_class,
    origin: { x: attacker.x, y: attacker.y },
    flip: !!attacker.flip,
    action: {
      type: "gloop-hook-catch",
      id: attack.instanceId,
      target: target.name,
      ownerEcho: true,
      start: { x: Number(attack.x ?? ax), y: Number(attack.y ?? ay) },
      end: { x: target._gloopPullState.toX, y: target._gloopPullState.toY },
      pullDurationMs,
      sourceName: attacker.name,
      pulledStopDistance: stopDistance,
    },
    t: now,
  });
}

function tickRuntimeControlEffects(room, now = Date.now()) {
  if (!room?.players) return;
  for (const target of room.players.values()) {
    const pull = target?._gloopPullState;
    if (!pull) continue;
    if (
      !target.isAlive ||
      target.loaded !== true
    ) {
      delete target._gloopPullState;
      continue;
    }
    if (
      now >= Number(pull.until) ||
      !getParticipant(room, String(pull.sourceSocketId || ""))
    ) {
      delete target._gloopPullState;
      try {
        effectManager.apply(
          target,
          "gloopHookSlow",
          now,
          {
            durationMs: Math.max(1, Number(pull.slowDurationMs ?? HOOK.slowDurationMs)),
            speedMult: Math.max(0, Number(pull.slowSpeedMult ?? HOOK.slowSpeedMult)),
            jumpMult: Math.max(0, Number(pull.slowJumpMult ?? HOOK.slowJumpMult)),
          },
          room,
        );
      } catch (_) {}
      continue;
    }

    const startedAt = Number(pull.startedAt ?? now);
    const duration = Math.max(1, Number(pull.until) - startedAt);
    const t = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const destination = resolveLiveGloopPullDestination(room, target, pull);
    const stepDt = Math.max(1, now - (Number(pull.lastStepAt ?? now - 16)));
    pull.lastStepAt = now;
    pull.toX = destination.x;
    pull.toY = destination.y;
    const remainingMs = Math.max(1, Number(pull.until) - now);
    const baseAlpha = stepDt / Math.max(16, remainingMs);
    const easedAlpha = Math.max(
      0.12,
      Math.min(0.75, baseAlpha * (1.15 + t * 2.4)),
    );
    target.x = clampToWorld(
      (Number(target.x ?? pull.fromX ?? 0)) +
        ((Number(destination.x) || 0) -
          (Number(target.x ?? pull.fromX ?? 0))) *
          easedAlpha,
      "x", room,
    );
    target.y = clampToWorld(
      (Number(target.y ?? pull.fromY ?? 0)) +
        ((Number(destination.y) || 0) -
          (Number(target.y ?? pull.fromY ?? 0))) *
          easedAlpha,
      "y", room,
    );
    target.vx = 0;
    target.vy = 0;
    target.lastInput = now;
  }
}

function buildHookProjectileAttack(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  const base = buildProjectileLinearAttack(
    playerData,
    actionData,
    descriptor,
    now,
  );
  return {
    ...base,
    runtimeKind: "hook-projectile",
    pullDurationMs: Math.max(
      120,
      Number(actionData?.pullDurationMs ?? runtime.pullDurationMs ?? HOOK.pullDurationMs),
    ),
    pullLockPaddingMs: Math.max(
      0,
      Number(actionData?.pullLockPaddingMs ?? runtime.pullLockPaddingMs ?? HOOK.pullLockPaddingMs),
    ),
    pulledStopDistance: Math.max(
      1,
      Number(actionData?.pulledStopDistance ?? runtime.pulledStopDistance ?? HOOK.pulledStopDistance),
    ),
    slowDurationMs: Math.max(
      1,
      Number(actionData?.slowDurationMs ?? runtime.slowDurationMs ?? HOOK.slowDurationMs),
    ),
    slowSpeedMult: Math.max(
      0,
      Number(actionData?.slowSpeedMult ?? runtime.slowSpeedMult ?? HOOK.slowSpeedMult),
    ),
    slowJumpMult: Math.max(
      0,
      Number(actionData?.slowJumpMult ?? runtime.slowJumpMult ?? HOOK.slowJumpMult),
    ),
    hitSet: new Set(),
    destroyOnHit: true,
  };
}

function tickHookProjectile(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtSec = room.FIXED_DT_MS / 1000;
  attack.elapsed += room.FIXED_DT_MS;
  const prevX = Number(attack.x) || 0;
  const prevY = Number(attack.y) || 0;
  attack.x += Number(attack.vx || 0) * dtSec;
  attack.y += Number(attack.vy || 0) * dtSec;
  attack.traveled += Math.hypot(
    Number(attack.x) - prevX,
    Number(attack.y) - prevY,
  );

  const radius = Math.max(
    1,
    Number(attack.collisionRadius || runtime.collisionRadius) || 1,
  );
  const vaultTarget = getEnemyVaultTarget(room, attacker);
  if (vaultTarget && !attack.hitSet?.has(vaultTarget.targetName)) {
    if (circleAabbOverlap(attack.x, attack.y, radius, vaultTarget.bounds)) {
      attack.hitSet?.add(vaultTarget.targetName);
      emitServerHit(room, attack, vaultTarget.targetName, {
        damage: attack.damage,
      });
      return true;
    }
  }

  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const targetBounds = getPlayerBounds(target);
    if (!circleAabbOverlap(attack.x, attack.y, radius, targetBounds)) continue;
    attack.hitSet?.add(target.name);
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    applyGloopPull(room, attacker, target, attack, now);
    return true;
  }

  if (attack.elapsed >= Math.max(150, Number(attack.maxLifetimeMs) || 2500))
    return true;
  if (
    attack.traveled >= Math.max(1, Number(attack.range || runtime.range) || 1)
  )
    return true;
  return false;
}

module.exports = { resolveLiveGloopPullDestination, applyGloopPull, tickRuntimeControlEffects, buildHookProjectileAttack, tickHookProjectile };
