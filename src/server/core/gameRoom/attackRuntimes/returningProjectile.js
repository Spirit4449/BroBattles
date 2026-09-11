const { getParticipant, participantId } = require('../participants');
const { resolvePositiveNumber, cubic, sweptCircleOverlapsRect } = require('./geometry');
const { hitCircleTargets } = require('./targets');

function buildReturningProjectileAttack(
  playerData,
  actionData,
  descriptor,
  now,
) {
  const runtime = descriptor?.runtime || {};
  const direction = Number(actionData?.direction) === -1 ? -1 : 1;
  const angle = Number.isFinite(Number(actionData?.angle))
    ? Number(actionData.angle)
    : direction < 0
      ? Math.PI
      : 0;
  const startX = Number(actionData?.x);
  const startY = Number(actionData?.y);
  const forwardDistance = resolvePositiveNumber(
    actionData?.forwardDistance,
    Math.max(1, Number(runtime.defaultForwardDistance) || 500),
  );
  const outwardDurationMs = resolvePositiveNumber(
    actionData?.outwardDuration,
    Math.max(1, Number(runtime.defaultOutwardDurationMs) || 380),
  );
  const returnSpeed = resolvePositiveNumber(
    actionData?.returnSpeed,
    Math.max(1, Number(runtime.defaultReturnSpeed) || 900),
  );
  const endYOffset = Number.isFinite(Number(actionData?.endYOffset))
    ? Number(actionData.endYOffset)
    : Number(runtime.defaultEndYOffset) || 0;
  const ctrl1YOffset = Number.isFinite(Number(actionData?.ctrl1YOffset))
    ? Number(actionData.ctrl1YOffset)
    : Number(runtime.defaultCtrl1YOffset) || 20;
  const ctrl2YOffset = Number.isFinite(Number(actionData?.ctrl2YOffset))
    ? Number(actionData.ctrl2YOffset)
    : Number(runtime.defaultCtrl2YOffset) || -40;
  const resolvedStartX = Number.isFinite(startX)
    ? startX
    : Number(playerData.x) || 0;
  const resolvedStartY = Number.isFinite(startY)
    ? startY
    : Number(playerData.y) || 0;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const normalX = -forwardY;
  const normalY = forwardX;
  const bulgeUp = Math.abs(ctrl2YOffset);

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
    x: resolvedStartX,
    y: resolvedStartY,
    startX: resolvedStartX,
    startY: resolvedStartY,
    endX: resolvedStartX + forwardX * forwardDistance,
    endY: resolvedStartY + forwardY * forwardDistance + endYOffset,
    ctrl1X:
      resolvedStartX +
      forwardX * forwardDistance * 0.25 +
      normalX * ctrl1YOffset,
    ctrl1Y:
      resolvedStartY +
      forwardY * forwardDistance * 0.25 +
      normalY * ctrl1YOffset,
    ctrl2X:
      resolvedStartX + forwardX * forwardDistance * 0.6 - normalX * bulgeUp,
    ctrl2Y:
      resolvedStartY +
      forwardY * forwardDistance * 0.6 -
      normalY * bulgeUp +
      endYOffset * 0.45,
    damage: Number(actionData?.damage) || Number(playerData.baseDamage) || 1,
    outwardDurationMs,
    returnSpeed,
    hoverDurationMs: Math.max(0, Number(runtime.hoverDurationMs) || 100),
    returnAcceleration: Math.max(0, Number(runtime.returnAcceleration) || 800),
    currentReturnSpeed:
      returnSpeed * Math.max(0, Number(runtime.returnStartSpeedFactor) || 0.08),
    maxLifetimeMs: Math.max(250, Number(runtime.maxLifetimeMs) || 7000),
    hitArmMs: Math.max(0, Number(runtime.hitArmMs) || 0),
    hitSet: new Set(),
    hitTimes: Object.create(null),
    phaseHitSets: {
      outward: new Set(),
      return: new Set(),
    },
    phase: "outward",
    phaseElapsed: 0,
    totalElapsed: 0,
  };
}

function tickReturningProjectile(room, attack, descriptor) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtMs = room.FIXED_DT_MS;
  const dtSec = dtMs / 1000;
  const prevX = Number(attack.x) || 0;
  const prevY = Number(attack.y) || 0;
  attack.phaseElapsed += dtMs;
  attack.totalElapsed += dtMs;
  if (attack.totalElapsed > attack.maxLifetimeMs) return true;

  if (attack.phase === "outward") {
    const rawT = Math.max(
      0,
      Math.min(1, attack.phaseElapsed / Math.max(1, attack.outwardDurationMs)),
    );
    const easedT = (1 - Math.cos(Math.PI * rawT)) / 2;
    attack.x = cubic(
      easedT,
      attack.startX,
      attack.ctrl1X,
      attack.ctrl2X,
      attack.endX,
    );
    attack.y = cubic(
      easedT,
      attack.startY,
      attack.ctrl1Y,
      attack.ctrl2Y,
      attack.endY,
    );
    if (rawT >= 1) {
      attack.phase = "hover";
      attack.phaseElapsed = 0;
    }
  } else if (attack.phase === "hover") {
    if (attack.phaseElapsed >= attack.hoverDurationMs) {
      attack.phase = "return";
      attack.phaseElapsed = 0;
    }
  } else if (attack.phase === "return") {
    const dx = Number(attacker.x) - Number(attack.x);
    const dy = Number(attacker.y) - Number(attack.y);
    const dist = Math.hypot(dx, dy) || 1;
    attack.currentReturnSpeed = Math.min(
      attack.returnSpeed,
      attack.currentReturnSpeed + attack.returnAcceleration * dtSec,
    );
    const step = attack.currentReturnSpeed * dtSec;
    attack.x += (dx / dist) * step;
    attack.y += (dy / dist) * step;
    if (dist < 30) return true;
  }

  if (
    attacker.isBot &&
    room.geometry?.colliders.some((rect) =>
      sweptCircleOverlapsRect(
        prevX,
        prevY,
        attack.x,
        attack.y,
        rect,
        Math.max(1, Number(runtime.collisionRadius) || 1),
      ),
    )
  ) {
    return true;
  }

  attack.hitSet =
    attack.phase === "return"
      ? attack.phaseHitSets?.return || attack.hitSet
      : attack.phaseHitSets?.outward || attack.hitSet;
  if (attack.totalElapsed < Math.max(0, Number(attack.hitArmMs) || 0)) {
    return false;
  }
  hitCircleTargets(
    room,
    attack,
    descriptor,
    attack.x,
    attack.y,
    Math.max(1, Number(runtime.collisionRadius) || 1),
    Date.now(),
  );
  return false;
}

module.exports = { buildReturningProjectileAttack, tickReturningProjectile };
