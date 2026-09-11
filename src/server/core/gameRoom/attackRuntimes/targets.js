const effectManager = require("../effects/effectManager");
const { getParticipant, participantId } = require('../participants');
const { circleAabbOverlap, getPlayerBounds } = require('./geometry');

function emitServerHit(room, attack, targetName, payload = {}) {
  room.handleHit(attack.attackerParticipantId, {
    attacker: attack.attackerName,
    target: targetName,
    attackType: attack.attackType,
    instanceId: attack.instanceId,
    attackTime: Date.now(),
    damage: payload.damage,
  }, { server: true });
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
  const attacker = getParticipant(room, attack.attackerParticipantId);
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
  const attacker = getParticipant(room, attack.attackerParticipantId);
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

module.exports = { emitServerHit, applyDescriptorHitEffect, getEnemyVaultTarget, buildTargetList, emitHitAction, hitCircleTargets, hitRectTargets };
