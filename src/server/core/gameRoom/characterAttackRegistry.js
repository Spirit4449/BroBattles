const { getResolvedAttackDescriptor } = require("./attackDescriptorResolver");
const effectManager = require("./effects/effectManager");
const {
  buildThrowArcGeometry,
  sampleThrowArcPoint,
} = require("../../../characters/shared/attackAim.js");
const { WORLD_BOUNDS } = require("../gameRoomConfig");

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

function applyDescriptorHitEffect(
  room,
  attack,
  descriptor,
  attacker,
  target,
  now,
) {
  const effectCfg = descriptor?.events?.onHitEffect;
  if (
    !effectCfg?.type ||
    !target ||
    String(target.name || "").startsWith("vault:")
  ) {
    return;
  }
  try {
    const durationMs = Number.isFinite(Number(attack?.effectDurationMs))
      ? Number(attack.effectDurationMs)
      : Number(attack?.burn?.durationMs) ||
        Number(effectCfg.durationMs) ||
        undefined;
    const totalDamage =
      Number(attack?.burn?.totalDamage) ||
      Number(effectCfg.totalDamage) ||
      undefined;
    const speedMult = Number.isFinite(Number(attack?.effectSpeedMult))
      ? Number(attack.effectSpeedMult)
      : Number(effectCfg.speedMult);
    const jumpMult = Number.isFinite(Number(attack?.effectJumpMult))
      ? Number(attack.effectJumpMult)
      : Number(effectCfg.jumpMult);
    effectManager.apply(
      target,
      String(effectCfg.type),
      now,
      {
        durationMs,
        totalDamage,
        speedMult: Number.isFinite(speedMult) ? speedMult : undefined,
        jumpMult: Number.isFinite(jumpMult) ? jumpMult : undefined,
        sourceSocketId: attacker?.socketId,
        sourceName: attacker?.name,
        sourceTeam: attacker?.team,
      },
      room,
    );
  } catch (_) {}
}

function getEnemyVaultTarget(room, attacker) {
  if (!room?.gameMode?.getVaultState || !attacker?.team) return null;
  const enemyTeam = attacker.team === "team1" ? "team2" : "team1";
  const vault = room.gameMode.getVaultState(enemyTeam);
  if (!vault) return null;
  const x = Number(vault.x);
  const y = Number(vault.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const width = Math.max(40, Number(vault.width) || 150);
  const height = Math.max(40, Number(vault.height) || 180);
  return {
    team: enemyTeam,
    targetName: `vault:${enemyTeam}`,
    bounds: {
      left: x - width / 2,
      right: x + width / 2,
      top: y - height / 2,
      bottom: y + height / 2,
    },
  };
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
    if (target.loaded !== true) return false;
    if (target.name === attackerName) return false;
    if (attackerTeam && target.team && attackerTeam === target.team)
      return false;
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
  if (!attacker || !attacker.isAlive) return 0;
  attack.hitTimes = attack.hitTimes || Object.create(null);
  let hitCount = 0;

  const vaultTarget = getEnemyVaultTarget(room, attacker);
  if (vaultTarget && !attack.hitSet?.has(vaultTarget.targetName)) {
    const lastVaultHitAt = Number(attack.hitTimes[vaultTarget.targetName]) || 0;
    if (repeatCooldownMs <= 0 || now - lastVaultHitAt >= repeatCooldownMs) {
      if (circleAabbOverlap(cx, cy, radius, vaultTarget.bounds)) {
        attack.hitSet?.add(vaultTarget.targetName);
        attack.hitTimes[vaultTarget.targetName] = now;
        emitServerHit(room, attack, vaultTarget.targetName, {
          damage: attack.damage,
        });
        hitCount += 1;
        if (attack.destroyOnHit) return hitCount;
      }
    }
  }

  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const lastHitAt = Number(attack.hitTimes[target.name]) || 0;
    if (repeatCooldownMs > 0 && now - lastHitAt < repeatCooldownMs) continue;
    const targetBounds = getPlayerBounds(target);
    if (!circleAabbOverlap(cx, cy, radius, targetBounds)) continue;
    attack.hitSet?.add(target.name);
    attack.hitTimes[target.name] = now;
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    applyDescriptorHitEffect(room, attack, descriptor, attacker, target, now);
    emitHitAction(room, attack, descriptor, attacker, target, now);
    hitCount += 1;
    if (attack.destroyOnHit) return hitCount;
  }
  return hitCount;
}

function hitRectTargets(room, attack, descriptor, rect, now) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return;
  const vaultTarget = getEnemyVaultTarget(room, attacker);
  if (vaultTarget && !attack.hitSet?.has(vaultTarget.targetName)) {
    const overlap =
      rect.left <= vaultTarget.bounds.right &&
      rect.right >= vaultTarget.bounds.left &&
      rect.top <= vaultTarget.bounds.bottom &&
      rect.bottom >= vaultTarget.bounds.top;
    if (overlap) {
      attack.hitSet?.add(vaultTarget.targetName);
      emitServerHit(room, attack, vaultTarget.targetName, {
        damage: attack.damage,
      });
    }
  }
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

function clampToWorld(value, axis = "x") {
  const margin = Number(WORLD_BOUNDS?.margin) || 0;
  if (axis === "y") {
    const minY = -margin;
    const maxY = (Number(WORLD_BOUNDS?.height) || 1000) + margin;
    return Math.max(minY, Math.min(maxY, Number(value) || 0));
  }
  const minX = -margin;
  const maxX = (Number(WORLD_BOUNDS?.width) || 3600) + margin;
  return Math.max(minX, Math.min(maxX, Number(value) || 0));
}

function resolveLiveGloopPullDestination(room, target, pull) {
  const source = room?.players?.get?.(String(pull?.sourceSocketId || ""));
  const stopDistance = Math.max(1, Number(pull?.stopDistance) || 54);
  const ax = Number(source?.x);
  const ay = Number(source?.y);
  if (!Number.isFinite(ax) || !Number.isFinite(ay)) {
    return {
      x: clampToWorld(Number(pull?.toX) || Number(target?.x) || 0, "x"),
      y: clampToWorld(Number(pull?.toY) || Number(target?.y) || 0, "y"),
    };
  }

  const tx = Number(target?.x) || ax;
  const ty = Number(target?.y) || ay;
  const dx = tx - ax;
  const dy = ty - ay;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  return {
    x: clampToWorld(ax + ux * stopDistance, "x"),
    y: clampToWorld(ay + uy * stopDistance, "y"),
  };
}

function applyGloopPull(room, attacker, target, attack, now) {
  if (!room || !attacker || !target || !target.isAlive) return;
  const stopDistance = Math.max(1, Number(attack.pulledStopDistance) || 54);
  const pullDurationMs = Math.max(120, Number(attack.pullDurationMs) || 640);
  const lockPaddingMs = Math.max(0, Number(attack.pullLockPaddingMs) || 120);
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
    sourceSocketId: attacker.socketId,
    sourceName: attacker.name,
    startedAt: now,
    until: now + pullDurationMs,
    fromX: tx,
    fromY: ty,
    stopDistance,
    toX: clampToWorld(ax + ux * stopDistance, "x"),
    toY: clampToWorld(ay + uy * stopDistance, "y"),
    lastStepAt: now,
    slowDurationMs: Math.max(1, Number(attack.slowDurationMs) || 2200),
    slowSpeedMult: Math.max(0.1, Number(attack.slowSpeedMult) || 0.5),
    slowJumpMult: Math.max(0.1, Number(attack.slowJumpMult) || 0.5),
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
      start: { x: Number(attack.x) || ax, y: Number(attack.y) || ay },
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
      target.connected === false ||
      target.loaded !== true
    ) {
      delete target._gloopPullState;
      continue;
    }
    if (
      now >= Number(pull.until) ||
      !room.players.has(String(pull.sourceSocketId || ""))
    ) {
      delete target._gloopPullState;
      try {
        effectManager.apply(
          target,
          "gloopHookSlow",
          now,
          {
            durationMs: Math.max(1, Number(pull.slowDurationMs) || 2200),
            speedMult: Math.max(0.1, Number(pull.slowSpeedMult) || 0.5),
            jumpMult: Math.max(0.1, Number(pull.slowJumpMult) || 0.5),
          },
          room,
        );
      } catch (_) {}
      continue;
    }

    const startedAt = Number(pull.startedAt) || now;
    const duration = Math.max(1, Number(pull.until) - startedAt);
    const t = Math.max(0, Math.min(1, (now - startedAt) / duration));
    const destination = resolveLiveGloopPullDestination(room, target, pull);
    const stepDt = Math.max(1, now - (Number(pull.lastStepAt) || now - 16));
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
      (Number(target.x) || Number(pull.fromX) || 0) +
        ((Number(destination.x) || 0) -
          (Number(target.x) || Number(pull.fromX) || 0)) *
          easedAlpha,
      "x",
    );
    target.y = clampToWorld(
      (Number(target.y) || Number(pull.fromY) || 0) +
        ((Number(destination.y) || 0) -
          (Number(target.y) || Number(pull.fromY) || 0)) *
          easedAlpha,
      "y",
    );
    target.vx = 0;
    target.vy = 0;
    target.lastInput = now;
  }
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
      Number(actionData?.collisionRadius) ||
        Number(runtime.collisionRadius) ||
        1,
    ),
    burn: actionData?.burn || null,
    destroyOnHit:
      actionData?.destroyOnHit === true || runtime.destroyOnHit === true,
    hitSet: new Set(),
  };
}

function buildProjectileSpreadAttacks(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  const baseAngle = Number.isFinite(Number(actionData?.angle))
    ? Number(actionData.angle)
    : Number(actionData?.direction) === -1
      ? Math.PI
      : 0;
  const configured = Array.isArray(actionData?.projectiles)
    ? actionData.projectiles
    : [];
  const count = configured.length || Math.max(1, Number(runtime.count) || 1);
  const spreadRad =
    ((Number(actionData?.spreadDeg) || Number(runtime.spreadDeg) || 0) *
      Math.PI) /
    180;
  const center = (count - 1) / 2;
  const baseDamage =
    Number(actionData?.damage) ||
    Number(runtime.damagePerProjectile) ||
    Number(playerData.baseDamage) ||
    1;

  return Array.from({ length: count }, (_, index) => {
    const provided = configured[index] || {};
    const offset =
      count === 1
        ? 0
        : ((index - center) / Math.max(1, center)) * (spreadRad / 2);
    const projectileAction = {
      ...actionData,
      id: `${String(actionData?.id || `${playerData.name}:${now}`)}:${index}`,
      angle: Number.isFinite(Number(provided.angle))
        ? Number(provided.angle)
        : baseAngle + offset,
      range:
        Number(provided.range) ||
        Number(actionData?.range) ||
        Number(runtime.range),
      speed:
        Number(provided.speed) ||
        Number(actionData?.speed) ||
        Number(runtime.speed),
      collisionRadius:
        Number(provided.collisionRadius) ||
        Number(actionData?.collisionRadius) ||
        Number(runtime.collisionRadius),
      damage: Number(provided.damage) || baseDamage,
      gravity:
        Number(provided.gravity) ||
        Number(actionData?.gravity) ||
        Number(runtime.gravity),
      maxLifetimeMs:
        Number(provided.maxLifetimeMs) ||
        Number(actionData?.maxLifetimeMs) ||
        Number(runtime.maxLifetimeMs),
      burn: provided.burn || actionData?.burn || null,
      destroyOnHit:
        provided.destroyOnHit === true ||
        actionData?.destroyOnHit === true ||
        runtime.destroyOnHit === true,
    };
    return buildProjectileLinearAttack(
      playerData,
      projectileAction,
      descriptor,
      now,
    );
  }).filter(Boolean);
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
      : Number(runtime.initialVy) || -70,
    maxBounces: Math.max(
      0,
      Number(actionData?.maxBounces) || Number(runtime.maxBounces) || 2,
    ),
    bounceDampingY: Math.max(
      0.1,
      Number(actionData?.bounceDampingY) ||
        Number(runtime.bounceDampingY) ||
        0.74,
    ),
    bounceDampingX: Math.max(
      0.1,
      Number(actionData?.bounceDampingX) ||
        Number(runtime.bounceDampingX) ||
        0.92,
    ),
    airDrag: Math.max(
      0,
      Number(actionData?.airDrag) || Number(runtime.airDrag) || 0,
    ),
    minBounceSpeed: Math.max(
      0,
      Number(actionData?.minBounceSpeed) || Number(runtime.minBounceSpeed) || 0,
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
      Number(actionData?.slowDurationMs) ||
      Number(runtime.slowDurationMs) ||
      2000,
    effectSpeedMult:
      Number(actionData?.slowSpeedMult) || Number(runtime.slowSpeedMult) || 0.7,
    effectJumpMult:
      Number(actionData?.slowJumpMult) || Number(runtime.slowJumpMult) || 0.7,
  };
}

function sweptCircleOverlapsRect(prevX, prevY, nextX, nextY, rect, radius = 0) {
  const left = Number(rect?.left);
  const right = Number(rect?.right);
  const top = Number(rect?.top);
  const bottom = Number(rect?.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return false;
  const minX = Math.min(prevX, nextX) - radius;
  const maxX = Math.max(prevX, nextX) + radius;
  const minY = Math.min(prevY, nextY) - radius;
  const maxY = Math.max(prevY, nextY) + radius;
  return !(maxX < left || minX > right || maxY < top || minY > bottom);
}

function parseRect(rect) {
  const left = Number(rect?.left);
  const right = Number(rect?.right);
  const top = Number(rect?.top);
  const bottom = Number(rect?.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { left, right, top, bottom };
}

function isHorizontalPlatform(rect) {
  const parsed = parseRect(rect);
  if (!parsed) return false;
  return parsed.right - parsed.left >= parsed.bottom - parsed.top;
}

function hitsPlatformTop(prevX, prevY, nextX, nextY, rect, radius = 0) {
  const parsed = parseRect(rect);
  if (!parsed) return false;
  const crossedTop =
    prevY + radius <= parsed.top && nextY + radius >= parsed.top;
  if (!crossedTop) return false;
  const minX = Math.min(prevX, nextX);
  const maxX = Math.max(prevX, nextX);
  return !(maxX + radius < parsed.left || minX - radius > parsed.right);
}

function hitsWallCenter(prevX, nextX, y, rect, vx = 0, radius = 0) {
  const parsed = parseRect(rect);
  if (!parsed) return false;
  const width = parsed.right - parsed.left;
  const height = parsed.bottom - parsed.top;
  if (height < width) return false;
  const centerX = (parsed.left + parsed.right) / 2;
  const yOverlap = y + radius >= parsed.top && y - radius <= parsed.bottom;
  if (!yOverlap) return false;
  if (vx >= 0) return prevX <= centerX && nextX >= centerX;
  return prevX >= centerX && nextX <= centerX;
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
      Number(actionData?.pullDurationMs) ||
        Number(runtime.pullDurationMs) ||
        640,
    ),
    pullLockPaddingMs: Math.max(
      0,
      Number(actionData?.pullLockPaddingMs) ||
        Number(runtime.pullLockPaddingMs) ||
        120,
    ),
    pulledStopDistance: Math.max(
      1,
      Number(actionData?.pulledStopDistance) ||
        Number(runtime.pulledStopDistance) ||
        54,
    ),
    slowDurationMs: Math.max(
      1,
      Number(actionData?.slowDurationMs) ||
        Number(runtime.slowDurationMs) ||
        2200,
    ),
    slowSpeedMult: Math.max(
      0.1,
      Number(actionData?.slowSpeedMult) || Number(runtime.slowSpeedMult) || 0.5,
    ),
    slowJumpMult: Math.max(
      0.1,
      Number(actionData?.slowJumpMult) || Number(runtime.slowJumpMult) || 0.5,
    ),
    hitSet: new Set(),
    destroyOnHit: true,
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
      Number(playerData.x) +
      Math.cos(angle) * (Number(runtime.originOffsetX) || 0),
    originY:
      Number(playerData.y) -
      resolvePlayerHeight(playerData) *
        (Number(runtime.originHeightFactor) || 0),
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
    windupMs: Math.max(
      0,
      Number(actionData?.windupMs) || Number(runtime.windupMs) || 0,
    ),
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
    radius: Math.max(
      1,
      Number(actionData?.coneRadius) || Number(runtime.radius) || 1,
    ),
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

function buildRuntimeAttack(playerData, actionData, now = Date.now()) {
  const descriptor = getDescriptor(actionData?.type);
  const runtimeKind = String(descriptor?.runtime?.kind || "").toLowerCase();
  if (!descriptor || !runtimeKind) return null;
  if (runtimeKind === "projectile-linear") {
    return buildProjectileLinearAttack(playerData, actionData, descriptor, now);
  }
  if (runtimeKind === "projectile-spread") {
    return buildProjectileSpreadAttacks(
      playerData,
      actionData,
      descriptor,
      now,
    );
  }
  if (runtimeKind === "projectile-bounce") {
    return buildProjectileBounceAttack(playerData, actionData, descriptor, now);
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
    return buildReturningProjectileAttack(
      playerData,
      actionData,
      descriptor,
      now,
    );
  }
  if (runtimeKind === "hook-projectile") {
    return buildHookProjectileAttack(playerData, actionData, descriptor, now);
  }
  return null;
}

function tickLinearProjectile(room, attack, descriptor) {
  const attacker = room.players.get(attack.attackerSocketId);
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

function tickBallisticProjectile(room, attack, descriptor) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtSec = room.FIXED_DT_MS / 1000;
  attack.elapsed += room.FIXED_DT_MS;
  const prevX = Number(attack.x) || 0;
  const prevY = Number(attack.y) || 0;
  attack.vy += (Number(attack.gravity) || 0) * dtSec;
  attack.x += Number(attack.vx) * dtSec;
  attack.y += Number(attack.vy) * dtSec;
  attack.traveled += Math.hypot(
    Number(attack.x) - prevX,
    Number(attack.y) - prevY,
  );
  if (
    attack.y >=
    Math.max(
      100,
      Number(WORLD_BOUNDS?.height) || Number(room?.worldHeight) || 1000,
    )
  ) {
    return true;
  }
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
  if (attack.elapsed >= Math.max(150, Number(attack.maxLifetimeMs) || 2500)) {
    return true;
  }
  return false;
}

function tickBouncingProjectile(room, attack, descriptor, now) {
  const attacker = room.players.get(attack.attackerSocketId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const dtSec = room.FIXED_DT_MS / 1000;
  attack.elapsed += room.FIXED_DT_MS;
  const prevX = Number(attack.x) || 0;
  const prevY = Number(attack.y) || 0;
  attack.vy += (Number(attack.gravity) || Number(runtime.gravity) || 0) * dtSec;
  if (Number(attack.airDrag) > 0 && Number(attack.vx) !== 0) {
    const dragFactor = Math.max(0, 1 - Number(attack.airDrag) * dtSec);
    attack.vx = Number(attack.vx) * dragFactor;
  }
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
  const mapCollisionRects = Array.isArray(attack.mapCollisionRects)
    ? attack.mapCollisionRects
    : [];
  for (const rect of mapCollisionRects) {
    if (
      !sweptCircleOverlapsRect(prevX, prevY, attack.x, attack.y, rect, radius)
    ) {
      continue;
    }
    if (
      Number(attack.vy) > 0 &&
      isHorizontalPlatform(rect) &&
      hitsPlatformTop(prevX, prevY, attack.x, attack.y, rect, radius)
    ) {
      const platformTop = Number(rect?.top);
      attack.bounceCount = Number(attack.bounceCount || 0) + 1;
      if (attack.bounceCount > Math.max(0, Number(attack.maxBounces) || 0)) {
        return true;
      }
      attack.y = platformTop - radius;
      const bounceVy =
        Math.abs(Number(attack.vy) || 0) *
        Math.max(0.1, Number(attack.bounceDampingY) || 0.74);
      if (bounceVy < Math.max(0, Number(attack.minBounceSpeed) || 0)) {
        return true;
      }
      attack.vy = -bounceVy;
      attack.vx =
        Number(attack.vx || 0) *
        Math.max(0.1, Number(attack.bounceDampingX) || 0.92);
      break;
    }
    if (
      hitsWallCenter(
        prevX,
        Number(attack.x) || 0,
        Number(attack.y) || 0,
        rect,
        Number(attack.vx) || 0,
        radius,
      )
    ) {
      return true;
    }
  }
  const floorY = Number(attack.floorY);
  if (
    Number.isFinite(floorY) &&
    attack.y + radius >= floorY &&
    Number(attack.vy) > 0
  ) {
    attack.bounceCount = Number(attack.bounceCount || 0) + 1;
    if (attack.bounceCount > Math.max(0, Number(attack.maxBounces) || 0)) {
      return true;
    }
    attack.y = floorY - radius;
    const bounceVy =
      Math.abs(Number(attack.vy) || 0) *
      Math.max(0.1, Number(attack.bounceDampingY) || 0.74);
    if (bounceVy < Math.max(0, Number(attack.minBounceSpeed) || 0)) {
      return true;
    }
    attack.vy = -bounceVy;
    attack.vx =
      Number(attack.vx || 0) *
      Math.max(0.1, Number(attack.bounceDampingX) || 0.92);
  }

  const hitCount = hitCircleTargets(
    room,
    attack,
    descriptor,
    attack.x,
    attack.y,
    radius,
    now,
  );
  if (attack.destroyOnHit && hitCount > 0) return true;

  const minX = Number(attack.worldMinX);
  const maxX = Number(attack.worldMaxX);
  if (Number.isFinite(minX) && Number(attack.x) + radius < minX) return true;
  if (Number.isFinite(maxX) && Number(attack.x) - radius > maxX) return true;
  if (attack.elapsed >= Math.max(150, Number(attack.maxLifetimeMs) || 2500))
    return true;
  if (
    attack.traveled >= Math.max(1, Number(attack.range || runtime.range) || 1)
  )
    return true;
  return false;
}

function tickHookProjectile(room, attack, descriptor, now) {
  const attacker = room.players.get(attack.attackerSocketId);
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
  const growT = Math.min(
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

  const baseAnchorX = Number.isFinite(Number(attack.anchorX))
    ? Number(attack.anchorX)
    : Number(attacker.x) || 0;
  const baseAnchorY = Number.isFinite(Number(attack.anchorY))
    ? Number(attack.anchorY)
    : Number(attacker.y) || 0;
  const angle = Number(attack.angle) || 0;
  const halfSpread =
    (Number(attack.spreadDeg || runtime.spreadDeg || 56) * Math.PI) / 360;
  const radius = Math.max(
    1,
    Number(attack.radius) || Number(runtime.radius) || 1,
  );
  const innerRadius = Math.max(
    0,
    Number(attack.innerRadius) || Number(runtime.innerRadius) || 0,
  );

  const vaultTarget = getEnemyVaultTarget(room, attacker);
  if (vaultTarget && !attack.hitSet?.has(vaultTarget.targetName)) {
    const vaultCenter = getBoundsCenter(vaultTarget.bounds);
    const dx = vaultCenter.x - baseAnchorX;
    const dy = vaultCenter.y - baseAnchorY;
    const dist = Math.hypot(dx, dy);
    const theta = Math.atan2(dy, dx);
    const delta = Math.abs(normalizeAngleDelta(theta, angle));
    if (dist >= innerRadius && dist <= radius + 24 && delta <= halfSpread) {
      attack.hitSet?.add(vaultTarget.targetName);
      emitServerHit(room, attack, vaultTarget.targetName, {
        damage: attack.damage,
      });
    }
  }

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
  const windupMs = Math.max(
    0,
    Number(attack.windupMs) || Number(runtime.windupMs) || 0,
  );
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

  if (!attack.geometry || sampleElapsed <= windupMs + followAfterWindupMs) {
    attack.geometry = buildThrowArcGeometry({
      originX:
        Number(attacker.x) +
        Math.cos(Number(attack.angle) || 0) *
          (Number(runtime.originOffsetX) || 0),
      originY:
        Number(attacker.y) -
        resolvePlayerHeight(attacker) *
          (Number(runtime.originHeightFactor) || 0),
      angle: Number(attack.angle) || 0,
      range: attack.range,
      targetX: Number.isFinite(Number(attack.targetX))
        ? Number(attack.targetX)
        : null,
      targetY: Number.isFinite(Number(attack.targetY))
        ? Number(attack.targetY)
        : null,
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
  if (runtimeKind === "projectile-spread") {
    return tickBallisticProjectile(room, attack, descriptor);
  }
  if (runtimeKind === "projectile-bounce") {
    return tickBouncingProjectile(room, attack, descriptor, now);
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
  if (runtimeKind === "hook-projectile") {
    return tickHookProjectile(room, attack, descriptor, now);
  }
  return true;
}

module.exports = {
  createRuntimeAttack,
  tickRuntimeAttack,
  tickRuntimeControlEffects,
};
