const { isPlaced } = require('../../targetable.js');
const { combatNow } = require("../clock");
const { exposeDamageHitbox } = require('../damageHitboxes.js');
const effectManager = require("../effects/effectManager.js");
const { getParticipant } = require('../participants');
const { circleAabbOverlap, getPlayerBounds } = require('./geometry.js');
const { sweep } = require('../../../characters/sparrowProjectile');
const { isDetachedProjectile } = require('./projectileLifecycle.js');
const { poseAt } = require('../lagCompensation.js');

// Attacks test targets where their attacker saw them: `viewRewindMs` is
// already bounded by the attack's delivery (shared/combat/attackDelivery.js).
function shotTargetBounds(attack, target, now = Date.now()) {
  return getPlayerBounds(target, poseAt(target, attack?.viewRewindMs, now));
}

function emitServerHit(room, attack, targetName, payload = {}) {
  attack.contactTarget = targetName;
  try {
    return room.handleHit(attack.attackerParticipantId, {
      attacker: attack.attackerName,
      target: targetName,
      attackType: attack.attackType,
      instanceId: attack.instanceId,
      // Range checks use the positions the contact was tested against, not
      // where the target has moved since.
      attackTime: combatNow(room) - (Number(attack.viewRewindMs) || 0),
      damage: payload.damage,
    }, { server: true, runtimeProjectile: attack });
  } finally {
    attack.contactTarget = null;
  }
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
    /^(vault|crate):/.test(String(target.name || ""))
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

const CENTER_CRATE_TARGET = "crate:center";

function getCenterCrateTarget(room) {
  const crate = room?.gameMode?.getCenterCrate?.();
  if (!crate) return null;
  return {
    targetName: CENTER_CRATE_TARGET,
    bounds: {
      left: crate.x - crate.width / 2,
      right: crate.x + crate.width / 2,
      top: crate.y - crate.height / 2,
      bottom: crate.y + crate.height / 2,
    },
  };
}

// Mode objects this attacker can damage, tested before the players.
function getObjectiveTargets(room, attacker) {
  return [getEnemyVaultTarget(room, attacker), getCenterCrateTarget(room)].filter(Boolean);
}

function buildTargetList(room, attackerName, attackerTeam) {
  return Array.from(room.players.values()).filter((target) => {
    if (!target || !target.isAlive) return false;
    if (!isPlaced(target)) return false;
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
      target: target.name,
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
  exposeDamageHitbox(room, attack, { kind: 'circle', x: cx, y: cy, radius }, now);
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || (!attacker.isAlive && !isDetachedProjectile(attack))) return 0;
  attack.hitTimes = attack.hitTimes || Object.create(null);
  let hitCount = 0;

  for (const objective of getObjectiveTargets(room, attacker)) {
    if (attack.hitSet?.has(objective.targetName)) continue;
    const lastObjectiveHitAt = Number(attack.hitTimes[objective.targetName]) || 0;
    if (repeatCooldownMs <= 0 || now - lastObjectiveHitAt >= repeatCooldownMs) {
      if (circleAabbOverlap(cx, cy, radius, objective.bounds)) {
        attack.hitSet?.add(objective.targetName);
        attack.hitTimes[objective.targetName] = now;
        emitServerHit(room, attack, objective.targetName, {
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
    const targetBounds = shotTargetBounds(attack, target, now);
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

// What a circle first touches among the targets this attack could damage,
// without dealing damage: splash projectiles use it to find where they burst.
// Players burst at the centre of their body; mode objects (vault, crate) at
// the contact point, since their centre can be far from where they were hit.
function circleTouch(room, attack, cx, cy, radius, now) {
  exposeDamageHitbox(room, attack, { kind: 'circle', x: cx, y: cy, radius }, now);
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || (!attacker.isAlive && !isDetachedProjectile(attack))) return null;
  let best = null;
  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const bounds = shotTargetBounds(attack, target, now);
    if (!circleAabbOverlap(cx, cy, radius, bounds)) continue;
    const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
    const distance = Math.hypot(x - cx, y - cy);
    if (!best || distance < best.distance) best = { name: target.name, x, y, distance };
  }
  if (best) return best;
  const objective = getObjectiveTargets(room, attacker).find((o) =>
    !attack.hitSet?.has(o.targetName) && circleAabbOverlap(cx, cy, radius, o.bounds));
  return objective ? { name: objective.targetName, x: cx, y: cy, distance: 0 } : null;
}

function hitRectTargets(room, attack, descriptor, rect, now) {
  exposeDamageHitbox(room, attack, { kind: 'rect', ...rect }, now);
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return;
  for (const objective of getObjectiveTargets(room, attacker)) {
    if (attack.hitSet?.has(objective.targetName)) continue;
    const overlap =
      rect.left <= objective.bounds.right &&
      rect.right >= objective.bounds.left &&
      rect.top <= objective.bounds.bottom &&
      rect.bottom >= objective.bounds.top;
    if (overlap) {
      attack.hitSet?.add(objective.targetName);
      emitServerHit(room, attack, objective.targetName, {
        damage: attack.damage,
      });
    }
  }
  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const targetBounds = shotTargetBounds(attack, target, now);
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

// The nearest enemy (or else mode object) a capsule touches, without damaging
// it: splash attacks then burst on it. Players report their body centre.
function capsuleTouch(room, attack, start, end, radius, now) {
  exposeDamageHitbox(room, attack, { kind: 'sweep', a: start, b: end, radius }, now);
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return null;
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
  let best = null;
  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    const bounds = shotTargetBounds(attack, target, now);
    if (sweep(start, end, bounds, radius) === null) continue;
    const x = (bounds.left + bounds.right) / 2, y = (bounds.top + bounds.bottom) / 2;
    const distance = Math.hypot(x - mid.x, y - mid.y);
    if (!best || distance < best.distance) best = { name: target.name, x, y, distance };
  }
  if (best) return best;
  const objective = getObjectiveTargets(room, attacker).find((o) =>
    !attack.hitSet?.has(o.targetName) && sweep(start, end, o.bounds, radius) !== null);
  return objective ? { name: objective.targetName, x: mid.x, y: mid.y, distance: 0 } : null;
}

function hitCapsuleTargets(room, attack, descriptor, start, end, radius, now) {
  exposeDamageHitbox(room, attack, { kind: 'sweep', a: start, b: end, radius }, now);
  const attacker = getParticipant(room, attack.attackerParticipantId);
  if (!attacker || !attacker.isAlive) return 0;
  let hitCount = 0;
  for (const objective of getObjectiveTargets(room, attacker)) {
    if (attack.hitSet?.has(objective.targetName)) continue;
    if (sweep(start, end, objective.bounds, radius) === null) continue;
    attack.hitSet?.add(objective.targetName);
    emitServerHit(room, attack, objective.targetName, { damage: attack.damage });
    hitCount++;
  }
  for (const target of buildTargetList(room, attacker.name, attacker.team)) {
    if (attack.hitSet?.has(target.name)) continue;
    if (sweep(start, end, shotTargetBounds(attack, target, now), radius) === null) continue;
    attack.hitSet?.add(target.name);
    emitServerHit(room, attack, target.name, { damage: attack.damage });
    emitHitAction(room, attack, descriptor, attacker, target, now);
    hitCount++;
  }
  return hitCount;
}

module.exports = { CENTER_CRATE_TARGET, shotTargetBounds, emitServerHit, applyDescriptorHitEffect, getEnemyVaultTarget, getCenterCrateTarget, getObjectiveTargets, buildTargetList, emitHitAction, hitCircleTargets, circleTouch, capsuleTouch, hitRectTargets, hitCapsuleTargets };
