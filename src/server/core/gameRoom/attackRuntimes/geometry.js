const DEFAULT_TARGET_HALF_HEIGHT = 60;
const DEFAULT_TARGET_HALF_WIDTH = 28;
const { WORLD_MARGIN } = require("../../gameRoomConfig");
const { circleAabbOverlap, attackCollisionCenter: getAttackCollisionCenter } = require("../../../../shared/combat/shotContact");

// `at` places the box at another position, such as a lag-compensated one.
function getPlayerBounds(target, at = target) {
  const halfH = Math.max(
    8,
    Number(target?._bodyHalfHeight) || DEFAULT_TARGET_HALF_HEIGHT,
  );
  const halfW = Math.max(
    4,
    Number(target?._bodyHalfWidth) || DEFAULT_TARGET_HALF_WIDTH,
  );
  const centerX = Number(at.x) + (Number(target?._bodyCenterOffsetX) || 0);
  const centerY = Number(at.y) + (Number(target?._bodyCenterOffsetY) || 0);
  return {
    left: centerX - halfW,
    right: centerX + halfW,
    top: centerY - halfH,
    bottom: centerY + halfH,
  };
}

function getBoundsCenter(bounds) {
  return {
    x: (Number(bounds?.left) + Number(bounds?.right)) / 2,
    y: (Number(bounds?.top) + Number(bounds?.bottom)) / 2,
  };
}

function normalizeAngleDelta(a, b) {
  let delta = Number(a) - Number(b);
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function cubic(t, p0, p1, p2, p3) {
  const it = 1 - t;
  return (
    it * it * it * p0 +
    3 * it * it * t * p1 +
    3 * it * t * t * p2 +
    t * t * t * p3
  );
}

function resolvePlayerWidth(playerData) {
  return Number(playerData?._lastWidth) || 80;
}

function resolvePlayerHeight(playerData) {
  return Number(playerData?._lastHeight) || 120;
}

function resolvePositiveNumber(value, fallback) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return n;
  return fallback;
}

function clampToWorld(value, axis, room) {
  const world = room.geometry.world;
  const [min, size] = axis === "y" ? [world.y, world.height] : [world.x, world.width];
  return Math.max(min - WORLD_MARGIN, Math.min(min + size + WORLD_MARGIN, Number(value) || 0));
}

function sweptCircleOverlapsRect(prevX, prevY, nextX, nextY, rect, radius = 0) {
  const left = Number(rect?.left);
  const right = Number(rect?.right);
  const top = Number(rect?.top);
  const bottom = Number(rect?.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return false;
  const minX = Math.min(prevX, nextX) - radius;
  const maxX = Math.max(prevX, nextX) + radius;
  const minY = Math.min(prevY, nextY) - radius;
  const maxY = Math.max(prevY, nextY) + radius;
  return !(maxX < left || minX > right || maxY < top || minY > bottom);
}

module.exports = { getPlayerBounds, getBoundsCenter, normalizeAngleDelta, circleAabbOverlap, cubic, resolvePlayerWidth, resolvePlayerHeight, resolvePositiveNumber, getAttackCollisionCenter, clampToWorld, sweptCircleOverlapsRect };
