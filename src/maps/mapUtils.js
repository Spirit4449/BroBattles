// src/maps/mapUtils.js
// Shared client utility for placing sprites precisely on top of a platform.
// Imported by every map module — eliminates the copy-paste duplication.

/**
 * Snap a sprite so its feet land exactly on top of a platform.
 * Works for both arcade-physics bodies and plain display objects.
 *
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {Phaser.GameObjects.Sprite} platform
 * @param {number} targetX  — desired center X
 * @param {number} [epsilon=2] — tiny upward nudge so the physics engine never
 *   considers the sprite "below" the surface and tunnels through it.
 */
export function snapSpriteToPlatform(sprite, platform, targetX, epsilon = 2) {
  if (!sprite || !platform) return;

  const topY = platform.body ? platform.body.top : platform.getTopCenter().y;
  if (sprite.body) {
    const body = sprite.body;
    const halfH = (Number(body.height) || 0) / 2;
    const offsetY = Number(body.offset?.y) || 0;
    const targetY = topY - halfH - offsetY - epsilon;

    if (typeof body.reset === "function") {
      body.reset(targetX, targetY);
    } else {
      sprite.setPosition(targetX, targetY);
    }

    if (body.velocity?.set) body.velocity.set(0, 0);
    if (body.acceleration?.set) body.acceleration.set(0, 0);
    if (typeof body.updateFromGameObject === "function") {
      body.updateFromGameObject();
      const desiredBottom = topY - epsilon;
      const correction = desiredBottom - body.bottom;
      if (Math.abs(correction) > 0.5) {
        sprite.y += correction;
        body.updateFromGameObject();
      }
    }
  } else {
    const h = Number(sprite.height) || 0;
    sprite.setPosition(targetX, topY - h / 2 - epsilon);
  }
}

function resolveSpawnX(scene, point) {
  const x = Number(point?.x);
  if (Number.isFinite(x)) return x;
  const dx = Number(point?.dx);
  if (Number.isFinite(dx)) {
    const cx =
      Number(scene?.scale?.width || scene?.game?.config?.width || 0) / 2;
    return cx + dx;
  }
  return null;
}

function resolveSpawnY(point) {
  const y = Number(point?.y);
  if (Number.isFinite(y)) return y;
  return null;
}

export function placeSpriteAtConfiguredSpawn(
  scene,
  sprite,
  point,
  anchors = {},
  epsilon = 2,
) {
  if (!scene || !sprite || !point) return;

  const x = resolveSpawnX(scene, point);
  if (!Number.isFinite(x)) return;

  const anchorId = String(point?.anchorId || "").trim();
  const anchor = anchorId ? anchors?.[anchorId] : null;
  if (anchor) {
    snapSpriteToPlatform(sprite, anchor, x, epsilon);
    return;
  }

  const y = resolveSpawnY(point);
  if (!Number.isFinite(y)) return;
  if (sprite.body && typeof sprite.body.reset === "function") {
    sprite.body.reset(x, y);
    return;
  }
  sprite.setPosition(x, y);
}

export function getSpawnPreviewPoint(scene, point, anchors = {}, epsilon = 2) {
  const x = resolveSpawnX(scene, point);
  if (!Number.isFinite(x)) return null;

  const anchorId = String(point?.anchorId || "").trim();
  const anchor = anchorId ? anchors?.[anchorId] : null;
  if (anchor) {
    const topY = anchor.body ? anchor.body.top : anchor.getTopCenter().y;
    return { x, y: topY - epsilon };
  }

  const y = resolveSpawnY(point);
  if (!Number.isFinite(y)) return null;
  return { x, y };
}

export function getSpawnPointForTeam(spawnConfig, team, index, teamSize) {
  const modeKey = String(Math.max(1, Math.min(3, Number(teamSize) || 1)));
  const teamConfig = spawnConfig?.players?.[team];
  const slots =
    teamConfig?.[modeKey] ||
    teamConfig?.["3"] ||
    teamConfig?.["2"] ||
    teamConfig?.["1"] ||
    [];
  if (!Array.isArray(slots) || !slots.length) return null;

  const i = Math.max(0, Math.min(slots.length - 1, Number(index) || 0));
  return slots[i] || slots[0];
}

export function applyMapBounds(scene, boundsConfig = {}) {
  if (!scene) return;

  const world = boundsConfig?.world;
  if (world) {
    const x = Number(world.x);
    const y = Number(world.y);
    const width = Number(world.width);
    const height = Number(world.height);
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height)
    ) {
      scene.physics?.world?.setBounds(x, y, width, height);
    }
  }

  const camera = boundsConfig?.camera;
  if (camera && scene.cameras?.main) {
    const cam = scene.cameras.main;
    const x = Number(camera.x);
    const y = Number(camera.y);
    const width = Number(camera.width);
    const height = Number(camera.height);
    if (
      Number.isFinite(x) &&
      Number.isFinite(y) &&
      Number.isFinite(width) &&
      Number.isFinite(height)
    ) {
      cam.setBounds(x, y, width, height);
    }

    const followOffsetY = Number(camera.followOffsetY);
    if (Number.isFinite(followOffsetY)) {
      cam.setFollowOffset(0, followOffsetY);
    }

    const deadzoneW = Number(camera.deadzoneWidth);
    const deadzoneH = Number(camera.deadzoneHeight);
    if (Number.isFinite(deadzoneW) && Number.isFinite(deadzoneH)) {
      cam.setDeadzone(deadzoneW, deadzoneH);
    }

    const zoom = Number(camera.zoom);
    if (Number.isFinite(zoom)) {
      cam.setZoom(zoom);
    }
  }
}
