const { getParticipant, participantId } = require('../participants');
const effectManager = require("../effects/effectManager");
const { THORG_SWEEP, sampleThorgSweep } = require("../../../../shared/thorgSweep");
const { resolvePlayerHeight, getBoundsCenter, normalizeAngleDelta, getPlayerBounds } = require('./geometry');
const { hitRectTargets, getEnemyVaultTarget, emitServerHit, buildTargetList, emitHitAction } = require('./targets');

function buildAttachedRectAttack(playerData, actionData, descriptor, now) {
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: String(descriptor?.runtime?.kind || "").toLowerCase(),
    createdAt: now,
    attackerParticipantId: participantId(playerData),
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    hitSet: new Set(),
  };
}

function buildPathRectAttack(playerData, actionData, descriptor, now) {
  return {
    descriptorKey: String(actionData?.type || "").toLowerCase(),
    runtimeKind: "path-rect",
    createdAt: now,
    attackerParticipantId: participantId(playerData),
    attackerName: playerData.name,
    attackType: String(descriptor?.attackType || "basic").toLowerCase(),
    instanceId: String(actionData?.id || `${playerData.name}:${now}`),
    direction: Number(actionData?.direction) === -1 ? -1 : 1,
    hitSet: new Set(),
    previousProgress: 0,
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
    attackerParticipantId: participantId(playerData),
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

function tickAttachedRect(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
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
  const attacker = getParticipant(room, attack.attackerParticipantId);
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
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  const scale = effectManager.isActive(attacker, "thorgRage", now) ? THORG_SWEEP.rageScale : 1;
  const elapsed = now - attack.createdAt;
  if (elapsed < THORG_SWEEP.windupMs) return false;
  const progress = Math.min(1, (elapsed - THORG_SWEEP.windupMs) / THORG_SWEEP.strikeMs);
  const previous = attack.previousProgress || 0;
  // Subsample the curved sweep even after a delayed tick, so neither side can tunnel.
  const steps = Math.max(1, Math.ceil((progress - previous) * 96));
  for (let i = 0; i <= steps; i++) {
    const point = sampleThorgSweep({ x: Number(attacker.x), y: Number(attacker.y), direction: attack.direction, scale },
      previous + (progress - previous) * i / steps);
    hitRectTargets(room, attack, descriptor, {
      left: point.x - THORG_SWEEP.headWidth * scale / 2,
      right: point.x + THORG_SWEEP.headWidth * scale / 2,
      top: point.y - THORG_SWEEP.headHeight * scale / 2,
      bottom: point.y + THORG_SWEEP.headHeight * scale / 2,
    }, now);
  }
  attack.previousProgress = progress;
  return progress >= 1;
}

module.exports = { buildAttachedRectAttack, buildPathRectAttack, buildAttachedConeAttack, tickAttachedRect, tickAttachedCone, tickPathRect };
