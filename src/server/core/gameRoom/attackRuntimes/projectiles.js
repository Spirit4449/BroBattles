const { getResolvedCharacterAttackConfig } = require("../../../../shared/characterTuning");
const SLIME = getResolvedCharacterAttackConfig("gloop", "slimeball");
const { getParticipant, participantId } = require('../participants');
const { WORLD_BOUNDS } = require("../../gameRoomConfig");
const { advanceSlimeball } = require("../../../../shared/gloopProjectile");
const { resolvePlayerWidth, resolvePlayerHeight, resolvePositiveNumber, sweptCircleOverlapsRect } = require('./geometry');
const { hitCircleTargets } = require('./targets');

function buildProjectileLinearAttack(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  const direction = Number(actionData?.direction) === -1 ? -1 : 1;
  const angle = Number.isFinite(Number(actionData?.angle))
    ? Number(actionData.angle)
    : direction < 0
      ? Math.PI
      : 0;
  const width = resolvePlayerWidth(playerData);
  const height = resolvePlayerHeight(playerData);
  const startPayloadX = Number(actionData?.start?.x);
  const startPayloadY = Number(actionData?.start?.y);
  const originPayloadX = Number(actionData?.origin?.x);
  const originPayloadY = Number(actionData?.origin?.y);
  const startX = Number.isFinite(startPayloadX)
    ? startPayloadX
    : Number.isFinite(originPayloadX)
      ? originPayloadX
      : Number(playerData.x) +
        Math.cos(angle) *
          width *
          (Number(runtime.forwardOffsetWidthFactor) || 0);
  const startY = Number.isFinite(startPayloadY)
    ? startPayloadY
    : Number.isFinite(originPayloadY)
      ? originPayloadY
      : Number(playerData.y) -
        height * (Number(runtime.verticalOffsetHeightFactor) || 0) +
        Math.sin(angle) *
          width *
          (Number(runtime.forwardOffsetWidthFactor) || 0);
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(runtime.kind || "").toLowerCase(),
    createdAt: now,
    attackerParticipantId: participantId(playerData),
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    direction,
    angle,
    speed: resolvePositiveNumber(
      actionData?.speed,
      Math.max(1, Number(runtime.speed) || 1),
    ),
    range: resolvePositiveNumber(
      actionData?.range,
      Math.max(1, Number(runtime.range) || 1),
    ),
    vx:
      Math.cos(angle) *
      resolvePositiveNumber(
        actionData?.speed,
        Math.max(1, Number(runtime.speed) || 1),
      ),
    vy:
      Math.sin(angle) *
      resolvePositiveNumber(
        actionData?.speed,
        Math.max(1, Number(runtime.speed) || 1),
      ),
    gravity: Math.max(
      0,
      Number(actionData?.gravity) || Number(runtime.gravity) || 0,
    ),
    x: startX,
    y: startY,
    startY,
    traveled: 0,
    elapsed: 0,
    maxLifetimeMs: Math.max(
      150,
      Number(actionData?.maxLifetimeMs) ||
        Number(runtime.maxLifetimeMs) ||
        2500,
    ),
    damage: Number(actionData?.damage) || Number(playerData.baseDamage) || 1,
    collisionRadius: Math.max(
      1,
      Number(actionData?.playerCollisionRadius) ||
        Number(actionData?.collisionRadius) ||
        Number(runtime.playerCollisionRadius) ||
        Number(runtime.collisionRadius) ||
        1,
    ),
    burn: actionData?.burn || null,
    destroyOnHit:
      actionData?.destroyOnHit === true || runtime.destroyOnHit === true,
    hitSet: new Set(),
  };
}

function buildProjectileBounceAttack(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  const base = buildProjectileLinearAttack(
    playerData,
    actionData,
    descriptor,
    now,
  );
  const floorFromAction = Number(actionData?.floorY);
  const floorFromRuntime = Number(WORLD_BOUNDS?.height) || 1000;
  return {
    ...base,
    runtimeKind: "projectile-bounce",
    vy: Number.isFinite(Number(actionData?.initialVy))
      ? Number(actionData.initialVy)
      : Number(runtime.initialVy ?? SLIME.initialVy),
    maxBounces: Math.max(
      0,
      Number(actionData?.maxBounces ?? runtime.maxBounces ?? SLIME.maxBounces),
    ),
    bounceDampingY: Math.max(
      0,
      Number(actionData?.bounceDampingY ?? runtime.bounceDampingY ?? SLIME.bounceDampingY),
    ),
    bounceDampingX: Math.max(
      0,
      Number(actionData?.bounceDampingX ?? runtime.bounceDampingX ?? SLIME.bounceDampingX),
    ),
    successiveBounceMultiplier: Math.max(
      0,
      Number(
        actionData?.successiveBounceMultiplier ??
          runtime.successiveBounceMultiplier ??
          SLIME.successiveBounceMultiplier,
      ),
    ),
    airDrag: Math.max(
      0,
      Number(actionData?.airDrag ?? runtime.airDrag ?? SLIME.airDrag),
    ),
    minBounceSpeed: Math.max(
      0,
      Number(actionData?.minBounceSpeed ?? runtime.minBounceSpeed ?? SLIME.minBounceSpeed),
    ),
    floorY: Number.isFinite(floorFromAction)
      ? floorFromAction
      : floorFromRuntime,
    mapCollisionRects: Array.isArray(actionData?.mapCollisionRects)
      ? actionData.mapCollisionRects
          .map((rect) => {
            if (!rect || typeof rect !== "object") return null;
            const left = Number(rect.left);
            const right = Number(rect.right);
            const top = Number(rect.top);
            const bottom = Number(rect.bottom);
            if (![left, right, top, bottom].every(Number.isFinite)) return null;
            return { left, right, top, bottom };
          })
          .filter(Boolean)
      : [],
    bounceCount: 0,
    worldMinX: Number.isFinite(Number(actionData?.worldMinX))
      ? Number(actionData.worldMinX)
      : -((Number(WORLD_BOUNDS?.margin) || 0) + 20),
    worldMaxX: Number.isFinite(Number(actionData?.worldMaxX))
      ? Number(actionData.worldMaxX)
      : (Number(WORLD_BOUNDS?.width) || 3600) +
        (Number(WORLD_BOUNDS?.margin) || 0) +
        20,
    effectDurationMs:
      Number(actionData?.slowDurationMs ?? runtime.slowDurationMs ?? SLIME.slowDurationMs),
    effectSpeedMult:
      Number(actionData?.slowSpeedMult ?? runtime.slowSpeedMult ?? SLIME.slowSpeedMult),
    effectJumpMult:
      Number(actionData?.slowJumpMult ?? runtime.slowJumpMult ?? SLIME.slowJumpMult),
  };
}

function tickLinearProjectile(room, attack, descriptor) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtSec = room.FIXED_DT_MS / 1000;
  attack.elapsed += room.FIXED_DT_MS;
  attack.traveled += Number(attack.speed || runtime.speed) * dtSec;
  attack.x += Number(attack.vx) * dtSec;
  attack.y += Number(attack.vy) * dtSec;
  const hitCount = hitCircleTargets(
    room,
    attack,
    descriptor,
    attack.x,
    attack.y,
    Math.max(1, Number(attack.collisionRadius || runtime.collisionRadius) || 1),
    Date.now(),
  );
  if (attack.destroyOnHit && hitCount > 0) return true;
  return (
    attack.traveled >= Math.max(1, Number(attack.range || runtime.range) || 1)
  );
}

function tickBouncingProjectile(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  advanceSlimeball(attack, room.FIXED_DT_MS,
    room.geometry?.colliders || attack.mapCollisionRects || [],
    () => {
      const hits = hitCircleTargets(room, attack, descriptor, attack.x, attack.y,
        Math.max(1, Number(attack.collisionRadius) || 18), now);
      return attack.destroyOnHit && hits > 0;
    });
  return !!attack.done;
}

module.exports = { buildProjectileLinearAttack, buildProjectileBounceAttack, tickLinearProjectile, tickBouncingProjectile };
