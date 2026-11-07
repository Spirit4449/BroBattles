const { exposeDamageHitbox } = require('../damageHitboxes');
const { getParticipant } = require('../participants');
const { attackIdentity } = require('./attackIdentity');
const effectManager = require("../effects/effectManager");
const { THORG_SWEEP } = require("../../../../shared/characters/thorgSweep");
const { attachedRectShape, pathSweepShapes, pathSweepProgress, sectorShape, shapeTouches } = require("../../../../shared/combat/attackDelivery");
const { resolvePlayerHeight } = require('./geometry');
const { wizardChargeShapes, chargeConfig } = require('../../../../shared/characters/wizardCharge');
const CHARGE = chargeConfig();
const { burstSplash } = require('./projectiles');
const { hitRectTargets, hitCapsuleTargets, capsuleTouch, getObjectiveTargets, CENTER_CRATE_TARGET, emitServerHit, buildTargetList, emitHitAction, shotTargetBounds } = require('./targets');

function buildAttachedRectAttack(playerData, actionData, descriptor, now) {
  return {
    ...attackIdentity(playerData, actionData, descriptor, now),
    hitSet: new Set(),
  };
}

function buildPathRectAttack(playerData, actionData, descriptor, now) {
  return {
    ...attackIdentity(playerData, actionData, descriptor, now, "path-rect"),
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
    ...attackIdentity(playerData, actionData, descriptor, now),
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

// Attached attacks: shapes come from src/shared/combat/attackDelivery.js, the
// same functions the attacker's client predicts with, and targets are tested
// where the attacker saw them (shotTargetBounds, bounded by the delivery).
function attackerPoseOf(attacker, extra = {}) {
  return { x: Number(attacker.x), y: Number(attacker.y), flip: !!attacker.flip,
    height: resolvePlayerHeight(attacker), ...extra };
}

// A charging fireball (wizard): live while the caster winds up, it bursts on the
// first enemy touching it, splashing everyone around, and cancels the release.
// `windup` is shared with the scheduled release (characterActionRegistry).
function buildAttachedChargeAttack(playerData, actionData, descriptor, now) {
  const runtime = descriptor?.runtime || {};
  return {
    ...attackIdentity(playerData, actionData, descriptor, now),
    windup: actionData?._windup || { burst: false },
    interruptSeq: playerData._attackInterruptSeq || 0,
    damage: Number(actionData?.damage) || Number(playerData.baseDamage) || 1,
    splashRadius: Math.max(1, Number(runtime.splashRadius) || 1),
    hitSet: new Set(),
  };
}

function tickAttachedCharge(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive || attacker.connected === false || attacker.loaded === false) return true;
  if ((attacker._attackInterruptSeq || 0) !== attack.interruptSeq) return true;
  const elapsed = now - attack.createdAt;
  if (elapsed >= CHARGE.endMs) return true; // the release takes over
  const shapes = wizardChargeShapes(attackerPoseOf(attacker), elapsed, CHARGE);
  if (!shapes.length) return false;
  const [{ a, b, radius }] = shapes;
  const touched = capsuleTouch(room, attack, a, b, radius, now);
  if (!touched) return false;
  attack.windup.burst = true;
  burstSplash(room, attack, descriptor, attacker, touched, now);
  return true;
}

function tickAttachedRect(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  const runtime = descriptor?.runtime || {};
  const elapsed = now - attack.createdAt;
  const totalDurationMs = Math.max(1, Number(runtime.activeWindowMs) || 1);
  for (const shape of attachedRectShape(attackerPoseOf(attacker), runtime, elapsed)) {
    hitRectTargets(room, attack, descriptor, shape, now);
  }
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

  const anchor = {
    x: Number.isFinite(Number(attack.anchorX)) ? Number(attack.anchorX) : Number(attacker.x) || 0,
    y: Number.isFinite(Number(attack.anchorY)) ? Number(attack.anchorY) : Number(attacker.y) || 0,
  };
  const shape = sectorShape(anchor, {
    angle: Number(attack.angle) || 0,
    halfSpread: (Number(attack.spreadDeg || runtime.spreadDeg || 56) * Math.PI) / 360,
    radius: Math.max(1, Number(attack.radius) || Number(runtime.radius) || 1),
    innerRadius: Math.max(0, Number(attack.innerRadius) || Number(runtime.innerRadius) || 0),
  });

  exposeDamageHitbox(room, attack, { kind: 'sector', x: shape.x, y: shape.y, radius: shape.radius + 24,
    innerRadius: shape.innerRadius, angle: shape.angle, halfSpread: shape.halfSpread }, now);
  for (const objective of getObjectiveTargets(room, attacker)) {
    if (attack.hitSet?.has(objective.targetName)) continue;
    // Tested at its centre, so the crate's half width counts as reach: you
    // swing at its side, and it should not need hugging to take the hit.
    const reach = 24 +
      (objective.targetName === CENTER_CRATE_TARGET ? (objective.bounds.right - objective.bounds.left) / 2 : 0);
    if (shapeTouches(shape, objective.bounds, { reach })) {
      attack.hitSet?.add(objective.targetName);
      emitServerHit(room, attack, objective.targetName, {
        damage: attack.damage,
      });
    }
  }

  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    if (!shapeTouches(shape, shotTargetBounds(attack, target, now), { reach: 24 })) continue;
    attack.hitSet?.add(target.name);
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    emitHitAction(room, attack, descriptor, attacker, target, now);
  }

  return elapsed >= totalDurationMs;
}

function tickPathRect(room, attack, descriptor, now) {
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return true;
  const progress = pathSweepProgress(now - attack.createdAt);
  if (progress === null) return false;
  const pose = attackerPoseOf(attacker, {
    scale: effectManager.isActive(attacker, "thorgRage", now) ? THORG_SWEEP.rageScale : 1,
    legacy: ['thorg-storm', 'thorg-iron'].includes(attacker.selected_skin_id),
  });
  for (const shape of pathSweepShapes(pose, attack.direction, attack.previousProgress || 0, progress)) {
    hitCapsuleTargets(room, attack, descriptor, shape.a, shape.b, shape.radius, now);
  }
  attack.previousProgress = progress;
  return progress >= 1;
}

module.exports = {
  buildAttachedChargeAttack,
  tickAttachedCharge, buildAttachedRectAttack, buildPathRectAttack, buildAttachedConeAttack, tickAttachedRect, tickAttachedCone, tickPathRect };
