const { applyEnvironmentDamage } = require("../../../../shared/combat/runtime/damageResolver");
const { exposeDamageHitbox } = require("../../../../shared/combat/runtime/damageHitboxes.js");
const { TURRET_PROJECTILE_RADIUS, TURRET_PROJECTILE_MAX_LIFETIME_MS, distance } = require("./modeRules");

function tickClaimedTurrets(mode, now, players = mode._eligiblePlayers()) {
  const state = mode.getModeState();
  for (const entry of Array.isArray(state?.objects) ? state.objects : []) {
    if (entry?.type !== "claimableTurret") continue;
    const ownerTeam = entry?.state?.claimedByTeam || null;
    if (ownerTeam !== "team1" && ownerTeam !== "team2") continue;
    const range = entry.state.range;
    let target = null;
    let nearest = Infinity;
    for (const player of players) {
      if (!player.isAlive || player.team === ownerTeam) continue;
      const dist = distance(player.x, player.y, entry.x, entry.y);
      if (dist <= range && dist < nearest) {
        nearest = dist;
        target = player;
      }
    }

    if (!target) continue;
    const aimAngle = Math.atan2(
      (Number(target.y) || 0) - (Number(entry.y) || 0),
      (Number(target.x) || 0) - (Number(entry.x) || 0),
    );
    if (entry.state.aimAngle !== aimAngle) mode.stateVersion++;
    entry.state.aimAngle = aimAngle;
    const fireRateMs = entry.state.fireRateMs;
    if (now - (Number(entry?.state?.lastShotAt) || 0) < fireRateMs) continue;
    mode.stateVersion++;
    entry.state.lastShotAt = now;
    entry.state.lastTargetName = target.name;
    entry.state.lastTargetX = Number(target.x) || 0;
    entry.state.lastTargetY = Number(target.y) || 0;
    const projectileSpeed = Math.max(120, entry.state.projectileSpeed);
    const rawDamage = entry.state.damage;
    state.turretProjectiles = Array.isArray(state.turretProjectiles)
      ? state.turretProjectiles
      : [];
    state.turretProjectiles.push({
      id: `turret-shot-${entry.id}-${now}`,
      ownerTeam,
      sourceId: entry.id,
      x: Number(entry.x) || 0,
      y: Number(entry.y) || 0,
      vx: Math.cos(aimAngle) * projectileSpeed,
      vy: Math.sin(aimAngle) * projectileSpeed,
      radius: TURRET_PROJECTILE_RADIUS,
      damage: rawDamage,
      spawnedAt: now,
      lastUpdatedAt: now,
      maxLifetimeMs: TURRET_PROJECTILE_MAX_LIFETIME_MS,
    });
  }
}

// Players are hit when their origin comes this close to a turret shot.
function turretContactRadius(shot) {
  return Math.max(8, Number(shot?.radius) || TURRET_PROJECTILE_RADIUS) + 26;
}

// Turret shots fly straight; bots read them as threats owned by a team.
function turretThreats(mode) {
  return (mode.getModeState()?.turretProjectiles || []).map((shot) => ({
    x: Number(shot.x) || 0, y: Number(shot.y) || 0, vx: Number(shot.vx) || 0, vy: Number(shot.vy) || 0,
    radius: turretContactRadius(shot), team: shot.ownerTeam, ownerId: `${shot.ownerTeam}-turret`,
  }));
}

function tickTurretProjectiles(mode, now, players = mode._eligiblePlayers()) {
  const state = mode.getModeState();
  if (
    !Array.isArray(state?.turretProjectiles) ||
    !state.turretProjectiles.length
  ) {
    state.lastProjectileTickAt = now;
    return;
  }
  mode.stateVersion++;
  const remaining = [];
  for (const shot of state.turretProjectiles) {
    const lastUpdatedAt = Number(shot?.lastUpdatedAt) || now;
    const dtMs = Math.max(0, now - lastUpdatedAt);
    const dt = dtMs / 1000;
    shot.x = (Number(shot?.x) || 0) + (Number(shot?.vx) || 0) * dt;
    shot.y = (Number(shot?.y) || 0) + (Number(shot?.vy) || 0) * dt;
    shot.lastUpdatedAt = now;

    const expired =
      now - (Number(shot?.spawnedAt) || now) >
      Math.max(
        200,
        Number(shot?.maxLifetimeMs) || TURRET_PROJECTILE_MAX_LIFETIME_MS,
      );
    if (expired) continue;

    const contactRadius = turretContactRadius(shot);
    exposeDamageHitbox(mode.room, shot, { kind: 'circle', x: shot.x, y: shot.y, radius: contactRadius }, now);
    const target = players.find((player) => {
      if (!player.isAlive || player.team === shot.ownerTeam) return false;
      return distance(player.x, player.y, shot.x, shot.y) <= contactRadius;
    });
    if (!target) {
      remaining.push(shot);
      continue;
    }

    applyEnvironmentDamage(mode.room, target, Math.max(1, Number(shot.damage) || 0), {
      cause: "turret-projectile", killedBy: shot.ownerTeam + "-turret", at: now,
    });
  }
  state.turretProjectiles = remaining;
  state.lastProjectileTickAt = now;
}

module.exports = { tickClaimedTurrets, tickTurretProjectiles, turretThreats };
