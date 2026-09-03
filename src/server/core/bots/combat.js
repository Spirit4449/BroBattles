const { getResolvedCharacterAttackConfig, getResolvedCharacterAimConfig, getResolvedCharacterSpecialAimConfig, getResolvedCharacterSpecialConfig } = require("../../../lib/characterTuning.js");
const { getResolvedAttackDescriptor } = require("../gameRoom/attackDescriptorResolver");
const attackRuntime = require("../gameRoom/attackRuntimeManager");
const attackTypes = { ninja: "ninja-shuriken", thorg: "thorg-fall", draven: "draven-splash", wizard: "wizard-fireball", huntress: "huntress-arrow", gloop: "gloop-slimeball" };

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

function hasClearShot(room, player, target, aim = basicAim(player, target, player.difficulty || {}, () => 0.5)) {
  if (!['wizard', 'gloop'].includes(player.char_class)) return true;
  return !(room.geometry?.colliders || []).some((rect) =>
    segmentCrossesRect(player.x, player.y, aim.target.x, aim.target.y, rect));
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

function basicAim(player, target, profile, random) {
  const type = attackTypes[player.char_class];
  const descriptor = getResolvedAttackDescriptor(type);
  const aim = getResolvedCharacterAimConfig(player.char_class) || {};
  const release = getResolvedAttackDescriptor(descriptor?.actionFlow?.releaseActionType || type);
  const cfg = getResolvedCharacterAttackConfig(player.char_class, aim.attackKey) || {};
  const runtime = { ...cfg, ...(release?.runtime || {}) };
  const range = aim.defaultRange || runtime.range || runtime.defaultForwardDistance || 200;
  const distance = Math.hypot(target.x - player.x, target.y - player.y);
  const startup = (Number(descriptor?.actionFlow?.startupMs) || Number(runtime.windupMs) || 0) / 1000;
  const flight = Math.min(0.9, startup + interceptTime(target.x - player.x, target.y - player.y,
    target.vx || 0, target.vy || 0, runtime.speed || 800)) * profile.prediction;
  const dx = target.x + (target.vx || 0) * flight - player.x;
  let dy = target.y + (target.vy || 0) * flight - player.y;
  // Lead gravity-driven shots upward by the projected drop during flight.
  if (player.char_class === "huntress") {
    const travelTime = Math.max(0.08, Math.abs(dx) / (runtime.speed || 560));
    dy -= 0.5 * (runtime.gravity || 400) * travelTime * travelTime;
  }
  let angle = Math.atan2(dy, dx) + (random() * 2 - 1) * profile.aimError;
  const direction = Math.cos(angle) < 0 ? -1 : 1;
  if (aim.angleMode === "horizontal-only") angle = direction < 0 ? Math.PI : 0;
  const canHit = distance <= range + 30 && (aim.angleMode !== 'horizontal-only' || Math.abs(target.y - player.y) < 90);
  return { type, angle, direction, range, distance, canHit, gravity: runtime.gravity || 0, maxLifetimeMs: runtime.maxLifetimeMs || 3000, target: { x: player.x + Math.cos(angle) * Math.min(range, Math.hypot(dx, dy)), y: player.y + Math.sin(angle) * Math.min(range, Math.hypot(dx, dy)) } };
}

function requestBasic(room, p, target, profile, random, now) {
  const ammo = p.ammoState;
  if (!p.isAlive || p._botActionUntil > now || p._controlLockUntil > now || !ammo || ammo.charges <= 0 || ammo.nextFireInMs > 0) return false;
  const aim = basicAim(p, target, profile, random);
  if (!aim.canHit) return false;
  p.flip = aim.direction < 0;
  const id = `${p.participantId}:${++p._botActionSeq}`;
  const action = { ...aim, id, x: p.x, y: p.y, forwardDistance: Math.min(aim.range, aim.distance + 40),
    mapCollisionRects: room.geometry?.colliders || [] };
  const descriptor = getResolvedAttackDescriptor(aim.type);
  const lockMs = Math.max(150, Number(descriptor?.actionFlow?.startupMs) || Number(descriptor?.runtime?.windupMs) || 0);
  ammo.charges--; ammo.nextFireInMs = ammo.cooldownMs;
  p._botActionUntil = now + lockMs; p.animation = "throw";
  room.handlePlayerAction(p.participantId, action);
  return true;
}

function requestSpecial(room, p, target, now) {
  if (p._botActionUntil > now || p.superCharge < p.maxSuperCharge) return false;
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
module.exports = { advanceAmmo, basicAim, hasClearShot, requestBasic, requestSpecial, startNinjaSwarm };
