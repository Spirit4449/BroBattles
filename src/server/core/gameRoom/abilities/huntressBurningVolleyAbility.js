const attackRuntimeManager = require("../attackRuntimeManager");
const { broadcastAction } = require("../characterActionRegistry");
const {
  getResolvedCharacterSpecialConfig,
} = require("../../../../lib/characterTuning.js");

const KEY = "hunteress";
const VOLLEY = getResolvedCharacterSpecialConfig(KEY, "burningVolley") || {};

function toFiniteNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function degToRad(degrees) {
  return (Number(degrees) || 0) * (Math.PI / 180);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveAimBallistics(angle, speed, range) {
  const upFactor = clamp(-Math.sin(Number(angle) || 0), 0, 1);
  const speedScale = 1 - upFactor * 0.32;
  const rangeScale = 1 + upFactor * 0.45;
  return {
    speed: Math.max(1, Number(speed) * speedScale),
    range: Math.max(180, Number(range) * rangeScale),
  };
}

function buildProjectiles(angle, payload = {}, profile = null) {
  const count = Math.max(1, Number(VOLLEY.count) || 6);
  const spread = degToRad(VOLLEY.spreadDeg || 26);
  const center = (count - 1) / 2;
  const baseSpeed = Math.max(1, toFiniteNumber(VOLLEY.speed, 930));
  const baseRange = Math.max(1, toFiniteNumber(payload?.range, VOLLEY.range || 960));
  const resolved = profile || resolveAimBallistics(angle, baseSpeed, baseRange);
  const speed = resolved.speed;
  const range = resolved.range;
  const gravity = Math.max(0, Number(VOLLEY.gravity) || 980);
  const maxLifetimeMs = Math.max(
    200,
    Number(VOLLEY.maxLifetimeMs) || Math.ceil((range / speed) * 1000 * 1.35),
  );
  const embedMs = Math.max(120, Number(VOLLEY.embedMs) || 2200);
  const burn = {
    durationMs: Math.max(1, Number(VOLLEY.burnDurationMs) || 5000),
    totalDamage: Math.max(0, Number(VOLLEY.burnTotalDamage) || 500),
    groundBurnMs: Math.max(250, Number(VOLLEY.groundBurnMs) || 2200),
  };

  return Array.from({ length: count }, (_, index) => {
    const offset =
      count === 1 ? 0 : ((index - center) / Math.max(1, center)) * (spread / 2);
    return {
      index,
      angle: angle + offset,
      range,
      speed,
      collisionRadius: Math.max(1, Number(VOLLEY.collisionRadius) || 18),
      damage: Math.max(1, Number(VOLLEY.damagePerArrow) || 1500),
      scale: Math.max(0.05, Number(VOLLEY.visualScale) || 0.24),
      gravity,
      maxLifetimeMs,
      embedMs,
      burn,
    };
  });
}

function activate(caster, now, room, payload = null) {
  if (!caster || !room) return;
  const aim = payload && typeof payload === "object" ? payload : {};
  const fallbackAngle = caster.flip ? Math.PI : 0;
  const angle = toFiniteNumber(aim.angle, fallbackAngle);
  const direction =
    Number(aim.direction) === -1 ||
    (Math.cos(angle) < -0.1 && Number(aim.direction) !== 1)
      ? -1
      : 1;
  const baseSpeed = Math.max(1, Number(VOLLEY.speed) || 930);
  const baseRange = Math.max(1, toFiniteNumber(aim.range, VOLLEY.range || 960));
  const profile = resolveAimBallistics(angle, baseSpeed, baseRange);
  const speed = profile.speed;
  const range = profile.range;
  const gravity = Math.max(0, Number(VOLLEY.gravity) || 980);
  const maxLifetimeMs = Math.max(
    200,
    Number(VOLLEY.maxLifetimeMs) || Math.ceil((range / speed) * 1000 * 1.35),
  );
  const embedMs = Math.max(120, Number(VOLLEY.embedMs) || 2200);
  const id = `huntressVolley:${caster.socketId || caster.name}:${now}`;
  const action = {
    type: `${KEY}-burning-arrow`,
    id,
    ownerEcho: true,
    direction,
    angle,
    range,
    speed,
    releaseMs: 0,
    collisionRadius: Math.max(1, Number(VOLLEY.collisionRadius) || 18),
    damage: Math.max(1, Number(VOLLEY.damagePerArrow) || 1500),
    scale: Math.max(0.05, Number(VOLLEY.visualScale) || 0.24),
    gravity,
    maxLifetimeMs,
    embedMs,
    burn: {
      durationMs: Math.max(1, Number(VOLLEY.burnDurationMs) || 5000),
      totalDamage: Math.max(0, Number(VOLLEY.burnTotalDamage) || 500),
      groundBurnMs: Math.max(250, Number(VOLLEY.groundBurnMs) || 2200),
    },
    projectiles: buildProjectiles(angle, aim, profile),
  };

  const startup = Math.max(0, Number(VOLLEY.castDelayMs) || 0);
  const release = () => {
    if (
      room.status !== "active" ||
      !caster.isAlive ||
      caster.connected === false ||
      caster.loaded !== true
    ) {
      return;
    }
    attackRuntimeManager.registerAttackFromAction(room, caster, action, Date.now());
    broadcastAction(room, caster, action, Date.now());
  };

  if (startup > 0) setTimeout(release, startup);
  else release();
}

module.exports = {
  key: KEY,
  activate,
};
