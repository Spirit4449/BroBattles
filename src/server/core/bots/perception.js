const effects = require('../gameRoom/effects/effectManager');
const { participantId, getParticipant } = require('../gameRoom/participants');
const { bounds } = require('./physics');

function observe(room, player, now, samples) {
  const enemies = [...room.players.values()].filter((p) =>
    p !== player && p.team !== player.team && p.isAlive && p.loaded && p.connected !== false &&
    !effects.isActive(p, 'invisibility', now) && Math.hypot(p.x - player.x, p.y - player.y) < 1600,
  ).map((p) => ({
    participantId: participantId(p), char_class: p.char_class, x: p.x, y: p.y,
    vx: p.vx || 0, vy: p.vy || 0, flip: !!p.flip, health: p.health, maxHealth: p.maxHealth,
    grounded: p.grounded, platformId: p.platformId, attack: p._visibleAttack && { ...p._visibleAttack },
  }));
  const projectiles = [];
  for (const attack of [...(room._activeAttacks || []), ...(room._botVisualProjectiles || [])]) {
    const owner = getParticipant(room, attack.attackerParticipantId) ||
      [...room.players.values()].find((p) => p.name === attack.attackerName);
    if (!owner || owner.team === player.team || !Number.isFinite(attack.x) || !Number.isFinite(attack.y)) continue;
    const previous = samples.get(attack);
    const seconds = previous ? (now - previous.at) / 1000 : 0;
    // Returning attacks follow curves and do not expose vx/vy. Measure their visible motion.
    const vx = Number.isFinite(attack.vx) ? attack.vx : seconds > 0 ? (attack.x - previous.x) / seconds : 0;
    const vy = Number.isFinite(attack.vy) ? attack.vy : seconds > 0 ? (attack.y - previous.y) / seconds : 0;
    samples.set(attack, { x: attack.x, y: attack.y, at: now });
    if (Math.hypot(attack.x - player.x, attack.y - player.y) > 1300) continue;
    projectiles.push({ x: attack.x, y: attack.y, vx, vy, gravity: attack.gravity || 0,
      radius: Math.min(60, attack.collisionRadius || 12), ownerId: participantId(owner) });
  }
  return { at: now, enemies, projectiles };
}

function projectilePosition(attack, seconds) {
  return { x: attack.x + attack.vx * seconds,
    y: attack.y + attack.vy * seconds + 0.5 * attack.gravity * seconds * seconds };
}

function incomingThreat(observed, player, now) {
  if (!observed) return null;
  const body = bounds(player), age = Math.min(0.6, Math.max(0, now - observed.at) / 1000);
  let closest = null;
  for (const attack of observed.projectiles) {
    for (let t = 0; t <= 0.7; t += 0.05) {
      const point = projectilePosition(attack, age + t);
      if (Math.abs(point.x - (player.x + body.offsetX + (player.vx || 0) * t)) < body.halfWidth + attack.radius + 16 &&
          Math.abs(point.y - (player.y + body.offsetY)) < body.halfHeight + attack.radius + 12) {
        if (!closest || t < closest.impactIn) closest = { ...attack, impactIn: t };
        break;
      }
    }
  }
  // Windups are public animations, so they can warn a bot before a projectile arrives.
  if (!closest) for (const enemy of observed.enemies) {
    const attack = enemy.attack;
    if (!attack || now - attack.at > Math.max(300, attack.startupMs + 150)) continue;
    const dx = player.x - enemy.x, dy = player.y - enemy.y;
    const facing = Math.cos(attack.angle);
    if (Math.sign(dx) !== Math.sign(facing) || Math.abs(dy) > 90) continue;
    const range = ['thorg', 'draven'].includes(enemy.char_class) ? 210 : 550;
    if (Math.hypot(dx, dy) < range) closest = { x: enemy.x, y: enemy.y, impactIn: 0.5, telegraph: true };
  }
  return closest;
}

function maneuverDanger(maneuver, observed, now, character) {
  const age = Math.max(0, now - observed.at) / 1000;
  let danger = 0;
  for (let i = 0; i < Math.min(42, maneuver.frames.length); i += 3) {
    const frame = maneuver.frames[i], body = bounds({ ...frame, char_class: character });
    for (const attack of observed.projectiles) {
      const point = projectilePosition(attack, age + i / 60);
      const dx = Math.max(0, Math.abs(point.x - (frame.x + body.offsetX)) - body.halfWidth - attack.radius);
      const dy = Math.max(0, Math.abs(point.y - (frame.y + body.offsetY)) - body.halfHeight - attack.radius);
      danger += Math.max(0, 70 - Math.hypot(dx, dy));
    }
    for (const enemy of observed.enemies) {
      if (enemy.attack && now - enemy.attack.at < 600) {
        danger += Math.max(0, 160 - Math.hypot(frame.x - enemy.x, frame.y - enemy.y)) * 0.25;
      }
    }
  }
  return danger;
}

// Human Huntress arrows resolve hits in the browser. Track their visible flight
// separately for perception, without ever calling damage or effect handlers.
function tickVisualProjectiles(room) {
  const dt = room.FIXED_DT_MS / 1000;
  room._botVisualProjectiles = (room._botVisualProjectiles || []).filter((attack) => {
    const beforeX = attack.x, beforeY = attack.y;
    attack.vy += (attack.gravity || 0) * dt;
    attack.x += attack.vx * dt;
    attack.y += attack.vy * dt;
    attack.elapsed = (attack.elapsed || 0) + room.FIXED_DT_MS;
    const radius = attack.collisionRadius || 8;
    if (room.geometry?.colliders.some((r) =>
      Math.max(beforeX, attack.x) + radius >= r.left && Math.min(beforeX, attack.x) - radius <= r.right &&
      Math.max(beforeY, attack.y) + radius >= r.top && Math.min(beforeY, attack.y) - radius <= r.bottom)) return false;
    return attack.elapsed < Math.min(3000, attack.maxLifetimeMs || 2500);
  });
}

module.exports = { observe, incomingThreat, maneuverDanger, tickVisualProjectiles };
