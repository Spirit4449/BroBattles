// src/maps/mapUtils.js
// Shared client utility for placing sprites precisely on top of a platform.
// Imported by every map module — eliminates the copy-paste duplication.

/**
 * Snap a sprite so its bottom lands exactly on top of a platform.
 * Simple approach: get platform top, position sprite so its display bottom aligns with it.
 *
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {Phaser.GameObjects.Sprite} platform
 * @param {number} targetX  — desired center X
 * @param {number} [epsilon=2] — tiny upward nudge to prevent tunneling
 */
export function snapSpriteToPlatform(sprite, platform, targetX, epsilon = 2) {
  if (!sprite || !platform) return;

  // Get platform top Y coordinate
  const platformTopY = platform.body
    ? platform.body.top
    : platform.getTopCenter().y;

  // Position sprite so its display bottom sits on the platform top
  // Sprite display height = height * scaleY
  const displayHeight = sprite.height * Math.abs(sprite.scaleY || 1);
  const halfDisplayHeight = displayHeight / 2;

  // Sprite center Y = platformTopY - halfDisplayHeight - epsilon
  const targetY = platformTopY - halfDisplayHeight - epsilon;

  // Set position and reset physics
  if (sprite.body && typeof sprite.body.reset === "function") {
    sprite.body.reset(targetX, targetY);
  } else {
    sprite.setPosition(targetX, targetY);
  }

  // Clear any existing velocity
  if (sprite.body?.velocity?.set) sprite.body.velocity.set(0, 0);
  if (sprite.body?.acceleration?.set) sprite.body.acceleration.set(0, 0);

  // Update physics body position
  if (sprite.body?.updateFromGameObject) {
    sprite.body.updateFromGameObject();
  }
}

function getAnchorCenterX(anchor) {
  if (!anchor) return null;

  const bodyCenterX = Number(anchor?.body?.center?.x);
  if (Number.isFinite(bodyCenterX)) return bodyCenterX;

  const anchorX = Number(anchor?.x);
  if (Number.isFinite(anchorX)) return anchorX;

  return null;
}

function resolveSpawnX(scene, point, anchor = null) {
  const x = Number(point?.x);
  if (Number.isFinite(x)) return x;

  const dx = Number(point?.dx);
  const anchorX = getAnchorCenterX(anchor);
  if (Number.isFinite(anchorX)) {
    return Number.isFinite(dx) ? anchorX + dx : anchorX;
  }

  if (Number.isFinite(dx)) {
    return getSceneWorldCenterX(scene) + dx;
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

  const anchorId = String(point?.anchorId || "").trim();
  const anchor = anchorId ? anchors?.[anchorId] : null;

  const x = resolveSpawnX(scene, point, anchor);
  if (!Number.isFinite(x)) return;

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
  const anchorId = String(point?.anchorId || "").trim();
  const anchor = anchorId ? anchors?.[anchorId] : null;

  const x = resolveSpawnX(scene, point, anchor);
  if (!Number.isFinite(x)) return null;

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

export function getSceneWorldCenterX(scene) {
  const worldCenter = Number(scene?.physics?.world?.bounds?.centerX);
  if (Number.isFinite(worldCenter)) return worldCenter;

  const worldX = Number(scene?.physics?.world?.bounds?.x);
  const worldW = Number(scene?.physics?.world?.bounds?.width);
  if (Number.isFinite(worldX) && Number.isFinite(worldW) && worldW > 0) {
    return worldX + worldW / 2;
  }

  const scaleW = Number(scene?.scale?.width);
  if (Number.isFinite(scaleW) && scaleW > 0) return scaleW / 2;

  const gameW = Number(scene?.game?.config?.width);
  if (Number.isFinite(gameW) && gameW > 0) return gameW / 2;

  return 1150;
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

function createConfiguredPlatform(scene, row) {
  const key = String(row?.textureKey || "").trim();
  if (!key || !scene?.textures?.exists(key)) return null;

  const x = Number(row?.x);
  const y = Number(row?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const sprite = scene.physics.add.sprite(x, y, key);
  sprite.body.allowGravity = false;
  sprite.setImmovable(true);
  sprite.setScale(Number(row?.scaleX) || 1, Number(row?.scaleY) || 1);
  sprite.setFlipX(!!row?.flipX);

  const bw = Number(row?.body?.width);
  const bh = Number(row?.body?.height);
  if (
    sprite.body &&
    Number.isFinite(bw) &&
    Number.isFinite(bh) &&
    bw > 0 &&
    bh > 0
  ) {
    sprite.body.setSize(bw, bh);
  }
  const ox = Number(row?.body?.offsetX);
  const oy = Number(row?.body?.offsetY);
  if (sprite.body && Number.isFinite(ox) && Number.isFinite(oy)) {
    sprite.body.setOffset(ox, oy);
  }

  if (sprite.body && typeof sprite.body.updateFromGameObject === "function") {
    sprite.body.updateFromGameObject();
  }
  return sprite;
}

function createConfiguredBoundary(scene, row) {
  const x = Number(row?.x);
  const y = Number(row?.y);
  const w = Number(row?.width);
  const h = Number(row?.height);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0)
    return null;

  const zone = scene.add.zone(x, y, w, h);
  scene.physics.add.existing(zone, true);
  zone.body.checkCollision.up = row?.collision?.up !== false;
  zone.body.checkCollision.down = row?.collision?.down !== false;
  zone.body.checkCollision.left = row?.collision?.left !== false;
  zone.body.checkCollision.right = row?.collision?.right !== false;
  return zone;
}

/**
 * Appends platform/boundary objects to an existing map object list using
 * reusable config from editor-exported snippets.
 *
 * @param {Phaser.Scene} scene
 * @param {Array} objects - map object array to append into
 * @param {object} layoutConfig - { platforms: [], hitboxes: [] }
 */
export function appendLayoutObjectsFromConfig(
  scene,
  objects,
  layoutConfig = {},
) {
  if (!scene || !Array.isArray(objects) || !layoutConfig) return;

  const platforms = Array.isArray(layoutConfig.platforms)
    ? layoutConfig.platforms
    : [];
  const hitboxes = Array.isArray(layoutConfig.hitboxes)
    ? layoutConfig.hitboxes
    : [];

  for (const row of platforms) {
    const sprite = createConfiguredPlatform(scene, row);
    if (sprite) objects.push(sprite);
  }

  for (const row of hitboxes) {
    const zone = createConfiguredBoundary(scene, row);
    if (zone) objects.push(zone);
  }
}
