// src/client/game/maps/mapUtils.js
// Shared client utility for placing sprites precisely on top of a platform.
// Imported by every map module — eliminates the copy-paste duplication.
import { resolveLanding } from '../../../shared/physics/spawnPlacement';

function spawnGeometry(scene, anchors) {
  const objects = [...new Set([...(scene?._mapObjects || []), ...Object.values(anchors)])];
  const entries = objects.filter(o => o?.body).map(o => {
    o.body.updateFromGameObject?.();
    const b = o.body;
    return { object: o, left: b.left, right: b.right, top: b.top, bottom: b.bottom,
      enabled: b.enable, collision: b.checkCollision, motion: o._mapMotion };
  });
  return entries;
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

  sprite.body?.updateFromGameObject?.();
  const geometry = spawnGeometry(scene, anchors);
  const landing = resolveLanding(point, geometry.find(p => p.object === anchor), geometry,
    { width: sprite.body?.width || sprite.displayWidth, height: sprite.body?.height || sprite.displayHeight });
  const bottomOffset = sprite.body ? sprite.body.bottom - sprite.y : sprite.displayHeight / 2;
  const centerOffset = sprite.body ? sprite.body.center.x - sprite.x : 0;
  sprite.body.reset(landing.x - centerOffset, landing.y - bottomOffset);
}

export function getSpawnPointForTeam(spawnConfig, team, index) {
  const slots = spawnConfig?.players?.[team];
  if (!Array.isArray(slots) || !slots.length) return null;

  const i = Math.max(0, Math.min(slots.length - 1, Number(index) || 0));
  return slots[i] || slots[0];
}

export function applyMapBounds(scene, boundsConfig = {}, options = {}) {
  if (!scene) return;
  const extraTopSpace = Math.max(0, Number(options?.extraTopSpace) || 0);

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
      scene.physics?.world?.setBounds(
        x,
        y - extraTopSpace,
        width,
        height + extraTopSpace,
      );
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

function setSpriteBodySizeFromDisplaySize(sprite, width, height) {
  if (!sprite?.body) return;
  const scaleX = Math.max(0.0001, Math.abs(Number(sprite.scaleX) || 1));
  const scaleY = Math.max(0.0001, Math.abs(Number(sprite.scaleY) || 1));
  const rawW = Math.max(1, Number(width) / scaleX);
  const rawH = Math.max(1, Number(height) / scaleY);
  sprite.body.setSize(rawW, rawH);
}

function createConfiguredPlatform(scene, row) {
  const key = String(row?.textureKey || "").trim();
  if (!key || !scene?.textures?.exists(key)) return null;

  const x = Number(row?.x);
  const y = Number(row?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  const sprite = scene.physics.add.sprite(x, y, key, row.frame);
  return configureMapPlatform(sprite,row);
}

export function configureMapPlatform(sprite,row) {
  sprite.setTexture(row.textureKey,row.frame);
  sprite.setPosition(row.x,row.y);
  sprite.body.enable = row.collisionEnabled !== false;
  sprite.body.allowGravity = false;
  sprite.setImmovable(true);
  sprite.setScale(Number(row?.scaleX) || 1, Number(row?.scaleY) || 1);
  sprite.setFlipX(!!row?.flipX);

  if (sprite.body && typeof sprite.body.updateFromGameObject === "function") {
    sprite.body.updateFromGameObject();
  }

  const bw = Number(row?.body?.width) || sprite.displayWidth;
  const bh = Number(row?.body?.height) || sprite.displayHeight;
  setSpriteBodySizeFromDisplaySize(sprite, bw, bh);
  const ox = Number(row?.body?.offsetX);
  const oy = Number(row?.body?.offsetY);
  // The shared geometry contract measures offsets from the artwork's top left.
  sprite.body.setOffset(Number.isFinite(ox) ? ox : 0, Number.isFinite(oy) ? oy : 0);
  sprite._mapObjectId = row.id;
  // movingPlatforms.js offsets moving platforms from this rest position and
  // carries riders itself, so Arcade must not also drag them by friction.
  sprite._mapMotion = row.motion || null;
  sprite._mapBase = { x: row.x, y: row.y };
  sprite.body.friction.set(row.motion ? 0 : 1, 0);
  sprite.setDepth(Number(row.depth) || 0);
  sprite.setAlpha(row.alpha ?? 1);
  sprite.setFlipY(!!row.flipY);
  for (const side of ['up','down','left','right']) sprite.body.checkCollision[side] = row.collision?.[side] !== false;
  if (row.collisionEnabled === false) sprite.body.enable = false;
  sprite.body.updateFromGameObject();
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
  zone._mapObjectId = row.id;
  zone.body.enable = row.collisionEnabled !== false;
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
