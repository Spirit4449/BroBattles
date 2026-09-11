const huntressModel = require('../../../shared/huntressProjectile');
const { EFFECT_RULES } = require('../../../shared/effectRules');
const ninjaCombat = require('./ninjaCombat');
const huntressCombat = require('./huntressCombat');
const { getParticipant, participantId } = require('./participants');
const {
  NINJA_SWARM_HIT_DAMAGE
} = require("../gameRoomConfig");
const effectManager = require("./effects/effectManager");
const {
  applyOutgoingDamageMultiplier,
  requiresMeleeFacingCheck,
  getKnockback
} = require("./abilityRuntimeManager");
const combatValidation = require("./combatValidation");
const { reduceDuckDamage } = require("../../../shared/ducking");
const { chargeSuperForHit } = require("./superCharge");

function handleHit(room, socketId, payload, { server = false, huntressProjectile = null, ninjaProjectile = null } = {}) {
  try {
    if (!payload || typeof payload !== "object") return;
    const attackerName = String(payload.attacker || "").trim();
    const targetName = String(payload.target || "").trim();
    if (!attackerName || !targetName) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=invalid_names socket=${socketId}`,
        );
      }
      return;
    }

    const attacker = Array.from(room.players.values()).find(
      (p) => p.name === attackerName,
    );
    const trustedNinja = server && ninjaCombat.trusted(room, ninjaProjectile, payload);
    if (attacker?.char_class === 'ninja' && attackerName !== targetName && !trustedNinja) return;
    const trustedHuntress = server && huntressCombat.isTrustedContact(room, huntressProjectile, payload);
    if (attacker?.char_class === 'huntress' &&
        attackerName !== targetName && !trustedHuntress) return;
    if (!server && (getParticipant(room, socketId) !== attacker || attacker?.isBot)) return;
    const target = Array.from(room.players.values()).find(
      (p) => p.name === targetName,
    );
    const vaultMatch = targetName.match(/^vault:(team1|team2)$/i);
    const targetVaultTeam = vaultMatch
      ? String(vaultMatch[1]).toLowerCase()
      : null;
    const targetVault = targetVaultTeam
      ? room.gameMode?.getVaultState?.(targetVaultTeam) || null
      : null;
    if (!attacker || (!target && !targetVault)) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=missing_player attacker=${attackerName} target=${targetName}`,
        );
      }
      return;
    }
    if (
      attacker.connected === false ||
      attacker.loaded !== true ||
      (!targetVault && target.loaded !== true)
    ) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=not_loaded_or_disconnected attacker=${attacker.name} target=${targetVault ? targetName : target.name}`,
        );
      }
      return;
    }
    if (!attacker.isAlive || (!targetVault && !target.isAlive)) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=dead_player attackerAlive=${attacker.isAlive} targetAlive=${target?.isAlive}`,
        );
      }
      return;
    }
    if (targetVault) {
      if (!attacker.team || attacker.team === targetVaultTeam) {
        if (room.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${room.matchId}] reject reason=friendly_vault attacker=${attacker.name} target=${targetName}`,
          );
        }
        return;
      }
    }
    // Allow self-hit (suicide on fall) but otherwise disable friendly fire
    const isSelf = !targetVault && attacker.name === target.name;
    if (
      !isSelf &&
      !targetVault &&
      attacker.team &&
      target.team &&
      attacker.team === target.team
    ) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=friendly_fire attacker=${attacker.name} target=${target.name}`,
        );
      }
      return;
    }

    // Determine damage from server-side stats
    const attackType = String(payload.attackType || "basic").toLowerCase();
    const isNinjaSwarm = attackType === "ninja-special-swarm";
    const isHuntressArrow = attackType === "huntress-arrow";
    const isHuntressBurningArrow = attackType === "huntress-burning-arrow";
    const base = (trustedHuntress || isHuntressArrow || isHuntressBurningArrow)
      ? huntressModel.attackConfig(isHuntressBurningArrow).damagePerArrow
      : isNinjaSwarm
        ? NINJA_SWARM_HIT_DAMAGE
        : attackType === "special"
          ? Number(attacker.specialDamage || 0)
          : Number(attacker.baseDamage || 0);
    let dmg = Number.isFinite(base) && base > 0 ? base : 0;
    // Outgoing damage modifiers (rage powerup, thorgRage ability, damageBoost, etc.)
    const now = Date.now();
    dmg *= effectManager.getModifiers(attacker, now).damageMult;
    dmg = applyOutgoingDamageMultiplier(attacker, dmg, now);

    if (dmg <= 0) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=non_positive_damage attacker=${attacker.name} type=${attackType} dmg=${dmg}`,
        );
      }
      return;
    }

    // Per-character range check with lag-compensated position rewind.
    // The client reports attackTime (wall clock) so the server can look up
    // both players' historical positions at the moment the hit was detected,
    // rather than comparing against the latest (stale) known positions.
    const attackTimeRaw =
      typeof payload.attackTime === "number" &&
      Number.isFinite(payload.attackTime)
        ? payload.attackTime
        : now;
    // Clamp to [now - HIT_STALENESS_MAX_MS, now] — reject absurdly old claims
    // but still handle normal network round-trip delay gracefully.
    let attackTimeClamped = attackTimeRaw;
    let aPos = null;
    let tPos = null;
    let dist = 0;
    let maxDist = room._getAttackMaxDist(attacker.char_class, attackType);
    let attackWasFuture = false;
    if (trustedHuntress || trustedNinja) {
      aPos = { x: attacker.x, y: attacker.y };
      tPos = targetVault ? { x: targetVault.x, y: targetVault.y } : { x: target.x, y: target.y };
    } else if (targetVault) {
      aPos = room._getHistoricalPosition(attacker, attackTimeRaw);
      tPos = { x: Number(targetVault.x) || 0, y: Number(targetVault.y) || 0 };
      attackTimeClamped = Math.min(now, attackTimeRaw);
      attackWasFuture = attackTimeRaw > now + 250;
      dist = Math.hypot(
        Number(aPos?.x || 0) - tPos.x,
        Number(aPos?.y || 0) - tPos.y,
      );
      maxDist += Math.max(20, Number(targetVault.radius) || 90);
      if (
        attackType === "special" ||
        isNinjaSwarm ||
        isHuntressBurningArrow
      ) {
        // Super attacks can hit vaults from farther than basic melee/projectile ranges.
        maxDist = Math.max(maxDist, 2400);
      }
    } else {
      ({ attackTimeClamped, aPos, tPos, dist, maxDist, attackWasFuture } =
        combatValidation.evaluateHitRange({
          attacker,
          target,
          attackType,
          attackTimeRaw,
          now,
        }));
    }
    if (attackWasFuture) {
      if (room.DEV_TIMING_DIAG) {
        console.warn(
          `[GameRoom ${room.matchId}] hit rejected: future attackTime attacker=${attacker.name} target=${targetVault ? targetName : target.name} ` +
            `type=${attackType} raw=${attackTimeRaw} now=${now}`,
        );
      }
      return;
    }
    if (!isSelf && dist > maxDist) {
      if (room.DEV_TIMING_DIAG) {
        console.warn(
          `[GameRoom ${room.matchId}] hit rejected: dist=${dist.toFixed(0)}px > max=${maxDist}px ` +
            `attacker=${attacker.name}(${attacker.char_class}) target=${targetVault ? targetName : target.name} ` +
            `type=${attackType} age=${(now - attackTimeClamped).toFixed(0)}ms`,
        );
      }
      return;
    }

    // Facing-direction check for melee attacks (Draven splash, Thorg fall).
    // The target must be on the side the attacker is facing; a generous tolerance
    // prevents false rejections at the boundary.
    const isMeleeFacing =
      !targetVault && requiresMeleeFacingCheck(attacker, attackType, isSelf);
    if (isMeleeFacing) {
      const validFacing = combatValidation.isMeleeFacingValid({
        attacker,
        aPos,
        tPos,
      });
      if (!validFacing) {
        if (room.DEBUG_HIT_EVENTS) {
          console.log(
            `[HitDebug ${room.matchId}] reject reason=facing attacker=${attacker.name} target=${target.name} type=${attackType}`,
          );
        }
        return;
      }
    }

    // Basic per-attacker->target rate limit to avoid accidental double submissions
    room._recentHits = room._recentHits || new Map(); // key: attacker|target -> timestamp
    const instanceId = payload.instanceId ? String(payload.instanceId) : "";
    const hitTargetKey = targetVault
      ? `vault:${targetVaultTeam}`
      : target.name;
    const keySafe =
      attacker.name +
      "|" +
      hitTargetKey +
      "|" +
      attackType +
      "|" +
      instanceId;
    const last = room._recentHits.get(keySafe) || 0;
    const DUP_WINDOW_MS = 80; // hits within 80ms considered duplicate
    if (!isSelf && now - last < DUP_WINDOW_MS) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=duplicate attacker=${attacker.name} target=${targetVault ? targetName : target.name} type=${attackType} dt=${now - last}`,
        );
      }
      return; // duplicate, ignore
    }
    room._recentHits.set(keySafe, now);
    room._recordCombatStat(attacker, { hits: 1 });

    if (targetVault) {
      const previousHealth = Number(targetVault.health) || 0;
      const vaultState = room.gameMode?.damageVault?.(targetVaultTeam, dmg, {
        sourcePlayer: attacker.name,
        sourceTeam: attacker.team,
        attackType,
      });
      const appliedDamage = Math.max(
        0,
        previousHealth - (Number(vaultState?.health) || 0),
      );
      if (appliedDamage > 0) {
        attacker.lastAttackAt = now;
        attacker.lastCombatAt = now;
        room._recordCombatStat(attacker, { damage: appliedDamage });
        room.broadcastSnapshot();
        room._checkVictoryCondition();
      }
      return { accepted: true, appliedDamage };
    }

    // Apply damage (incoming modifier covers shield powerup, freeze stun, etc.)
    dmg *= effectManager.getModifiers(target, now).damageTakenMult;
    const duckBlocked = !isSelf && target.ducking === true;
    dmg = reduceDuckDamage(target, dmg);
    const old = target.health;
    target.health = Math.max(0, target.health - Math.round(dmg));
    const appliedDamage = Math.max(0, old - target.health);
    if (room.DEBUG_HIT_EVENTS) {
      console.log(
        `[HitDebug ${room.matchId}] accept attacker=${attacker.name} target=${target.name} type=${attackType} dist=${dist.toFixed(0)}/${maxDist} dmgRaw=${Math.round(dmg)} applied=${appliedDamage} hp=${old}->${target.health}`,
      );
    }
    attacker.lastAttackAt = now;
    target.lastDamagedAt = now;
    target._lastAttackerParticipantId = participantId(attacker);
    attacker.lastCombatAt = now;
    target.lastCombatAt = now;
    if (!isSelf && isHuntressBurningArrow && target.health > 0) {
      try {
        effectManager.apply(
          target,
          "huntressBurn",
          now,
          {
            durationMs: EFFECT_RULES.huntressBurn.durationMs,
            totalDamage: EFFECT_RULES.huntressBurn.totalDamage,
            sourceSocketId: attacker?.socketId,
            sourceName: attacker?.name,
            sourceTeam: attacker?.team,
          },
          room,
        );
      } catch (_) {}
    }
    if (appliedDamage > 0) {
      room._recordCombatStat(attacker, { damage: appliedDamage });

      if (!isSelf) chargeSuperForHit(room, attacker, attackType);

      if (!isSelf) {
        const knockback = getKnockback(attacker, target, now);
        if (knockback && target.connected !== false) {
          room.applyKnockback(target, {
            source: attacker.name,
            ...knockback,
          });
        }
      }
    }

    if (target.health !== old) {
      const scoredKill = !isSelf && target.health === 0 && old > 0 ? 1 : 0;
      if (scoredKill) {
        room._recordCombatStat(attacker, { kills: scoredKill });
      }
      if (appliedDamage > 0 && !trustedHuntress && !trustedNinja) {
        room.io.to(`game:${room.matchId}`).emit("game:action", {
          playerId: attacker.user_id,
          playerName: attacker.name,
          origin: { x: attacker.x, y: attacker.y },
          flip: !!attacker.flip,
          character: attacker.char_class,
          action: {
            type: "character-hit-confirm",
            attackType,
            instanceId,
            target: target.name,
            appliedDamage,
            ownerEcho: true,
          },
          t: now,
        });
      }
      room._broadcastHealthUpdate(target, { cause: "combat", duckBlocked });
      if (target.health === 0 && old > 0) {
        console.log(
          `%c[GameRoom ${room.matchId}] Player ${target.name} was killed by ${attacker.name}`,
          "color: red; font-weight: bold;",
        );
        room._handlePlayerDeath(target, {
          cause: "combat",
          killedBy: attacker.name,
          at: now,
        });
      }
    }
    return { accepted: true, appliedDamage };
  } catch (e) {
    console.warn(`[GameRoom ${room.matchId}] handleHit error:`, e?.message);
  }
}

module.exports = { handleHit };
