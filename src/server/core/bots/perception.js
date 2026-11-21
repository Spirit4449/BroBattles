const movement = require("../../../shared/physics/movementPhysics.json");
const { SERVER_TICK_HZ, FIXED_DT_MS } = require("../../../shared/gameConstants");
const { isPlaced } = require('../../../shared/combat/targetable.js');
const effects = require('../../../shared/combat/runtime/effects/effectManager.js');
const { participantId, getParticipant } = require('../gameRoom/participants');
const { bounds } = require('../physics/bodySolver');
const { botProfile } = require('../../../shared/combat/characterProfiles.js');

function observe(room, player, now, samples) {
  const enemies = [...room.players.values()].filter((p) =>
    p !== player && p.team !== player.team && p.isAlive && isPlaced(p) &&
    !effects.isActive(p, 'invisibility', now) && Math.hypot(p.x - player.x, p.y - player.y) < 1600,
  ).map((p) => ({
    participantId: participantId(p), char_class: p.char_class, x: p.x, y: p.y,
    vx: p.vx || 0, vy: p.vy || 0, flip: !!p.flip, health: p.health, maxHealth: p.maxHealth,
    grounded: p.grounded, ducking: p.ducking === true,
    bodyHalfHeight: p._bodyHalfHeight,
    bodyCenterOffsetY: p._bodyCenterOffsetY,
    platformId: p.platformId, attack: p._visibleAttack && { ...p._visibleAttack },
  }));
  const projectiles = [];
  const ninja = [...(room.ninjaCombatState?.active.values() || [])].map(e => {
    const p=e.projectile; p.attackerParticipantId=e.owner; p.collisionRadius=p.cfg.collisionRadius; return p;
  });
  for (const attack of [...ninja, ...(room.activeAttacks || []), ...(room.sparrowCombatState?.active.values() || [])]) {
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
    const range = botProfile(enemy.char_class).melee ? 210 : 550;
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
      const point = projectilePosition(attack, age + i / SERVER_TICK_HZ);
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

// A stream of shots is a lane, not a set of separate projectiles: the space
// between the shooter and the far end of the stream stays dangerous between
// volleys. Lanes are remembered briefly so a pause in fire does not make the
// ground below look safe again.
const FIRE_LANE_MEMORY_MS = 1600;
const FIRE_LANE_MIN_SHOTS = 2;
const FIRE_LANE_LOOKAHEAD_S = 0.5;

function updateFireLanes(previous, observed, now) {
  const lanes = new Map();
  for (const [owner, lane] of previous || []) if (now - lane.at < FIRE_LANE_MEMORY_MS) lanes.set(owner, lane);
  if (!observed) return lanes;
  const groups = new Map();
  for (const shot of observed.projectiles) {
    if (shot.gravity || !(shot.vx || shot.vy)) continue;
    // Opposing volleys and returning shots should not paint the space between them.
    const direction = Math.round(Math.atan2(shot.vy, shot.vx) * 8 / Math.PI);
    const key = JSON.stringify([shot.ownerId, (direction + 16) % 16]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(shot);
  }
  for (const [key, shots] of groups) {
    if (shots.length < FIRE_LANE_MIN_SHOTS) continue;
    const first = shots[0], speed = Math.hypot(first.vx, first.vy);
    const dx = first.vx / speed, dy = first.vy / speed;
    let start = Infinity, end = -Infinity, low = Infinity, high = -Infinity;
    let left = Infinity, right = -Infinity;
    for (const shot of shots) {
      for (const t of [0, FIRE_LANE_LOOKAHEAD_S]) {
        const x = shot.x + shot.vx * t, y = shot.y + shot.vy * t;
        const along = x * dx + y * dy, across = y * dx - x * dy;
        start = Math.min(start, along - shot.radius);
        end = Math.max(end, along + shot.radius);
        low = Math.min(low, across - shot.radius);
        high = Math.max(high, across + shot.radius);
        left = Math.min(left, x - shot.radius);
        right = Math.max(right, x + shot.radius);
      }
    }
    const shooter = observed.enemies.find((enemy) => enemy.participantId === first.ownerId);
    if (shooter) {
      start = Math.min(start, shooter.x * dx + shooter.y * dy);
      left = Math.min(left, shooter.x);
      right = Math.max(right, shooter.x);
    }
    lanes.set(key, { dx, dy, start, end, low, high, left, right, shots: shots.length, at: observed.at });
  }
  return lanes;
}

// Remembered shots whose lane overlaps a body at `point`, fading with age.
function fireLaneExposure(lanes, character, point, now) {
  if (!lanes?.size) return 0;
  const body = bounds({ ...point, char_class: character });
  let exposure = 0;
  for (const lane of lanes.values()) {
    if (body.right <= lane.left || body.left >= lane.right) continue;
    const { dx, dy } = lane;
    const x = point.x + body.offsetX, y = point.y + body.offsetY;
    const along = x * dx + y * dy, across = y * dx - x * dy;
    const alongRadius = Math.abs(dx) * body.halfWidth + Math.abs(dy) * body.halfHeight;
    const acrossRadius = Math.abs(dy) * body.halfWidth + Math.abs(dx) * body.halfHeight;
    if (along + alongRadius <= lane.start || along - alongRadius >= lane.end ||
        across + acrossRadius <= lane.low || across - acrossRadius >= lane.high) continue;
    exposure += lane.shots * Math.max(0, 1 - (now - lane.at) / FIRE_LANE_MEMORY_MS);
  }
  return exposure;
}

// Integrate exposure in shot-seconds along the walk to takeoff and the flight.
function walkExposure(lanes, character, fromX, point, now) {
  if (!lanes?.size || !Number.isFinite(fromX)) return 0;
  const distance = Math.abs(point.x - fromX);
  const samples = Math.ceil(distance / 32);
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const x = fromX + (point.x - fromX) * (i + 0.5) / samples;
    total += fireLaneExposure(lanes, character, { x, y: point.y }, now);
  }
  return samples ? total / samples * distance / movement.maxSpeed : 0;
}

function edgeExposure(lanes, character, fromX, edge, now) {
  const frames = edge?.frames;
  if (!lanes?.size || !frames?.length) return 0;
  let total = walkExposure(lanes, character, fromX, { x: edge.takeoffX, y: frames[0].y }, now);
  for (let i = 0; i < frames.length; i += 4) {
    total += fireLaneExposure(lanes, character, frames[i], now) * Math.min(4, frames.length - i) * FIXED_DT_MS / 1000;
  }
  return total;
}

module.exports = { observe, incomingThreat, maneuverDanger, updateFireLanes, fireLaneExposure, edgeExposure, walkExposure };
