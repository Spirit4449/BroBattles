const attackRuntimeManager = require("../attackRuntimeManager");
const { broadcastAction } = require("../characterActionRegistry");
const {
  getResolvedCharacterSpecialConfig,
} = require("../../../../lib/characterTuning.js");

const KEY = "gloop";
const HOOK = getResolvedCharacterSpecialConfig(KEY, "hook") || {};

function toFinite(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function activate(caster, now, room, payload = null) {
  if (!caster || !room) return;
  const aim = payload && typeof payload === "object" ? payload : {};
  const fallbackAngle = caster.flip ? Math.PI : 0;
  const angle = toFinite(aim.angle, fallbackAngle);
  const direction =
    Number(aim.direction) === -1 ||
    (Math.cos(angle) < -0.1 && Number(aim.direction) !== 1)
      ? -1
      : 1;

  const action = {
    type: "gloop-hook-release",
    id: `gloopHook:${caster.socketId || caster.name}:${now}`,
    ownerEcho: true,
    direction,
    angle,
    speed: Math.max(1, Number(HOOK.speed) || 900),
    range: Math.max(1, Number(HOOK.range) || 780),
    collisionRadius: Math.max(1, Number(HOOK.collisionRadius) || 34),
    damage: Math.max(
      1,
      Number(HOOK.damage) || Number(caster.specialDamage) || 500,
    ),
    pullDurationMs: Math.max(120, Number(HOOK.pullDurationMs) || 640),
    pullLockPaddingMs: Math.max(0, Number(HOOK.pullLockPaddingMs) || 120),
    pulledStopDistance: Math.max(1, Number(HOOK.pulledStopDistance) || 54),
    slowDurationMs: Math.max(1, Number(HOOK.slowDurationMs) || 2200),
    slowSpeedMult: Math.max(0.1, Number(HOOK.slowSpeedMult) || 0.5),
    slowJumpMult: Math.max(0.1, Number(HOOK.slowJumpMult) || 0.5),
    maxLifetimeMs: Math.max(
      200,
      Math.ceil(
        (Math.max(1, Number(HOOK.range) || 780) /
          Math.max(1, Number(HOOK.speed) || 900)) *
          1000 *
          1.5,
      ),
    ),
  };

  const startup = Math.max(0, Number(HOOK.castDelayMs) || 0);
  const release = () => {
    if (
      room.status !== "active" ||
      !caster.isAlive ||
      caster.connected === false ||
      caster.loaded !== true
    ) {
      return;
    }
    attackRuntimeManager.registerAttackFromAction(
      room,
      caster,
      action,
      Date.now(),
    );
    broadcastAction(room, caster, action, Date.now());
  };

  if (startup > 0) setTimeout(release, startup);
  else release();
}

module.exports = {
  key: KEY,
  activate,
};
