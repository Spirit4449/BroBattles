const { getResolvedCharacterAttackConfig } = require("../../../characters/characterTuning");
const SLIME = getResolvedCharacterAttackConfig("gloop", "slimeball");
const { getParticipant } = require('../participants');
const { attackIdentity } = require('./attackIdentity.js');
const { WORLD_MARGIN } = require("../../matchConfig.js");
const { advanceSlimeball } = require("../../../characters/gloopProjectile");
const { launchTravel } = require('../../launchRamp');
const { launchPoint } = require('../../../characters/characterRig');
const { resolvePlayerWidth, resolvePlayerHeight, resolvePositiveNumber, getAttackCollisionCenter, shotTerrain, sweptCircleOverlapsRect } = require('./geometry.js');
const { hitCircleTargets, circleTouch } = require('./targets.js');

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
  // A rig muzzle (characters/<name>.json) places the spawn on the drawn art.
  const muzzle = runtime.muzzle
    ? launchPoint(playerData.char_class, runtime.muzzle, { x: Number(playerData.x), y: Number(playerData.y), flip: direction < 0 }, angle)
    : null;
  const startPayloadX = Number(actionData?.start?.x);
  const startPayloadY = Number(actionData?.start?.y);
  const originPayloadX = Number(actionData?.origin?.x);
  const originPayloadY = Number(actionData?.origin?.y);
  const startX = Number.isFinite(startPayloadX)
    ? startPayloadX
    : Number.isFinite(originPayloadX)
      ? originPayloadX
      : muzzle ? muzzle.x : Number(playerData.x) +
        Math.cos(angle) *
          width *
          (Number(runtime.forwardOffsetWidthFactor) || 0);
  const startY = Number.isFinite(startPayloadY)
    ? startPayloadY
    : Number.isFinite(originPayloadY)
      ? originPayloadY
      : muzzle ? muzzle.y : Number(playerData.y) -
        height * (Number(runtime.verticalOffsetHeightFactor) || 0) +
        Math.sin(angle) *
          width *
          (Number(runtime.forwardOffsetWidthFactor) || 0);
  return {
    ...attackIdentity(playerData, actionData, descriptor, now),
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
    launchEaseMs: Math.max(0, Number(runtime.launchEaseMs) || 0),
    splashRadius: Math.max(0, Number(runtime.splashRadius) || 0),
    launchStartSpeed: Number(runtime.launchStartSpeed ?? 1),
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
    // Geometry offsets are server-owned tuning; clients cannot move damage
    // independently of the rendered attack.
    collisionForwardOffset: Number(runtime.collisionForwardOffset) || 0,
    collisionOffsetY: Number(runtime.collisionOffsetY) || 0,
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
    // The client's limits, narrowed to the room's world on the first tick.
    floorY: Number.isFinite(Number(actionData?.floorY)) ? Number(actionData.floorY) : Infinity,
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
    worldMinX: Number.isFinite(Number(actionData?.worldMinX)) ? Number(actionData.worldMinX) : -Infinity,
    worldMaxX: Number.isFinite(Number(actionData?.worldMaxX)) ? Number(actionData.worldMaxX) : Infinity,
    effectDurationMs:
      Number(actionData?.slowDurationMs ?? runtime.slowDurationMs ?? SLIME.slowDurationMs),
    effectSpeedMult:
      Number(actionData?.slowSpeedMult ?? runtime.slowSpeedMult ?? SLIME.slowSpeedMult),
    effectJumpMult:
      Number(actionData?.slowJumpMult ?? runtime.slowJumpMult ?? SLIME.slowJumpMult),
  };
}

function tickLinearProjectile(room, attack, descriptor, now = Date.now()) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || attacker.connected === false || attacker.loaded === false) return true;
  const runtime = descriptor?.runtime || {};
  const dtSec = room.FIXED_DT_MS / 1000;
  attack.elapsed += room.FIXED_DT_MS;
  const fromX = attack.x, fromY = attack.y;
  if (attack.launchEaseMs > 0) {
    // Eased launches follow the shared curve the client draws.
    const traveled = launchTravel(attack.elapsed, { speed: attack.speed || runtime.speed,
      launchEaseMs: attack.launchEaseMs, launchStartSpeed: attack.launchStartSpeed });
    const step = traveled - attack.traveled;
    attack.traveled = traveled;
    attack.x += Math.cos(attack.angle) * step;
    attack.y += Math.sin(attack.angle) * step;
  } else {
    attack.traveled += Number(attack.speed || runtime.speed) * dtSec;
    attack.x += Number(attack.vx) * dtSec;
    attack.y += Number(attack.vy) * dtSec;
  }
  // Linear shots ignore terrain, but a built wall is there to stop them.
  const radius = Math.max(1, Number(attack.collisionRadius || runtime.collisionRadius) || 1);
  const blocked = room.gameMode?.getShotBlockers?.(attacker.team)?.some((wall) =>
    sweptCircleOverlapsRect(fromX, fromY, attack.x, attack.y, wall, radius));
  const collisionCenter = getAttackCollisionCenter(attack, runtime);
  const range = Math.max(1, Number(attack.range || runtime.range) || 1);
  if (attack.splashRadius > 0) {
    // Splash shots stop on the first thing they touch (or a wall, or the end
    // of their range) and burst, damaging everyone around the burst once.
    // A struck player is the centre of the burst.
    const touched = blocked ? null : circleTouch(room, attack, collisionCenter.x, collisionCenter.y, radius, now);
    if (!blocked && !touched && attack.traveled < range) return false;
    burstSplash(room, attack, descriptor, attacker, touched || collisionCenter, now);
    return true;
  }
  if (blocked) return true;
  const hitCount = hitCircleTargets(
    room,
    attack,
    descriptor,
    collisionCenter.x,
    collisionCenter.y,
    Math.max(1, Number(attack.collisionRadius || runtime.collisionRadius) || 1),
    now,
  );
  if (attack.destroyOnHit && hitCount > 0) return true;
  return attack.traveled >= range;
}

// Damages every target within the splash radius of `at`, then tells every
// client where the shot burst so their drawn flights stop on the same spot.
function burstSplash(room, attack, descriptor, attacker, at, now) {
  hitCircleTargets(room, attack, descriptor, at.x, at.y, attack.splashRadius, now);
  const type = descriptor?.runtime?.impactActionType;
  if (!type || !room.io?.to) return;
  room.io.to(`game:${room.matchId}`).emit("game:action", {
    playerName: attacker.name,
    character: attacker.char_class,
    origin: { x: attacker.x, y: attacker.y },
    flip: !!attacker.flip,
    action: { type, id: attack.instanceId, x: at.x, y: at.y, ownerEcho: true },
    t: now,
  });
}

function tickBouncingProjectile(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || attacker.connected === false || attacker.loaded === false) return true;
  const world = room.geometry.world;
  attack.floorY = Math.min(attack.floorY, world.y + world.height);
  attack.worldMinX = Math.max(attack.worldMinX, world.x - WORLD_MARGIN);
  attack.worldMaxX = Math.min(attack.worldMaxX, world.x + world.width + WORLD_MARGIN);
  advanceSlimeball(attack, room.FIXED_DT_MS,
    shotTerrain(room, attacker.team, attack.mapCollisionRects),
    () => {
      const hits = hitCircleTargets(room, attack, descriptor, attack.x, attack.y,
        Math.max(1, Number(attack.collisionRadius) || 18), now);
      return attack.destroyOnHit && hits > 0;
    });
  return !!attack.done;
}

module.exports = { buildProjectileLinearAttack, buildProjectileBounceAttack, tickLinearProjectile, tickBouncingProjectile, burstSplash };
