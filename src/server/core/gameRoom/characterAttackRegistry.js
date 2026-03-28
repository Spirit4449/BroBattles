const { getResolvedAttackDescriptor } = require("./attackDescriptorResolver");
const {
  buildThrowArcGeometry,
  sampleThrowArcPoint,
} = require("../../../characters/shared/attackAim.js");

const DEFAULT_TARGET_HALF_WIDTH = 28;
const DEFAULT_TARGET_HALF_HEIGHT = 60;

function getPlayerBounds(target) {
  const halfH = Math.max(
    8,
    Number(target?._bodyHalfHeight) || DEFAULT_TARGET_HALF_HEIGHT,
  );
  const halfW = Math.max(
    4,
    Number(target?._bodyHalfWidth) || DEFAULT_TARGET_HALF_WIDTH,
  );
  const centerX = Number(target.x) + (Number(target?._bodyCenterOffsetX) || 0);
  const centerY = Number(target.y) + (Number(target?._bodyCenterOffsetY) || 0);
  return {
    left: centerX - halfW,
    right: centerX + halfW,
    top: centerY - halfH,
    bottom: centerY + halfH,
  };
}

function getDescriptor(actionType) {
  return getResolvedAttackDescriptor(actionType);
}

function getBoundsCenter(bounds) {
  return {
    x: (Number(bounds?.left) + Number(bounds?.right)) / 2,
    y: (Number(bounds?.top) + Number(bounds?.bottom)) / 2,
  };
}

function normalizeAngleDelta(a, b) {
  let delta = Number(a) - Number(b);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function emitServerHit(room, attack, targetName, payload = {}) {
  room.handleHit(attack.attackerSocketId, {
    attacker: attack.attackerName,
    target: targetName,
    attackType: attack.attackType,
    instanceId: attack.instanceId,
    attackTime: Date.now(),
    damage: payload.damage,
  });
}

function circleAabbOverlap(cx, cy, radius, bounds) {
  const nearestX = Math.max(bounds.left, Math.min(Number(cx), bounds.right));
  const nearestY = Math.max(bounds.top, Math.min(Number(cy), bounds.bottom));
  const dist = Math.hypot(Number(cx) - nearestX, Number(cy) - nearestY);
  return dist <= radius;
}

function buildTargetList(room, attackerName, attackerTeam) {
  return Array.from(room.players.values()).filter((target) => {
    if (!target || !target.isAlive) return false;
    if (target.connected === false || target.loaded !== true) return false;
    if (target.name === attackerName) return false;
    if (attackerTeam && target.team && attackerTeam === target.team) return false;
    return true;
  });
}

function emitHitAction(room, attack, descriptor, attacker, target, now) {
  const eventCfg = descriptor?.events?.onHitAction;
  if (!eventCfg?.type) return;
  const anchor = String(eventCfg.anchor || "target").toLowerCase();
  const baseX = anchor === "attacker" ? Number(attacker.x) : Number(target.x);
  const baseY = anchor === "attacker" ? Number(attacker.y) : Number(target.y);
  room.io.to(`game:${room.matchId}`).emit("game:action", {
    playerName: attacker.name,
    character: attacker.char_class,
    origin: { x: attacker.x, y: attacker.y },
    flip: !!attacker.flip,
    action: {
      type: String(eventCfg.type),
      id: attack.instanceId,
      x: baseX + (Number(eventCfg.offsetX) || 0),
      y: baseY + (Number(eventCfg.offsetY) || 0),
      attacker: attacker.name,
      ownerEcho: eventCfg.ownerEcho === true,
    },
    t: now,
  });
}

function hitCircleTargets(
  room,
  attack,
  descriptor,
  cx,
  cy,
  radius,
  now,
  repeatCooldownMs = 0,
) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return;
  attack.hitTimes = attack.hitTimes || Object.create(null);

  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const lastHitAt = Number(attack.hitTimes[target.name]) || 0;
    if (repeatCooldownMs > 0 && now - lastHitAt < repeatCooldownMs) continue;
    const targetBounds = getPlayerBounds(target);
    if (!circleAabbOverlap(cx, cy, radius, targetBounds)) continue;
    attack.hitSet?.add(target.name);
    attack.hitTimes[target.name] = now;
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    emitHitAction(room, attack, descriptor, attacker, target, now);
  }
}

function hitRectTargets(room, attack, descriptor, rect, now) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return;
  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const targetBounds = getPlayerBounds(target);
    const overlap =
      rect.left <= targetBounds.right &&
      rect.right >= targetBounds.left &&
      rect.top <= targetBounds.bottom &&
      rect.bottom >= targetBounds.top;
    if (!overlap) continue;
    attack.hitSet?.add(target.name);
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    emitHitAction(room, attack, descriptor, attacker, target, now);
  }
}

function cubic(t, p0, p1, p2, p3) {
  const it = 1 - t;
  return (
    it * it * it * p0 +
    3 * it * it * t * p1 +
    3 * it * t * t * p2 +
    t * t * t * p3
  );
}

function resolvePlayerWidth(playerData) {
  return Number(playerData?._lastWidth) || 80;
}

function resolvePlayerHeight(playerData) {
  return Number(playerData?._lastHeight) || 120;
}

function resolvePositiveNumber(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

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
    attackerSocketId: playerData.socketId,
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    direction,
    angle,
    vx: Math.cos(angle) * (Number(runtime.speed) || 0),
    vy: Math.sin(angle) * (Number(runtime.speed) || 0),
    x: startX,
    y: startY,
    startY,
    traveled: 0,
    elapsed: 0,
    damage: Number(actionData?.damage) || Number(playerData.baseDamage) || 1,
    hitSet: new Set(),
  };
}

function buildAttachedRectAttack(playerData, actionData, descriptor, now) {
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(descriptor?.runtime?.kind || "").toLowerCase(),
    createdAt: now,
    attackerSocketId: playerData.socketId,
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    hitSet: new Set(),
  };
}

function buildPathRectAttack(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  const direction = Number(actionData?.direction) === -1 ? -1 : 1;
  const angle = Number.isFinite(Number(actionData?.angle))
    ? Number(actionData.angle)
    : direction < 0
      ? Math.PI
      : 0;
  const range = resolvePositiveNumber(
    actionData?.range,
    Math.max(1, Number(runtime?.range) || 120),
  );
  const targetX = Number(actionData?.target?.x);
  const targetY = Number(actionData?.target?.y);
  const geometry = buildThrowArcGeometry({
    originX:
      Number(playerData.x) + Math.cos(angle) * (Number(runtime.originOffsetX) || 0),
    originY:
      Number(playerData.y) -
      resolvePlayerHeight(playerData) * (Number(runtime.originHeightFactor) || 0),
    angle,
    range,
    targetX: Number.isFinite(targetX) ? targetX : null,
    targetY: Number.isFinite(targetY) ? targetY : null,
    startBackOffset: Math.abs(Number(runtime.startOffsetX) || 0),
    startLiftY: Number(runtime.startOffsetY) || 0,
    endDropY: Number(runtime.endYOffset) || 0,
    arcHeight: Number(runtime.arcHeight) || 0,
    curveMagnitude: Number(runtime.curveMagnitude) || 0,
    samples: 28,
  });
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(descriptor?.runtime?.kind || "").toLowerCase(),
    createdAt: now,
    attackerSocketId: playerData.socketId,
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    direction,
    angle,
    range,
    targetX: Number.isFinite(targetX) ? targetX : null,
    targetY: Number.isFinite(targetY) ? targetY : null,
    windupMs: Math.max(0, Number(actionData?.windupMs) || Number(runtime.windupMs) || 0),
    activeWindowMs: Math.max(
      1,
      Number(actionData?.strikeMs) ||
        Number(actionData?.activeWindowMs) ||
        Number(runtime.activeWindowMs) ||
        1,
    ),
    followAfterWindupMs: Math.max(
      0,
      Number(actionData?.followAfterWindupMs) ||
        Number(runtime.followAfterWindupMs) ||
        0,
    ),
    geometry,
    hitSet: new Set(),
  };
}

function buildAttachedConeAttack(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  const direction = Number(actionData?.direction) === -1 ? -1 : 1;
  const angle = Number.isFinite(Number(actionData?.angle))
    ? Number(actionData.angle)
    : direction < 0
      ? Math.PI
      : 0;
  const anchorX = Number(actionData?.anchor?.x);
  const anchorY = Number(actionData?.anchor?.y);
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(descriptor?.runtime?.kind || "").toLowerCase(),
    createdAt: now,
    attackerSocketId: playerData.socketId,
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    angle,
    direction,
    radius: Math.max(1, Number(actionData?.coneRadius) || Number(runtime.radius) || 1),
    spreadDeg: Math.max(
      1,
      Number(actionData?.coneSpreadDeg) || Number(runtime.spreadDeg) || 1,
    ),
    innerRadius: Math.max(
      0,
      Number(actionData?.coneInnerRadius) || Number(runtime.innerRadius) || 0,
    ),
    anchorX: Number.isFinite(anchorX) ? anchorX : null,
    anchorY: Number.isFinite(anchorY) ? anchorY : null,
    hitSet: new Set(),
  };
}

function buildReturningProjectileAttack(playerData, actionData, descriptor, now) {
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
  const resolvedStartX =
    Number.isFinite(startX) ? startX : Number(playerData.x) || 0;
  const resolvedStartY =
    Number.isFinite(startY) ? startY : Number(playerData.y) || 0;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const normalX = -forwardY;
  const normalY = forwardX;
  const bulgeUp = Math.abs(ctrl2YOffset);

  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(runtime.kind || "").toLowerCase(),
    createdAt: now,
    attackerSocketId: playerData.socketId,
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
      resolvedStartX +
      forwardX * forwardDistance * 0.6 -
      normalX * bulgeUp,
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

function buildRuntimeAttack(playerData, actionData, now = Date.now()) {
  const descriptor = getDescriptor(actionData?.type);
  const runtimeKind = String(descriptor?.runtime?.kind || "").toLowerCase();
  if (!descriptor || !runtimeKind) return null;
  if (runtimeKind === "projectile-linear") {
    return buildProjectileLinearAttack(playerData, actionData, descriptor, now);
  }
  if (runtimeKind === "attached-rect") {
    return buildAttachedRectAttack(playerData, actionData, descriptor, now);
  }
  if (runtimeKind === "attached-cone") {
    return buildAttachedConeAttack(playerData, actionData, descriptor, now);
  }
  if (runtimeKind === "path-rect") {
    return buildPathRectAttack(playerData, actionData, descriptor, now);
  }
  if (runtimeKind === "returning-projectile") {
    return buildReturningProjectileAttack(playerData, actionData, descriptor, now);
  }
  return null;
}

function tickLinearProjectile(room, attack, descriptor) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtSec = room.FIXED_DT_MS / 1000;
  attack.elapsed += room.FIXED_DT_MS;
  attack.traveled += Number(runtime.speed) * dtSec;
  attack.x += Number(attack.vx) * dtSec;
  attack.y += Number(attack.vy) * dtSec;
  hitCircleTargets(
    room,
    attack,
    descriptor,
    attack.x,
    attack.y,
    Math.max(1, Number(runtime.collisionRadius) || 1),
    Date.now(),
  );
  return attack.traveled >= Math.max(1, Number(runtime.range) || 1);
}

function tickAttachedRect(room, attack, descriptor, now) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const elapsed = now - attack.createdAt;
  const totalDurationMs = Math.max(1, Number(runtime.activeWindowMs) || 1);
  const sampleElapsed = Math.min(elapsed, totalDurationMs);
  if (sampleElapsed < Math.max(0, Number(runtime.damageStartMs) || 0)) {
    return elapsed >= totalDurationMs;
  }

  const direction = attacker.flip ? -1 : 1;
  const width = Number(runtime.width) || 1;
  const height = Number(runtime.height) || 1;
  const cx = Number(attacker.x) + direction * (Number(runtime.tipOffset) || 0);
  const baseCenterY =
    Number(attacker.y) -
    resolvePlayerHeight(attacker) * (Number(runtime.centerYFactor) || 0);
  const growT =
    Math.min(
      1,
      sampleElapsed / Math.max(1, Number(runtime.growDurationMs) || 1),
    );
  const currentHeight =
    Math.max(1, Number(runtime.minHeight) || 1) +
    (height - Math.max(1, Number(runtime.minHeight) || 1)) * growT;
  const finalBottom = baseCenterY + height / 2;
  hitRectTargets(
    room,
    attack,
    descriptor,
    {
      left: cx - width / 2,
      right: cx + width / 2,
      top: finalBottom - currentHeight,
      bottom: finalBottom,
    },
    now,
  );
  return elapsed >= totalDurationMs;
}

function tickAttachedCone(room, attack, descriptor, now) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const elapsed = now - attack.createdAt;
  const totalDurationMs = Math.max(1, Number(runtime.activeWindowMs) || 1);
  const sampleElapsed = Math.min(elapsed, totalDurationMs);
  if (sampleElapsed < Math.max(0, Number(runtime.damageStartMs) || 0)) {
    return elapsed >= totalDurationMs;
  }

  const baseAnchorX =
    Number.isFinite(Number(attack.anchorX))
      ? Number(attack.anchorX)
      : Number(attacker.x) || 0;
  const baseAnchorY =
    Number.isFinite(Number(attack.anchorY))
      ? Number(attack.anchorY)
      : Number(attacker.y) || 0;
  const angle = Number(attack.angle) || 0;
  const halfSpread =
    (Number(attack.spreadDeg || runtime.spreadDeg || 56) * Math.PI) / 360;
  const radius = Math.max(1, Number(attack.radius) || Number(runtime.radius) || 1);
  const innerRadius = Math.max(
    0,
    Number(attack.innerRadius) || Number(runtime.innerRadius) || 0,
  );

  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const bounds = getPlayerBounds(target);
    const center = getBoundsCenter(bounds);
    const dx = center.x - baseAnchorX;
    const dy = center.y - baseAnchorY;
    const dist = Math.hypot(dx, dy);
    if (dist < innerRadius || dist > radius + 24) continue;
    const theta = Math.atan2(dy, dx);
    const delta = Math.abs(normalizeAngleDelta(theta, angle));
    if (delta > halfSpread) continue;
    attack.hitSet?.add(target.name);
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    emitHitAction(room, attack, descriptor, attacker, target, now);
  }

  return elapsed >= totalDurationMs;
}

function tickPathRect(room, attack, descriptor, now) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const elapsed = now - attack.createdAt;
  const windupMs = Math.max(0, Number(attack.windupMs) || Number(runtime.windupMs) || 0);
  const activeWindowMs = Math.max(
    1,
    Number(attack.activeWindowMs) || Number(runtime.activeWindowMs) || 1,
  );
  const totalDurationMs = windupMs + activeWindowMs;
  const sampleElapsed = Math.min(elapsed, totalDurationMs);
  const followAfterWindupMs = Math.max(
    0,
    Number(attack.followAfterWindupMs) ||
      Number(runtime.followAfterWindupMs) ||
      0,
  );
  if (sampleElapsed < windupMs) return elapsed >= totalDurationMs;

  if (
    !attack.geometry ||
    sampleElapsed <= windupMs + followAfterWindupMs
  ) {
    attack.geometry = buildThrowArcGeometry({
      originX:
        Number(attacker.x) +
        Math.cos(Number(attack.angle) || 0) * (Number(runtime.originOffsetX) || 0),
      originY:
        Number(attacker.y) -
        resolvePlayerHeight(attacker) * (Number(runtime.originHeightFactor) || 0),
      angle: Number(attack.angle) || 0,
      range: attack.range,
      targetX: Number.isFinite(Number(attack.targetX)) ? Number(attack.targetX) : null,
      targetY: Number.isFinite(Number(attack.targetY)) ? Number(attack.targetY) : null,
      startBackOffset: Math.abs(Number(runtime.startOffsetX) || 0),
      startLiftY: Number(runtime.startOffsetY) || 0,
      endDropY: Number(runtime.endYOffset) || 0,
      arcHeight: Number(runtime.arcHeight) || 0,
      curveMagnitude: Number(runtime.curveMagnitude) || 0,
      samples: 28,
    });
  }

  const progress = Math.min(1, (sampleElapsed - windupMs) / activeWindowMs);
  const point = sampleThrowArcPoint(attack.geometry, progress);
  const centerX = Number(point?.x) || Number(attacker.x) || 0;
  const centerY = Number(point?.y) || Number(attacker.y) || 0;

  hitRectTargets(
    room,
    attack,
    descriptor,
    {
      left: centerX - (Number(runtime.width) || 1) / 2,
      right: centerX + (Number(runtime.width) || 1) / 2,
      top: centerY - (Number(runtime.height) || 1) / 2,
      bottom: centerY + (Number(runtime.height) || 1) / 2,
    },
    now,
  );
  return elapsed >= totalDurationMs;
}

function tickReturningProjectile(room, attack, descriptor) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtMs = room.FIXED_DT_MS;
  const dtSec = dtMs / 1000;
  attack.phaseElapsed += dtMs;
  attack.totalElapsed += dtMs;
  if (attack.totalElapsed > attack.maxLifetimeMs) return true;

  if (attack.phase === "outward") {
    const rawT = Math.max(
      0,
      Math.min(1, attack.phaseElapsed / Math.max(1, attack.outwardDurationMs)),
    );
    const easedT = (1 - Math.cos(Math.PI * rawT)) / 2;
    attack.x = cubic(easedT, attack.startX, attack.ctrl1X, attack.ctrl2X, attack.endX);
    attack.y = cubic(easedT, attack.startY, attack.ctrl1Y, attack.ctrl2Y, attack.endY);
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

  attack.hitSet =
    attack.phase === "return"
      ? attack.phaseHitSets?.return || attack.hitSet
      : attack.phaseHitSets?.outward || attack.hitSet;
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

function createRuntimeAttack(playerData, actionData, now = Date.now()) {
  const descriptor = getDescriptor(actionData?.type);
  if (!descriptor?.runtime) return null;
  return buildRuntimeAttack(playerData, actionData, now);
}

function tickRuntimeAttack(room, attack, now = Date.now()) {
  const descriptor = getDescriptor(attack?.descriptorKey);
  const runtimeKind = String(attack?.runtimeKind || "").toLowerCase();
  if (!descriptor?.runtime || !runtimeKind) return true;
  if (runtimeKind === "projectile-linear") {
    return tickLinearProjectile(room, attack, descriptor);
  }
  if (runtimeKind === "attached-rect") {
    return tickAttachedRect(room, attack, descriptor, now);
  }
  if (runtimeKind === "attached-cone") {
    return tickAttachedCone(room, attack, descriptor, now);
  }
  if (runtimeKind === "path-rect") {
    return tickPathRect(room, attack, descriptor, now);
  }
  if (runtimeKind === "returning-projectile") {
    return tickReturningProjectile(room, attack, descriptor);
  }
  return true;
}

module.exports = {
  createRuntimeAttack,
  tickRuntimeAttack,
};
