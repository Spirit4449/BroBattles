const DEFAULT_TARGET_HALF_HEIGHT = 60;
const DEFAULT_TARGET_HALF_WIDTH = 28;
const { WORLD_BOUNDS } = require("../../gameRoomConfig");

function getPlayerBounds(target) {
  const halfH = Math.max(
    8,
    Number(target?._bodyHalfHeight) || DEFAULT_TARGET_HALF_HEIGHT,
  );
  const halfW = Math.max(
    4,
    Number(target?._bodyHalfWidth) || DEFAULT_TARGET_HALF_WIDTH,
  );
  const centerX = Number(target.x) + (Number(target?._bodyCenterOffsetX) || 0);
  const centerY = Number(target.y) + (Number(target?._bodyCenterOffsetY) || 0);
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

function circleAabbOverlap(cx, cy, radius, bounds) {
  const nearestX = Math.max(bounds.left, Math.min(Number(cx), bounds.right));
  const nearestY = Math.max(bounds.top, Math.min(Number(cy), bounds.bottom));
  const dist = Math.hypot(Number(cx) - nearestX, Number(cy) - nearestY);
  return dist <= radius;
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

function clampToWorld(value, axis = "x", room = null) {
  const world = room?.geometry?.world;
  const margin = Number(WORLD_BOUNDS?.margin) || 0;
  if (axis === "y") {
    const minY = (world?.y || 0) - margin;
    const maxY = (world ? world.y + world.height : Number(WORLD_BOUNDS?.height) || 1000) + margin;
    return Math.max(minY, Math.min(maxY, Number(value) || 0));
  }
  const minX = (world?.x || 0) - margin;
  const maxX = (world ? world.x + world.width : Number(WORLD_BOUNDS?.width) || 3600) + margin;
  return Math.max(minX, Math.min(maxX, Number(value) || 0));
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

module.exports = { getPlayerBounds, getBoundsCenter, normalizeAngleDelta, circleAabbOverlap, cubic, resolvePlayerWidth, resolvePlayerHeight, resolvePositiveNumber, clampToWorld, sweptCircleOverlapsRect };
