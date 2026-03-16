const {
  POWERUP_RAGE_DAMAGE_MULT,
  POWERUP_SHIELD_DAMAGE_MULT,
  DRAVEN_INFERNO_RISE_MS,
  DRAVEN_INFERNO_LIFT_PX,
  DRAVEN_INFERNO_BOB_PX,
  DRAVEN_INFERNO_DAMAGE_TICK_MS,
  DRAVEN_INFERNO_RADIUS_X,
  DRAVEN_INFERNO_RADIUS_Y,
  DRAVEN_INFERNO_DAMAGE_SCALE,
} = require("../gameRoomConfig");

function tickDravenInferno(room) {
  const now = Date.now();
  for (const caster of room.players.values()) {
    if (
      !caster ||
      caster.char_class !== "draven" ||
      !caster.isAlive ||
      caster.connected === false ||
      caster.loaded !== true
    ) {
      continue;
    }

    const e = caster.effects || {};
    const until = Number(e.dravenInfernoUntil || 0);
    if (until <= now) continue;

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

    if ((Number(e.dravenInfernoNextDamageAt) || 0) > now) continue;
    e.dravenInfernoNextDamageAt = now + DRAVEN_INFERNO_DAMAGE_TICK_MS;

    let perTickDmg = Math.round(
      Math.max(
        120,
        Number(caster.specialDamage || 0) * DRAVEN_INFERNO_DAMAGE_SCALE,
      ),
    );
    if ((caster.effects?.rageUntil || 0) > now) {
      perTickDmg = Math.round(perTickDmg * POWERUP_RAGE_DAMAGE_MULT);
    }

    for (const target of room.players.values()) {
      if (!target || target.name === caster.name) continue;
      if (
        !target.isAlive ||
        target.connected === false ||
        target.loaded !== true
      ) {
        continue;
      }
      if (caster.team && target.team && caster.team === target.team) continue;

      const dx = Math.abs((target.x || 0) - anchorX);
      const dy = Math.abs((target.y || 0) - anchorY);
      if (dx > DRAVEN_INFERNO_RADIUS_X || dy > DRAVEN_INFERNO_RADIUS_Y) {
        continue;
      }

      let dmg = perTickDmg;
      if ((target.effects?.shieldUntil || 0) > now) {
        dmg = Math.round(dmg * POWERUP_SHIELD_DAMAGE_MULT);
      }
      if (dmg <= 0) continue;

      const old = Number(target.health || 0);
      target.health = Math.max(0, old - dmg);
      const applied = Math.max(0, old - target.health);
      if (applied <= 0) continue;

      target.lastDamagedAt = now;
      target.lastCombatAt = now;
      room._recordCombatStat(caster, { damage: applied, hits: 1 });

      if (target.health === 0 && old > 0) {
        target.isAlive = false;
        room._recordCombatStat(caster, { kills: 1 });
      }

      room._broadcastHealthUpdate(target);

      if (!target.isAlive) {
        room.io.to(`game:${room.matchId}`).emit("player:dead", {
          username: target.name,
          gameId: room.matchId,
        });
        try {
          room._checkVictoryCondition();
        } catch (_) {}
      }
    }
  }
}

module.exports = {
  tickDravenInferno,
};
