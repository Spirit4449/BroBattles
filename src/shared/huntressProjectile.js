// No renderer or room dependencies: the server and predicted arrows use this model.
const { getResolvedCharacterAttackConfig, getResolvedCharacterSpecialConfig,
  getResolvedCharacterAimConfig, getResolvedCharacterSpecialAimConfig } = require('../lib/characterTuning');

const VERSION = 2;
const STEP_MS = 1000 / 60;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function attackConfig(special = false) {
  const arrows = getResolvedCharacterAttackConfig('huntress', 'arrowSpread');
  const cfg = special ? getResolvedCharacterSpecialConfig('huntress', 'burningVolley') : arrows;
  return { ...cfg, forwardOffset: arrows.forwardOffset, verticalOffset: arrows.verticalOffset };
}

function resolveShot(aim = {}, special = false) {
  const cfg = attackConfig(special);
  const aimCfg = getResolvedCharacterAimConfig('huntress');
  const specialAim = getResolvedCharacterSpecialAimConfig('huntress');
  const angle = Number(aim.angle) + (special ? (specialAim.projectileAngleOffsetDeg || 0) * Math.PI / 180 : 0);
  if (!Number.isFinite(angle)) return null;
  // The wire expresses power, never damage, gravity, hitbox sizes or launch position.
  const power = Number(aim.power ?? 0.5);
  if (!Number.isFinite(power) || power < 0 || power > 1) return null;
  const scale = special ? 1 : aimCfg.minSpeedScale + (aimCfg.maxSpeedScale - aimCfg.minSpeedScale) * power;
  return { angle, power, speed: cfg.speed * scale, special };
}

function powerFromSpeed(angle, speed) {
  const cfg = attackConfig(), aim = getResolvedCharacterAimConfig('huntress');
  const scale = speed / cfg.speed;
  return clamp((scale - aim.minSpeedScale) / (aim.maxSpeedScale - aim.minSpeedScale), 0, 1);
}

function createVolley(pose, shot, requestId, launchMono) {
  const cfg = attackConfig(shot.special), count = cfg.count;
  return Array.from({ length: count }, (_, i) => {
    const offset = count === 1 ? 0 : (i - (count - 1) / 2) / ((count - 1) / 2) * cfg.spreadDeg * Math.PI / 360;
    return createProjectile(pose, shot, shot.angle + offset, cfg, {
      id: `${requestId}:${i}`, requestId, launchMono,
    });
  });
}

function createProjectile(pose, shot, angle, cfg, identity = {}) {
  const forward = pose.width * cfg.forwardOffset;
  return {
      ...identity,
      x: pose.x + Math.cos(angle) * forward,
      y: pose.y - pose.height * cfg.verticalOffset + Math.sin(angle) * forward,
      vx: Math.cos(angle) * shot.speed, vy: Math.sin(angle) * shot.speed,
      gravity: cfg.gravity, maxLifetimeMs: cfg.maxLifetimeMs,
      radius: cfg.playerCollisionRadius || cfg.collisionRadius,
      scale: cfg.visualScale, embedMs: cfg.embedMs, special: shot.special,
  };
}

// Solve the earliest flight to the selected point, including muzzle placement,
// power tuning and the same fixed-step gravity used for collision.
function aimAtTarget(pose, target, power = 0.5, special = false, samples = 32) {
  const cfg = attackConfig(special);
  const flatSpeed = resolveShot({ angle: 0, power }, special).speed;
  const forward = pose.width * cfg.forwardOffset;
  const dx = target.x - pose.x, dy = target.y - (pose.y - pose.height * cfg.verticalOffset);
  const gravityOnly = { x: 0, y: 0, vx: 0, vy: 0, gravity: cfg.gravity, maxLifetimeMs: cfg.maxLifetimeMs };
  const evaluate = ms => {
    const drop = sample(gravityOnly, ms).y;
    const angle = Math.atan2(dy - drop, dx);
    const speed = flatSpeed;
    return { angle, error: Math.hypot(dx, dy - drop) - forward - speed * ms / 1000 };
  };
  let lo = 0, hi = 0, best = { ms: 0, ...evaluate(0) }, reachable = best.error <= 0;
  for (let ms = STEP_MS; !reachable && ms <= cfg.maxLifetimeMs; ms += STEP_MS) {
    const value = evaluate(ms);
    if (Math.abs(value.error) < Math.abs(best.error)) best = { ms, ...value };
    if (value.error <= 0) { lo = ms - STEP_MS; hi = ms; reachable = true; }
  }
  if (hi > 0) for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate(mid).error > 0) lo = mid; else hi = mid;
  }
  const durationMs = reachable ? hi : best.ms;
  const resolvedAngle = evaluate(durationMs).angle;
  const offset = special ? (getResolvedCharacterSpecialAimConfig('huntress').projectileAngleOffsetDeg || 0) * Math.PI / 180 : 0;
  const angle = resolvedAngle - offset;
  const shot = resolveShot({ angle, power }, special);
  const projectile = createProjectile(pose, shot, shot.angle, cfg);
  const points = Array.from({ length: samples + 1 }, (_, i) => sample(projectile, durationMs * i / samples));
  const end = points[points.length - 1];
  return { angle, shot, projectile, durationMs, reachable,
    preview: { points, startX: projectile.x, startY: projectile.y, endX: end.x, endY: end.y } };
}

// Exact closed form of semi-implicit Euler at 60 Hz, linearly sampled between steps.
function sample(projectile, ageMs) {
  const age = clamp(ageMs, 0, projectile.maxLifetimeMs);
  const n = Math.floor(age / STEP_MS), fraction = age / STEP_MS - n;
  const dt = STEP_MS / 1000, t = age / 1000;
  return {
    x: projectile.x + projectile.vx * t,
    y: projectile.y + projectile.vy * t + projectile.gravity * dt * dt *
      (n * (n + 1) / 2 + fraction * (n + 1)),
    vx: projectile.vx, vy: projectile.vy + projectile.gravity * dt * (n + fraction),
  };
}

function insetBounds(b) {
  const ix = Math.min(10, (b.right - b.left) * 0.16);
  const iy = Math.min(12, (b.bottom - b.top) * 0.14);
  return { left: b.left + ix, right: b.right - ix, top: b.top + iy, bottom: b.bottom - iy };
}

// Collision uses a radius, but embedded art must touch the body rather than
// inheriting an arbitrary in-flight or radius-separated sprite offset.
function attachmentPoint(point, bounds) {
  return { x: clamp(point.x, bounds.left, bounds.right), y: clamp(point.y, bounds.top, bounds.bottom) };
}

function pointInCircleRect(x, y, b, radius) {
  return Math.hypot(x - clamp(x, b.left, b.right), y - clamp(y, b.top, b.bottom)) <= radius;
}

function segmentRect(a, z, b) {
  let lo = 0, hi = 1;
  for (const [origin, delta, min, max] of [[a.x, z.x - a.x, b.left, b.right], [a.y, z.y - a.y, b.top, b.bottom]]) {
    if (Math.abs(delta) < 1e-12) { if (origin < min || origin > max) return null; }
    else {
      const u = (min - origin) / delta, v = (max - origin) / delta;
      lo = Math.max(lo, Math.min(u, v)); hi = Math.min(hi, Math.max(u, v));
      if (lo > hi) return null;
    }
  }
  return lo;
}

// Sweep against a rounded rectangle (a true circle/AABB Minkowski sum).
function sweep(a, z, b, radius = 0) {
  if (radius === 0) return segmentRect(a, z, b);
  if (pointInCircleRect(a.x, a.y, b, radius)) return 0;
  const times = [
    segmentRect(a, z, { ...b, left: b.left - radius, right: b.right + radius }),
    segmentRect(a, z, { ...b, top: b.top - radius, bottom: b.bottom + radius }),
  ].filter(t => t !== null);
  const dx = z.x - a.x, dy = z.y - a.y, aa = dx * dx + dy * dy;
  if (aa > 0) for (const x of [b.left, b.right]) for (const y of [b.top, b.bottom]) {
    const ox = a.x - x, oy = a.y - y;
    const bb = 2 * (ox * dx + oy * dy), cc = ox * ox + oy * oy - radius * radius;
    const disc = bb * bb - 4 * aa * cc;
    if (disc >= 0) {
      const t = (-bb - Math.sqrt(disc)) / (2 * aa);
      if (t >= 0 && t <= 1) times.push(t);
    }
  }
  return times.length ? Math.min(...times) : null;
}

function firstContact(a, z, radius, terrain = [], targets = []) {
  let hit = null;
  // Terrain is visited first and wins ties. Target names make ties reproducible.
  for (const entry of terrain) {
    const t = sweep(a, z, entry, 0);
    if (t !== null && (!hit || t < hit.t)) hit = { t, reason: 'terrain', colliderId: entry.id };
  }
  for (const entry of targets) {
    const t = sweep(a, z, entry.bounds, radius);
    if (t !== null && (!hit || t < hit.t)) hit = { t, reason: 'target', target: entry.name };
  }
  return hit && { ...hit, x: a.x + (z.x - a.x) * hit.t, y: a.y + (z.y - a.y) * hit.t };
}

module.exports = { VERSION, STEP_MS, attackConfig, resolveShot, powerFromSpeed, createVolley, aimAtTarget,
  sample, insetBounds, sweep, firstContact, pointInCircleRect, attachmentPoint };
