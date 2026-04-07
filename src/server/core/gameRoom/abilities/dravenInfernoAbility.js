const effectManager = require("../effects/effectManager");

const DRAVEN_INFERNO_DURATION_MS = 5000;
const DRAVEN_INFERNO_RISE_MS = 320;
const DRAVEN_INFERNO_LIFT_PX = 125;
const DRAVEN_INFERNO_BOB_PX = 8;
const DRAVEN_INFERNO_DAMAGE_TICK_MS = 220;
const DRAVEN_INFERNO_RADIUS = 215;
const DRAVEN_INFERNO_DAMAGE_SCALE = 0.22;

function activate(player, now) {
  player.effects = player.effects || {};
  player.effects.dravenInfernoUntil = now + DRAVEN_INFERNO_DURATION_MS;
  player.effects.dravenInfernoStartedAt = now;
  player.effects.dravenInfernoAnchorX = Number.isFinite(player.x)
    ? player.x
    : 0;
  player.effects.dravenInfernoAnchorY = Number.isFinite(player.y)
    ? player.y
    : 0;
  player.effects.dravenInfernoNextDamageAt = now + 80;
}

function isMovementSuppressed(player, now) {
  return (player?.effects?.dravenInfernoUntil || 0) > now;
}

function tick(room, caster, now) {
  if (
    !caster ||
    !caster.isAlive ||
    caster.connected === false ||
    caster.loaded !== true
  ) {
    return;
  }

  const e = caster.effects || {};
  const until = Number(e.dravenInfernoUntil || 0);
  if (until <= now) return;

  const startedAt = Number(e.dravenInfernoStartedAt || now);
  const anchorX = Number.isFinite(e.dravenInfernoAnchorX)
    ? e.dravenInfernoAnchorX
    : Number(caster.x) || 0;
  const anchorY = Number.isFinite(e.dravenInfernoAnchorY)
    ? e.dravenInfernoAnchorY
    : Number(caster.y) || 0;

  const riseT = Math.max(
    0,
    Math.min(1, (now - startedAt) / DRAVEN_INFERNO_RISE_MS),
  );
  const liftNow = DRAVEN_INFERNO_LIFT_PX * (1 - Math.pow(1 - riseT, 3));
  const bob = Math.sin((now - startedAt) / 120) * DRAVEN_INFERNO_BOB_PX;

  caster.x = anchorX;
  caster.y = anchorY - liftNow + bob;
  caster.animation = "draven-special";
  caster.lastCombatAt = now;

  if ((Number(e.dravenInfernoNextDamageAt) || 0) > now) return;
  e.dravenInfernoNextDamageAt = now + DRAVEN_INFERNO_DAMAGE_TICK_MS;

  let perTickDmg = Math.round(
    Math.max(
      120,
      Number(caster.specialDamage || 0) * DRAVEN_INFERNO_DAMAGE_SCALE,
    ),
  );
  perTickDmg = Math.round(
    perTickDmg * effectManager.getModifiers(caster, now).damageMult,
  );

  // Apply inferno pressure to enemy vault/safe when it is inside inferno radius.
  const enemyTeam = caster.team === "team1" ? "team2" : "team1";
  const vault = room?.gameMode?.getVaultState?.(enemyTeam) || null;
  if (vault && Number(vault.health) > 0) {
    const vx = Number(vault.x) || 0;
    const vy = Number(vault.y) || 0;
    const vr = Math.max(30, Number(vault.radius) || 90);
    if (Math.hypot(vx - anchorX, vy - anchorY) <= DRAVEN_INFERNO_RADIUS + vr) {
      const oldVaultHp = Number(vault.health) || 0;
      room?.gameMode?.damageVault?.(enemyTeam, perTickDmg, {
        sourcePlayer: caster.name,
        sourceTeam: caster.team,
        attackType: "special",
      });
      const appliedVault = Math.max(
        0,
        oldVaultHp - (Number(vault.health) || 0),
      );
      if (appliedVault > 0) {
        room._recordCombatStat(caster, { damage: appliedVault, hits: 1 });
        room.broadcastSnapshot?.();
        room._checkVictoryCondition?.();
      }
    }
  }

  for (const target of room.players.values()) {
    if (!target || target.name === caster.name) continue;
    if (!target.isAlive || target.connected === false || target.loaded !== true)
      continue;
    if (caster.team && target.team && caster.team === target.team) continue;

    const dx = Number(target.x || 0) - anchorX;
    const dy = Number(target.y || 0) - anchorY;
    if (Math.hypot(dx, dy) > DRAVEN_INFERNO_RADIUS) continue;

    let dmg = Math.round(
      perTickDmg * effectManager.getModifiers(target, now).damageTakenMult,
    );
    if (dmg <= 0) continue;

    const old = Number(target.health || 0);
    target.health = Math.max(0, old - dmg);
    const applied = Math.max(0, old - target.health);
    if (applied <= 0) continue;

    target.lastDamagedAt = now;
    target.lastCombatAt = now;
    room._recordCombatStat(caster, { damage: applied, hits: 1 });

    if (target.health === 0 && old > 0) {
      room._recordCombatStat(caster, { kills: 1 });
    }

    room._broadcastHealthUpdate(target, { cause: "combat" });

    if (target.health === 0 && old > 0) {
      room._handlePlayerDeath(target, {
        cause: "combat",
        killedBy: caster.name,
        at: now,
      });
    }
  }
}

module.exports = {
  key: "draven",
  activate,
  tick,
  isMovementSuppressed,
  requiresMeleeFacingCheck(attackType, isSelf) {
    return !isSelf && attackType === "basic";
  },
};
