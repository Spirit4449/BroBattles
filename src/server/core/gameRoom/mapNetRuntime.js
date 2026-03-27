const mapNetConfig = require("../../../shared/mapNetConfig.json");
const mapCollisionConfig = require("../../../shared/mapCollisionConfig.json");

function getWorldBoundsForMap(mapId) {
  const margin = Math.max(0, Number(mapNetConfig?.defaultMargin) || 0);
  const key = String(Number(mapId) || 1);
  const world =
    mapNetConfig?.maps?.[key]?.world || mapNetConfig?.maps?.["1"]?.world || {};

  const x = Number(world.x);
  const y = Number(world.y);
  const width = Number(world.width);
  const height = Number(world.height);

  return {
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    width: Number.isFinite(width) && width > 0 ? width : 2300,
    height: Number.isFinite(height) && height > 0 ? height : 1000,
    margin,
  };
}

function clampToWorldBounds(bounds, x, y) {
  const safe = bounds || getWorldBoundsForMap(1);
  const minX = safe.x - safe.margin;
  const maxX = safe.x + safe.width + safe.margin;
  const minY = safe.y - safe.margin;
  const maxY = safe.y + safe.height + safe.margin;

  return {
    x: Math.max(minX, Math.min(maxX, Number(x) || 0)),
    y: Math.max(minY, Math.min(maxY, Number(y) || 0)),
  };
}

module.exports = {
  getWorldBoundsForMap,
  clampToWorldBounds,
  getMapCollisionConfig(mapId) {
    const key = String(Number(mapId) || 1);
    return mapCollisionConfig?.maps?.[key] || { surfaces: [], solids: [] };
  },
  getSurfaceCollisionConfig(mapId) {
    const key = String(Number(mapId) || 1);
    return mapCollisionConfig?.maps?.[key]?.surfaces || [];
  },
  getSolidCollisionConfig(mapId) {
    const key = String(Number(mapId) || 1);
    return mapCollisionConfig?.maps?.[key]?.solids || [];
  },
  getDefaultPlayerCollisionBox() {
    return {
      halfWidth: Math.max(
        8,
        Number(mapCollisionConfig?.defaultPlayerHalfWidth) || 28,
      ),
      halfHeight: Math.max(
        16,
        Number(mapCollisionConfig?.defaultPlayerHalfHeight) || 60,
      ),
    };
  },
};
