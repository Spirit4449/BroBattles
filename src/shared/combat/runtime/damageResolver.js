const { SOCKET_EVENTS } = require("../../net/socketEvents.js");
const { isPlaced } = require('../targetable.js');
const sparrowModel = require('../../characters/sparrowProjectile');
const { EFFECT_RULES } = require('../../effectRules');
const ninjaCombat = require('./ninjaCombat.js');
const sparrowCombat = require('./sparrowCombat.js');
const { isTrustedProjectileContact, isRuntimeContact } = require('./attackRuntimes/projectileLifecycle.js');
const { deliveryOf } = require('../attackDelivery');
const { positionAt, clientTimeAt } = require('./lagCompensation.js');
const { wallBetween } = require('./attackRuntimes/geometry.js');
const { participantId } = require('./participants');
const {
  NINJA_SWARM_HIT_DAMAGE,
  DUPLICATE_HIT_WINDOW_MS,
} = require("../matchConfig.js");
const effectManager = require("./effects/effectManager.js");
const {
  applyOutgoingDamageMultiplier,
  requiresMeleeFacingCheck,
  getKnockback
} = require("./abilityRuntimeManager.js");
const combatValidation = require("./combatValidation.js");
const { reduceDuckDamage } = require("../../physics/ducking");
const { chargeSuperForHit } = require("./superCharge.js");
const { CENTER_CRATE_TARGET } = require("./attackRuntimes/targets.js");
const { combatNow } = require("./clock");

// Objective and fighter hits share incoming modifiers, ducking and combat time.
// An environmental source has no participant to credit with a hit or a kill.
function applyIncomingDamage(target, rawDamage, now) {
  const old = target.health;
  const scaled = rawDamage * effectManager.getModifiers(target, now).damageTakenMult;
  const damage = Math.round(reduceDuckDamage(target, scaled));
  target.health = Math.max(0, old - damage);
  target.lastDamagedAt = now;
  target.lastCombatAt = now;
  return { old, damage, appliedDamage: old - target.health };
}

function applyEnvironmentDamage(room, target, rawDamage, { cause, killedBy, at }) {
  const { old, appliedDamage } = applyIncomingDamage(target, rawDamage, at);
  if (appliedDamage > 0) {
    target._lastAttackerParticipantId = null;
    room.broadcastHealthUpdate(target, { cause, duckBlocked: target.ducking === true });
    if (old > 0 && target.health === 0) room.handlePlayerDeath(target, { cause, killedBy, at });
  }
  return appliedDamage;
}

function handleHit(room, socketId, payload, { server = false, sparrowProjectile = null, ninjaProjectile = null, runtimeProjectile = null } = {}) {
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
    // Every hit comes from a server-owned attack runtime; clients never claim one.
    if (!server) return;

    const attacker = Array.from(room.players.values()).find(
      (p) => p.name === attackerName,
    );
    const trustedNinja = ninjaCombat.trusted(room, ninjaProjectile, payload);
    if (attacker?.char_class === 'ninja' && attackerName !== targetName && !trustedNinja) return;
    const trustedSparrow = sparrowCombat.isTrustedContact(room, sparrowProjectile, payload);
    const trustedProjectile = trustedNinja || trustedSparrow ||
      isTrustedProjectileContact(room, runtimeProjectile, payload);
    const attachedContact = deliveryOf(runtimeProjectile?.runtimeKind) === 'attached' &&
      isRuntimeContact(room, runtimeProjectile, payload);
    if (attacker?.char_class === 'sparrow' &&
        attackerName !== targetName && !trustedSparrow) return;
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
    const targetCrate = targetName === CENTER_CRATE_TARGET
      ? room.gameMode?.getCenterCrate?.() || null
      : null;
    // A mode object rather than a player: no team, health bar or knockback.
    const targetObjective = targetVault || targetCrate;
    if (!attacker || (!target && !targetObjective)) {
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
      (!targetObjective && !isPlaced(target))
    ) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=not_loaded_or_disconnected attacker=${attacker.name} target=${targetObjective ? targetName : target.name}`,
        );
      }
      return;
    }
    if ((!attacker.isAlive && !trustedProjectile) || (!targetObjective && !target.isAlive)) {
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
    const isSelf = !targetObjective && attacker.name === target.name;
    if (
      !isSelf &&
      !targetObjective &&
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
    const isSparrowArrow = attackType === "sparrow-arrow";
    const isSparrowBurningArrow = attackType === "sparrow-burning-arrow";
    const base = (trustedSparrow || isSparrowArrow || isSparrowBurningArrow)
      ? sparrowModel.attackConfig(isSparrowBurningArrow).damagePerArrow
      : isNinjaSwarm
        ? NINJA_SWARM_HIT_DAMAGE
        : attackType === "special"
          ? Number(attacker.specialDamage || 0)
          : Number(attacker.baseDamage || 0);
    let dmg = Number.isFinite(base) && base > 0 ? base : 0;
    // Outgoing damage modifiers (rage powerup, thorgRage ability, damageBoost, etc.)
    const now = combatNow(room);
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

    // Per-character range check against position history at the time the
    // runtime tested the contact (its `attackTime`, server clock).
    const attackTimeRaw = Number.isFinite(payload.attackTime) ? payload.attackTime : now;
    let attackTimeClamped = attackTimeRaw;
    let aPos = null;
    let tPos = null;
    let dist = 0;
    let maxDist = room.getAttackMaxDist(attacker.char_class, attackType);
    if (trustedProjectile) {
      aPos = { x: attacker.x, y: attacker.y };
      tPos = targetObjective ? { x: targetObjective.x, y: targetObjective.y } : { x: target.x, y: target.y };
    } else if (attachedContact) {
      // The runtime already tested its shape on the attacker as it stands
      // against the target where the attacker saw it; walls and facing are
      // checked between those same two positions.
      aPos = { x: attacker.x, y: attacker.y };
      tPos = targetObjective ? { x: Number(targetObjective.x) || 0, y: Number(targetObjective.y) || 0 }
        : positionAt(target, runtimeProjectile.viewRewindMs);
    } else if (targetObjective) {
      aPos = room.getHistoricalPosition(attacker, attackTimeRaw);
      tPos = { x: Number(targetObjective.x) || 0, y: Number(targetObjective.y) || 0 };
      attackTimeClamped = Math.min(now, attackTimeRaw);
      dist = Math.hypot(
        Number(aPos?.x || 0) - tPos.x,
        Number(aPos?.y || 0) - tPos.y,
      );
      maxDist += Math.max(20, Number(targetObjective.radius) || 90);
      if (
        attackType === "special" ||
        isNinjaSwarm ||
        isSparrowBurningArrow
      ) {
        // Super attacks can hit vaults from farther than basic melee/projectile ranges.
        maxDist = Math.max(maxDist, 2400);
      }
    } else {
      ({ attackTimeClamped, aPos, tPos, dist, maxDist } =
        combatValidation.evaluateHitRange({
          attacker,
          target,
          attackType,
          attackTimeRaw,
          now,
        }));
    }
    if (!isSelf && dist > maxDist) {
      if (room.DEV_TIMING_DIAG) {
        console.warn(
          `[GameRoom ${room.matchId}] hit rejected: dist=${dist.toFixed(0)}px > max=${maxDist}px ` +
            `attacker=${attacker.name}(${attacker.char_class}) target=${targetObjective ? targetName : target.name} ` +
            `type=${attackType} age=${(now - attackTimeClamped).toFixed(0)}ms`,
        );
      }
      return;
    }

    // A built wall is a barrier: splash and melee damage do not reach the far
    // side. Projectiles already stopped at the wall in their own flight.
    if (!isSelf && !trustedProjectile && wallBetween(room, attacker.team, aPos, tPos)) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=wall attacker=${attacker.name} target=${targetName}`,
        );
      }
      return;
    }

    // Facing-direction check for melee attacks (Draven splash, Thorg fall).
    // The target must be on the side the attacker is facing; a generous tolerance
    // prevents false rejections at the boundary.
    const isMeleeFacing =
      !targetObjective && requiresMeleeFacingCheck(attacker, attackType, isSelf);
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
    room.recentHits = room.recentHits || new Map(); // key: attacker|target -> timestamp
    const instanceId = payload.instanceId ? String(payload.instanceId) : "";
    const hitTargetKey = targetObjective ? targetName.toLowerCase() : target.name;
    const keySafe =
      attacker.name +
      "|" +
      hitTargetKey +
      "|" +
      attackType +
      "|" +
      instanceId;
    const last = room.recentHits.get(keySafe) || 0;
    if (!isSelf && now - last < DUPLICATE_HIT_WINDOW_MS) {
      if (room.DEBUG_HIT_EVENTS) {
        console.log(
          `[HitDebug ${room.matchId}] reject reason=duplicate attacker=${attacker.name} target=${targetObjective ? targetName : target.name} type=${attackType} dt=${now - last}`,
        );
      }
      return; // duplicate, ignore
    }
    room.recentHits.set(keySafe, now);
    if (targetCrate) {
      // Neither team's property, so it counts for no one's combat stats.
      const appliedDamage = room.gameMode.damageCenterCrate(dmg, {
        sourcePlayer: attacker.name,
        sourceTeam: attacker.team,
        x: aPos?.x,
      });
      if (appliedDamage > 0) {
        attacker.lastAttackAt = now;
        attacker.lastCombatAt = now;
        room.broadcastSnapshot();
      }
      if (room.netTrace) traceHit(room, attacker, targetName, null, attackType, appliedDamage, payload, sparrowProjectile || ninjaProjectile || runtimeProjectile, now);
      return { accepted: true, appliedDamage };
    }
    if (!isSelf) room.recordCombatStat(attacker, { hits: 1 });

    if (targetVault) {
      // Objective damage is measured in the coins it strips out of the vault.
      const previousCoins = Number(targetVault.coins) || 0;
      const vaultState = room.gameMode?.damageVault?.(targetVaultTeam, dmg, {
        sourcePlayer: attacker.name,
        sourceTeam: attacker.team,
        attackType,
      });
      const appliedDamage = Math.max(
        0,
        previousCoins - (Number(vaultState?.coins) || 0),
      );
      if (room.netTrace) traceHit(room, attacker, targetName, null, attackType, appliedDamage, payload, sparrowProjectile || ninjaProjectile || runtimeProjectile, now);
      if (appliedDamage > 0) {
        attacker.lastAttackAt = now;
        attacker.lastCombatAt = now;
        room.recordCombatStat(attacker, { damage: appliedDamage });
        room.broadcastSnapshot();
        room.checkVictoryCondition();
      }
      return { accepted: true, appliedDamage };
    }

    // Apply damage (incoming modifier covers shield powerup, freeze stun, etc.)
    const duckBlocked = !isSelf && target.ducking === true;
    const { old, damage, appliedDamage } = applyIncomingDamage(target, dmg, now);
    if (room.netTrace && !isSelf) traceHit(room, attacker, targetName, target, attackType, appliedDamage, payload, sparrowProjectile || ninjaProjectile || runtimeProjectile, now);
    if (room.DEBUG_HIT_EVENTS) {
      console.log(
        `[HitDebug ${room.matchId}] accept attacker=${attacker.name} target=${target.name} type=${attackType} dist=${dist.toFixed(0)}/${maxDist} dmgRaw=${damage} applied=${appliedDamage} hp=${old}->${target.health}`,
      );
    }
    attacker.lastAttackAt = now;
    target._lastAttackerParticipantId = participantId(attacker);
    attacker.lastCombatAt = now;
    if (!isSelf && isSparrowBurningArrow && target.health > 0) {
      try {
        effectManager.apply(
          target,
          "sparrowBurn",
          now,
          {
            durationMs: EFFECT_RULES.sparrowBurn.durationMs,
            totalDamage: EFFECT_RULES.sparrowBurn.totalDamage,
            sourceSocketId: attacker?.socketId,
            sourceName: attacker?.name,
            sourceTeam: attacker?.team,
          },
          room,
        );
      } catch (_) {}
    }
    if (appliedDamage > 0) {
      room.recordCombatStat(attacker, { damage: appliedDamage });

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
        room.recordCombatStat(attacker, { kills: scoredKill });
      }
      if (appliedDamage > 0 && !trustedSparrow && !trustedNinja) {
        room.broadcast(SOCKET_EVENTS.GAME_ACTION, {
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
      // Every viewer holds the struck fighter for the same delivery hitstop.
      const delivery = deliveryOf(runtimeProjectile?.runtimeKind) ||
        (sparrowProjectile || ninjaProjectile ? 'released' : null);
      room.broadcastHealthUpdate(target, { cause: "combat", duckBlocked, delivery,
        ...(room.netTrace ? traceHealthMeta(room, attacker, sparrowProjectile || ninjaProjectile || runtimeProjectile, delivery) : null) });
      if (target.health === 0 && old > 0) {
        console.log(
          `%c[GameRoom ${room.matchId}] Player ${target.name} was killed by ${attacker.name}`,
          "color: red; font-weight: bold;",
        );
        room.handlePlayerDeath(target, {
          cause: "combat",
          killedBy: attacker.name,
          at: now,
        });
      }
    }
    return { accepted: true, appliedDamage };
  } catch (e) {
    room.onCombatError?.(e, payload);
    console.warn(`[GameRoom ${room.matchId}] handleHit error:`, e?.message);
  }
}

// Traced rooms only. `projectile` is the Sparrow attack, the Ninja entry or
// the attack runtime instance that made the contact.
function traceHit(room, attacker, targetName, target, attackType, appliedDamage, payload, projectile, now) {
  const runtime = projectile?.runtimeKind ? projectile : null;
  const shot = runtime ? null : projectile?.projectile || null;
  const delivery = runtime ? deliveryOf(runtime.runtimeKind) || 'area' : shot ? 'released' : 'none';
  const rewindMs = Number(projectile?.viewRewindMs) || 0;
  const age = runtime ? runtime.elapsed : Number.isFinite(shot?.elapsed) ? shot.elapsed
    : shot && Number.isFinite(shot.launchMono) ? room.simulationMono - shot.launchMono : null;
  const tested = target ? positionAt(target, rewindMs, now) : null;
  room.traceCombatHit?.(attacker, targetName, { target, type: attackType, dmg: appliedDamage,
    id: payload?.instanceId ?? shot?.id ?? null, rewindMs, delivery,
    kind: runtime ? runtime.runtimeKind : shot ? (projectile.clientRequestId != null ? 'sparrow' : 'ninja') : null,
    req: runtime ? runtime.instanceId : projectile?.clientRequestId ?? projectile?.requestId ?? null,
    pid: delivery === 'released' ? (shot ? shot.id : runtime.instanceId) : null, age,
    rewindRequestedMs: projectile?.viewRewindRequestedMs, tested, from: attacker,
    vTs: target && !target.isBot ? clientTimeAt(target, rewindMs, now) : null });
}

// Traced rooms only: lets the victim's trace tie a health update to the shot.
function traceHealthMeta(room, attacker, projectile, delivery) {
  if (!room.netTrace?.runs?.size) return null;
  const runtime = projectile?.runtimeKind ? projectile : null;
  const pid = delivery !== 'released' ? null : runtime ? runtime.instanceId : projectile?.projectile?.id;
  return { by: attacker?.name || null, pid: pid == null ? null : String(pid) };
}

module.exports = { handleHit, applyEnvironmentDamage };
