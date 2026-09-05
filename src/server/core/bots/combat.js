const { getResolvedCharacterAttackConfig, getResolvedCharacterAimConfig, getResolvedCharacterSpecialAimConfig, getResolvedCharacterSpecialConfig } = require("../../../lib/characterTuning.js");
const { getResolvedAttackDescriptor } = require("../gameRoom/attackDescriptorResolver");
const attackRuntime = require("../gameRoom/attackRuntimeManager");
const attackTypes = { ninja: "ninja-shuriken", thorg: "thorg-fall", draven: "draven-splash", wizard: "wizard-fireball", huntress: "huntress-arrow", gloop: "gloop-slimeball" };
const BOT_ATTACK_TO_SUPER_COOLDOWN_MS = 400;

function interceptTime(dx, dy, vx, vy, speed) {
  const a = vx * vx + vy * vy - speed * speed;
  const b = 2 * (dx * vx + dy * vy), c = dx * dx + dy * dy;
  if (Math.abs(a) < 0.001) return b < 0 ? -c / b : Math.sqrt(c) / speed;
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) return Math.sqrt(c) / speed;
  const roots = [(-b - Math.sqrt(discriminant)) / (2 * a), (-b + Math.sqrt(discriminant)) / (2 * a)].filter((t) => t >= 0);
  return roots.length ? Math.min(...roots) : Math.sqrt(c) / speed;
}

function segmentCrossesRect(ax, ay, bx, by, rect, padding = 8) {
  const left = rect.left - padding, right = rect.right + padding;
  const top = rect.top - padding, bottom = rect.bottom + padding;
  let lo = 0, hi = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - left], [dx, right - ax], [-dy, ay - top], [dy, bottom - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const t = q / p;
    if (p < 0) lo = Math.max(lo, t); else hi = Math.min(hi, t);
    if (lo > hi) return false;
  }
  return hi > 0.04 && lo < 0.96;
}

// Solve flight time first, including the muzzle offset and the runtime's
// semi-implicit gravity step. Multiple roots give low and high firing arcs.
function projectileSolutions(player, target, runtime, startup, prediction, dt, speedAtAngle) {
  const speed = runtime.speed || 800, gravity = runtime.gravity || 0;
  const forward = (player._lastWidth || 80) * (runtime.forwardOffsetWidthFactor || 0);
  const ox = player.x, oy = player.y - (player._lastHeight || 120) * (runtime.verticalOffsetHeightFactor || 0);
  const vx = (target.vx || 0) * prediction, vy = (target.vy || 0) * prediction;
  const maxTime = gravity ? (runtime.maxLifetimeMs || 3000) / 1000 : (runtime.range || 1050) / speed;
  const vector = (t) => ({ x: target.x + vx * (startup + t) - ox,
    y: target.y + vy * (startup + t) - oy - 0.5 * gravity * t * (t + dt) });
  const launchSpeed = (v) => speedAtAngle ? speedAtAngle(Math.atan2(v.y, v.x)) : speed;
  const error = (t) => { const v = vector(t); return Math.hypot(v.x, v.y) - (launchSpeed(v) * t + forward); };
  const solutions = [];
  let previous = 0, previousError = error(0);
  for (let i = 1; i <= 160; i++) {
    const t = maxTime * i / 160, value = error(t);
    if (value * previousError <= 0) {
      let lo = previous, hi = t, lowError = previousError;
      for (let j = 0; j < 24; j++) {
        const mid = (lo + hi) / 2, e = error(mid);
        if (e * lowError > 0) { lo = mid; lowError = e; } else hi = mid;
      }
      const time = (lo + hi) / 2, v = vector(time), angle = Math.atan2(v.y, v.x);
      solutions.push({ angle, time, ox, oy, forward, speed: launchSpeed(v), gravity, dt, highArc: gravity > 0 && solutions.length > 0 });
    }
    previous = t; previousError = value;
  }
  return solutions;
}

function clearTrajectory(room, shot, radius) {
  let x = shot.ox + Math.cos(shot.angle) * shot.forward;
  let y = shot.oy + Math.sin(shot.angle) * shot.forward;
  const steps = Math.ceil(shot.time / shot.dt);
  for (let i = 1; i <= steps; i++) {
    const t = Math.min(shot.time, i * shot.dt);
    const nx = shot.ox + Math.cos(shot.angle) * (shot.forward + shot.speed * t);
    const ny = shot.oy + Math.sin(shot.angle) * (shot.forward + shot.speed * t) + 0.5 * shot.gravity * t * (t + shot.dt);
    if ((room?.geometry?.colliders || []).some((r) => segmentCrossesRect(x, y, nx, ny, r, radius))) return false;
    x = nx; y = ny;
  }
  return true;
}

function hasClearShot(room, player, target, aim = basicAim(player, target, player.difficulty || {}, () => 0.5)) {
  if (player.char_class === 'huntress') return basicAim(player, target, player.difficulty || {}, () => 0.5, room).canHit;
  if (!['ninja', 'gloop'].includes(player.char_class)) return true;
  const collisionRadius = player.char_class === 'ninja'
    ? getResolvedAttackDescriptor('ninja-shuriken')?.runtime?.collisionRadius || 18
    : 8;
  return !(room.geometry?.colliders || []).some((rect) =>
    segmentCrossesRect(
      player.x,
      player.y,
      aim.target.x,
      aim.target.y,
      rect,
      collisionRadius,
    ));
}

function advanceAmmo(player, dt) {
  const a = player.ammoState;
  if (!a) return;
  a.nextFireInMs = Math.max(0, a.nextFireInMs - dt);
  if (a.charges < a.capacity) {
    a.reloadTimerMs += dt;
    while (a.reloadTimerMs >= a.reloadMs && a.charges < a.capacity) { a.reloadTimerMs -= a.reloadMs; a.charges++; }
    if (a.charges === a.capacity) a.reloadTimerMs = 0;
  }
}

function basicAim(player, target, profile, random, room) {
  const type = attackTypes[player.char_class];
  const descriptor = getResolvedAttackDescriptor(type);
  const aim = getResolvedCharacterAimConfig(player.char_class) || {};
  const release = getResolvedAttackDescriptor(descriptor?.actionFlow?.releaseActionType || type);
  const cfg = getResolvedCharacterAttackConfig(player.char_class, aim.attackKey) || {};
  const runtime = { ...cfg, ...(release?.runtime || {}) };
  const range = (player.char_class === "wizard" ? runtime.range : aim.defaultRange) || runtime.range || runtime.defaultForwardDistance || 200;
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  const startup = (Number(descriptor?.actionFlow?.startupMs) || Number(runtime.windupMs) || 0) / 1000;
  const flight = Math.min(0.9, startup + interceptTime(target.x - player.x, target.y - player.y,
    target.vx || 0, target.vy || 0, runtime.speed || 800)) * (profile.prediction ?? 0.5);
  const dx = target.x + (target.vx || 0) * flight - player.x;
  const dy = target.y + (target.vy || 0) * flight - player.y;
  // Match the Huntress's drag-distance power limits and upward-shot slowdown.
  // Speed depends on launch angle, so solve it together with the intercept.
  const distanceRatio = Math.max(0, Math.min(1, (distance - (aim.minRange || 160)) /
    Math.max(1, (aim.maxRange || range) - (aim.minRange || 160))));
  const huntressSpeed = (ratio) => (angle) => (runtime.speed || 560) *
    ((aim.minSpeedScale || 0.82) + ((aim.maxSpeedScale || 1.18) - (aim.minSpeedScale || 0.82)) * ratio) *
    (1 - Math.max(0, -Math.sin(angle)) * 0.32);
  let speedAtAngle = player.char_class === 'huntress' ? huntressSpeed(distanceRatio) : null;
  let solution;
  if (['wizard', 'huntress'].includes(player.char_class)) {
    solution = projectileSolutions(player, target, runtime, startup, profile.prediction ?? 0.5, (room?.FIXED_DT_MS || 1000 / 60) / 1000, speedAtAngle)
      .find((shot) => player.char_class === 'wizard' || clearTrajectory(room, shot, runtime.playerCollisionRadius || runtime.collisionRadius || 16));
    // A retreating target can outrun the initial distance-based choice.
    // Increase power within the same player tuning limits when necessary.
    if (!solution && speedAtAngle) {
      speedAtAngle = () => (runtime.speed || 560) * (aim.maxSpeedScale || 1.18);
      solution = projectileSolutions(player, target, runtime, startup, profile.prediction ?? 0.5,
        (room?.FIXED_DT_MS || 1000 / 60) / 1000, speedAtAngle)
        .find((shot) => clearTrajectory(room, shot, runtime.playerCollisionRadius || runtime.collisionRadius || 16));
    }
  }
  const baseAimError = profile.aimError || 0;
  const aimError = player.char_class === 'huntress'
    ? Math.min(0.22, Math.max(baseAimError * 1.45, baseAimError + 0.025))
    : baseAimError;
  let angle = (solution?.angle ?? Math.atan2(dy, dx)) + (random() * 2 - 1) * aimError;
  const direction = Math.cos(angle) < 0 ? -1 : 1;
  if (aim.angleMode === "horizontal-only") angle = direction < 0 ? Math.PI : 0;
  const canHit = (!['wizard', 'huntress'].includes(player.char_class) || !!solution) && distance <= range + 30 && (aim.angleMode !== 'horizontal-only' || Math.abs(target.y - player.y) < 90);
  return { type, angle, direction, range, distance, canHit, ...(speedAtAngle ? { speed: speedAtAngle(angle), highArc: solution?.highArc || false } : {}), gravity: runtime.gravity || 0, maxLifetimeMs: runtime.maxLifetimeMs || 3000, target: { x: player.x + Math.cos(angle) * Math.min(range, Math.hypot(dx, dy)), y: player.y + Math.sin(angle) * Math.min(range, Math.hypot(dx, dy)) } };
}

// A pressure shot must still pass near the opponent and respect cover.
// Sample nearby intercept points instead of firing at arbitrary angles.
function pressureAim(room, player, target, profile) {
  if (!['wizard', 'huntress', 'ninja', 'gloop'].includes(player.char_class)) return null;
  for (const radius of [55, 95]) {
    for (const [x, y] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) {
      const nearby = { ...target, x: target.x + x * radius, y: target.y + y * radius };
      const aim = basicAim(player, nearby, profile, () => 0.5, room);
      if (aim.canHit && hasClearShot(room, player, nearby, aim)) return { ...aim, pressure: true };
    }
  }
  return null;
}

function requestBasic(room, p, target, profile, random, now) {
  const ammo = p.ammoState;
  if (!p.isAlive || p._botActionUntil > now || p._controlLockUntil > now || !ammo || ammo.charges <= 0 || ammo.nextFireInMs > 0) return false;
  let aim = basicAim(p, target, profile, random, room);
  if (!aim.canHit || !hasClearShot(room, p, target, aim)) {
    if (ammo.charges < 2 || now < (p._botPressureUntil || 0) || random() > 0.45) return false;
    aim = pressureAim(room, p, target, profile);
    if (!aim) return false;
  }
  // Lob shots are occasional pressure, unless the opponent is actually above
  // us. Rate-limit the decision too, so retries cannot turn 20% into spam.
  const highArc = p.char_class === 'huntress' && (aim.highArc || Math.sin(aim.angle) < -Math.sin(55 * Math.PI / 180));
  if (highArc && target.y >= p.y - 40) {
    if (now < (p._botHighArcCheckAfter || 0)) return false;
    p._botHighArcCheckAfter = now + 1800;
    if (random() >= 0.2) return false;
  }
  if (aim.pressure) p._botPressureUntil = now + 1800;
  p.flip = aim.direction < 0;
  const id = `${p.participantId}:${++p._botActionSeq}`;
  const action = { ...aim, id, x: p.x, y: p.y, forwardDistance: Math.min(aim.range, aim.distance + 40),
    mapCollisionRects: room.geometry?.colliders || [] };
  const descriptor = getResolvedAttackDescriptor(aim.type);
  const lockMs = Math.max(150, Number(descriptor?.actionFlow?.startupMs) || Number(descriptor?.runtime?.windupMs) || 0);
  ammo.charges--; ammo.nextFireInMs = ammo.cooldownMs;
  p._botActionUntil = now + lockMs; p.animation = "throw";
  room.handlePlayerAction(p.participantId, action);
  p._botLastAttackAt = now;
  return true;
}

function requestSpecial(room, p, target, now) {
  const lastAttackAt = Number(p._botLastAttackAt);
  if (p._botActionUntil > now || p.superCharge < p.maxSuperCharge ||
    (Number.isFinite(lastAttackAt) && now - lastAttackAt < BOT_ATTACK_TO_SUPER_COOLDOWN_MS)) return false;
  const aim = getResolvedCharacterSpecialAimConfig(p.char_class) || {};
  const distance = Math.hypot(target.x - p.x, target.y - p.y);
  const range = p.char_class === "wizard" ? (getResolvedCharacterAimConfig("wizard")?.defaultRange || 1000) : aim.defaultRange || aim.radius || (p.char_class === "thorg" ? 250 : 700);
  // These supers buff the caster/allies; their visual radius is not an enemy
  // targeting limit. The tactical evaluator decides when the buff is useful.
  if (!['thorg', 'wizard'].includes(p.char_class) && distance > range + 40) return false;
  const direction = target.x < p.x ? -1 : 1;
  const angle = aim.angleMode === "horizontal-only" ? (direction < 0 ? Math.PI : 0) : Math.atan2(target.y - p.y, target.x - p.x);
  p.flip = direction < 0;
  const used = room.requestSpecial(p.participantId, { aim: { direction, angle, range } });
  if (used) { p._botActionUntil = now + (p.char_class === "ninja" ? 720 : 450); p.animation = "special"; }
  return used;
}

function startNinjaSwarm(room, p, now, aim = {}) {
  const cfg = getResolvedCharacterSpecialConfig("ninja", "swarm") || {};
  const count = cfg.count ?? 15, releaseMs = cfg.releaseMs ?? 36;
  const direction = aim.direction === -1 ? -1 : 1;
  const burst = ++p._botActionSeq;
  for (let i = 0; i < count; i++) room.scheduleAction(() => {
    if (!p.isAlive) return;
    const spread = i - (count - 1) / 2;
    const yOffset = spread * (cfg.yOffsetPerShard ?? 5.5);
    const action = { type: "ninja-shuriken", id: `${p.participantId}:swarm:${burst}:${i}`, direction, angle: direction < 0 ? Math.PI : 0,
      x: p.x + direction * ((cfg.spawnForwardBase ?? 28) + Math.abs(spread) * (cfg.spawnForwardPerShard ?? 1.6)),
      y: p.y + (cfg.spawnYBase ?? -12) + yOffset,
      forwardDistance: (cfg.forwardDistanceBase ?? 440) + Math.abs(spread) * (cfg.forwardDistancePerShard ?? 6),
      outwardDuration: (cfg.outwardDurationBase ?? 330) + Math.abs(spread) * (cfg.outwardDurationPerShard ?? 8),
      returnSpeed: cfg.returnSpeed ?? 960,
      endYOffset: spread * (cfg.fanStrengthPerShard ?? 14),
      ctrl1YOffset: (cfg.ctrl1YOffsetBase ?? 16) + yOffset * (cfg.ctrl1YOffsetScale ?? 0.25),
      ctrl2YOffset: -((cfg.ctrl2YOffsetBase ?? 52) + Math.abs(spread * (cfg.fanStrengthPerShard ?? 14)) * (cfg.ctrl2YOffsetScale ?? 0.45)) };
    attackRuntime.registerAttackFromAction(room, p, action, room._botNow || Date.now());
    const attack = room._activeAttacks.at(-1);
    if (attack?.instanceId === action.id) attack.attackType = "ninja-special-swarm";
  }, i * releaseMs, now);
}
module.exports = { BOT_ATTACK_TO_SUPER_COOLDOWN_MS, advanceAmmo, basicAim, hasClearShot, pressureAim, requestBasic, requestSpecial, startNinjaSwarm };
