const { getResolvedCharacterAttackConfig, getResolvedCharacterAimConfig, getResolvedCharacterSpecialAimConfig, getResolvedCharacterSpecialConfig } = require("../../../lib/characterTuning.js");
const { getResolvedAttackDescriptor } = require("../gameRoom/attackDescriptorResolver");
const attackRuntime = require("../gameRoom/attackRuntimeManager");
const attackTypes = { ninja: "ninja-shuriken", thorg: "thorg-fall", draven: "draven-splash", wizard: "wizard-fireball", huntress: "huntress-arrow", gloop: "gloop-slimeball" };

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
  const flight = Math.min(0.7, distance / (runtime.speed || 800)) * profile.prediction;
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
  return { type, angle, direction, range, distance, gravity: runtime.gravity || 0, maxLifetimeMs: runtime.maxLifetimeMs || 3000, target: { x: player.x + Math.cos(angle) * Math.min(range, distance), y: player.y + Math.sin(angle) * Math.min(range, distance) } };
}

function requestBasic(room, p, target, profile, random, now) {
  const ammo = p.ammoState;
  if (!p.isAlive || p._botActionUntil > now || p._controlLockUntil > now || !ammo || ammo.charges <= 0 || ammo.nextFireInMs > 0) return false;
  const aim = basicAim(p, target, profile, random);
  if (aim.distance > aim.range + 30) return false;
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
  if (distance > range + 40) return false;
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
module.exports = { advanceAmmo, basicAim, requestBasic, requestSpecial, startNinjaSwarm };
