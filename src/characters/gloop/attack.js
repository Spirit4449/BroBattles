import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const NAME = "gloop";
const SLIMEBALL = getResolvedCharacterAttackConfig(NAME, "slimeball");
const SLIMEBALL_ATTACK_TEXTURE = `${NAME}-slimeball-attack`;
const SLIMEBALL_ATTACK_ANIM = `${NAME}-slimeball-attack-loop`;
const WORLD_MIN_X = -400;
const WORLD_MAX_X = 4000;

function resolveWorldBounds(scene) {
  const bounds = scene?.physics?.world?.bounds;
  const rawX = Number(bounds?.x);
  const rawY = Number(bounds?.y);
  const rawW = Number(bounds?.width);
  const rawH = Number(bounds?.height);
  const minX = Number.isFinite(rawX) ? rawX : WORLD_MIN_X;
  const minY = Number.isFinite(rawY) ? rawY : 0;
  const maxX = Number.isFinite(rawW) ? minX + rawW : WORLD_MAX_X;
  const maxY = Number.isFinite(rawH) ? minY + rawH : 1000;
  return { minX, maxX, minY, maxY };
}

let DEBUG_DRAW = false;
const ACTIVE_DEBUG_SHAPES = new Set();

function registerDebugShape(shape) {
  if (!shape) return null;
  ACTIVE_DEBUG_SHAPES.add(shape);
  shape.setVisible(DEBUG_DRAW);
  shape.once("destroy", () => {
    ACTIVE_DEBUG_SHAPES.delete(shape);
  });
  return shape;
}

function createDebugCircle(scene, radius) {
  if (!scene?.add) return null;
  const circle = scene.add.circle(0, 0, radius, 0x55c7ff, 0.08);
  circle.setStrokeStyle(1, 0xb8f3ff, 0.8);
  circle.setDepth(RENDER_LAYERS.ATTACKS + 20);
  return registerDebugShape(circle);
}

function playAttackAnimation(scene, sprite) {
  if (!scene?.anims || !sprite?.anims) return;
  try {
    if (scene.anims.exists(`${NAME}-throw`)) {
      sprite.anims.play(`${NAME}-throw`, true);
    } else if (scene.anims.exists(`${NAME}-special`)) {
      sprite.anims.play(`${NAME}-special`, true);
    }
  } catch (_) {}
}

function playSound(scene, key, options = {}) {
  try {
    if (scene?.cache?.audio?.exists?.(key) || scene?.sound?.get?.(key)) {
      scene.sound?.play?.(key, options);
      return true;
    }
  } catch (_) {}
  return false;
}

function getMapCollisionRects(scene, fallbackRects = null) {
  const source =
    Array.isArray(fallbackRects) && fallbackRects.length
      ? fallbackRects
      : Array.isArray(scene?._mapObjects)
        ? scene._mapObjects
        : [];
  const rects = [];
  for (const obj of source) {
    const body = obj?.body;
    if (!body || body.enable === false) continue;
    const left = Number(body.left);
    const right = Number(body.right);
    const top = Number(body.top);
    const bottom = Number(body.bottom);
    if (![left, right, top, bottom].every(Number.isFinite)) continue;
    rects.push({ left, right, top, bottom });
  }
  return rects;
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

function isFiniteRect(rect) {
  const left = Number(rect?.left);
  const right = Number(rect?.right);
  const top = Number(rect?.top);
  const bottom = Number(rect?.bottom);
  if (![left, right, top, bottom].every(Number.isFinite)) return null;
  return { left, right, top, bottom };
}

function isHorizontalPlatform(rect) {
  const parsed = isFiniteRect(rect);
  if (!parsed) return false;
  return parsed.right - parsed.left >= parsed.bottom - parsed.top;
}

function hasTopPlatformContact(prevX, prevY, nextX, nextY, rect, radius = 0) {
  const parsed = isFiniteRect(rect);
  if (!parsed) return false;
  const crossedTop =
    prevY + radius <= parsed.top && nextY + radius >= parsed.top;
  if (!crossedTop) return false;
  const minX = Math.min(prevX, nextX);
  const maxX = Math.max(prevX, nextX);
  return !(maxX + radius < parsed.left || minX - radius > parsed.right);
}

function hasWallCenterContact(prevX, nextX, y, rect, vx = 0, radius = 0) {
  const parsed = isFiniteRect(rect);
  if (!parsed) return false;
  const width = parsed.right - parsed.left;
  const height = parsed.bottom - parsed.top;
  if (height < width) return false;
  const centerX = (parsed.left + parsed.right) / 2;
  const yOverlap = y + radius >= parsed.top && y - radius <= parsed.bottom;
  if (!yOverlap) return false;
  if (vx >= 0) return prevX <= centerX && nextX >= centerX;
  return prevX >= centerX && nextX <= centerX;
}

function resolveStart(payload = {}, ownerSprite = null, angle = 0) {
  const startX = Number(payload?.start?.x);
  const startY = Number(payload?.start?.y);
  if (Number.isFinite(startX) && Number.isFinite(startY)) {
    return { x: startX, y: startY };
  }

  const originX = Number(payload?.origin?.x);
  const originY = Number(payload?.origin?.y);
  if (Number.isFinite(originX) && Number.isFinite(originY)) {
    const width = ownerSprite?.displayWidth || ownerSprite?.width || 80;
    const height = ownerSprite?.displayHeight || ownerSprite?.height || 100;
    return {
      x:
        originX +
        Math.cos(angle) * width * (Number(SLIMEBALL.forwardOffset) || 0.32),
      y: originY - height * (Number(SLIMEBALL.verticalOffset) || 0.1),
    };
  }

  const width = ownerSprite?.displayWidth || ownerSprite?.width || 80;
  const height = ownerSprite?.displayHeight || ownerSprite?.height || 100;
  return {
    x:
      (ownerSprite?.x || 0) +
      Math.cos(angle) * width * (Number(SLIMEBALL.forwardOffset) || 0.32),
    y:
      (ownerSprite?.y || 0) -
      height * (Number(SLIMEBALL.verticalOffset) || 0.1),
  };
}

function createSlimeballSprite(scene, x, y, radius, visualScale = 1) {
  const attackFrames = ensureSlimeballAttackAnimation(scene);
  const key = scene?.textures?.exists(SLIMEBALL_ATTACK_TEXTURE)
    ? SLIMEBALL_ATTACK_TEXTURE
    : scene?.textures?.exists(`${NAME}-slimeball`)
      ? `${NAME}-slimeball`
      : null;
  const firstFrame = attackFrames?.[0] || undefined;
  const sprite = key
    ? scene.add.sprite(x, y, key, firstFrame)
    : scene.add.circle(x, y, 18, 0x55c7ff, 0.95);
  sprite.setDepth(RENDER_LAYERS.ATTACKS + 6);
  if (sprite.setScale) {
    const baseW = Math.max(1, Number(sprite.width) || Number(radius * 2) || 1);
    const baseH = Math.max(1, Number(sprite.height) || Number(radius * 2) || 1);
    const desiredDiameter = Math.max(2, Number(radius) * 2);
    const fitScale = desiredDiameter / Math.max(baseW, baseH);
    const scaleMult = Math.max(0.1, Number(visualScale) || 1);
    sprite.setScale(fitScale * scaleMult);
  }
  if (sprite.setTint) sprite.setTint(0x7de7ff);
  if (sprite.setBlendMode) sprite.setBlendMode(Phaser.BlendModes.NORMAL);
  if (
    key === SLIMEBALL_ATTACK_TEXTURE &&
    attackFrames?.length &&
    scene?.anims?.exists(SLIMEBALL_ATTACK_ANIM) &&
    sprite?.anims
  ) {
    try {
      sprite.anims.play(SLIMEBALL_ATTACK_ANIM, true);
    } catch (_) {}
  }
  return sprite;
}

function ensureSlimeballAttackAnimation(scene) {
  if (!scene?.textures?.exists(SLIMEBALL_ATTACK_TEXTURE)) return null;
  const texture = scene.textures.get(SLIMEBALL_ATTACK_TEXTURE);
  const frameNames = texture?.getFrameNames?.() || [];
  if (!frameNames.length) return null;
  const orderedFrames = [...frameNames].sort((a, b) => {
    const ra = /([0-9]+)(?!.*[0-9])/.exec(String(a));
    const rb = /([0-9]+)(?!.*[0-9])/.exec(String(b));
    if (ra && rb) return Number(ra[1]) - Number(rb[1]);
    return String(a).localeCompare(String(b));
  });
  if (!scene.anims?.exists(SLIMEBALL_ATTACK_ANIM)) {
    scene.anims.create({
      key: SLIMEBALL_ATTACK_ANIM,
      frames: orderedFrames.map((frame) => ({
        key: SLIMEBALL_ATTACK_TEXTURE,
        frame,
      })),
      frameRate: 10,
      repeat: -1,
    });
  }
  return orderedFrames;
}

function spawnSlimeParticle(scene, x, y, size = null) {
  if (!scene?.add) return;
  const radius = size || Phaser.Math.FloatBetween(3.2, 6.4);
  const drop = scene.add.circle(
    x + Phaser.Math.Between(-6, 6),
    y + Phaser.Math.Between(-6, 6),
    radius,
    Phaser.Math.RND.pick([0x55c7ff, 0x72f0ff, 0x2d9cff]),
    0.74,
  );
  drop.setDepth(RENDER_LAYERS.ATTACKS + 2);
  drop.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: drop,
    alpha: 0,
    scaleX: Phaser.Math.FloatBetween(0.25, 0.55),
    scaleY: Phaser.Math.FloatBetween(0.25, 0.55),
    y: drop.y - Phaser.Math.Between(6, 18),
    duration: Phaser.Math.Between(220, 360),
    ease: "Quad.easeOut",
    onComplete: () => drop.destroy(),
  });
}

function spawnSlimeSplat(scene, x, y) {
  if (!scene?.add) return;
  const splat = scene.add.circle(x, y, 18, 0x55c7ff, 0.24);
  splat.setDepth(RENDER_LAYERS.ATTACKS + 1);
  splat.setBlendMode(Phaser.BlendModes.ADD);
  splat.setScale(1, 0.35);
  scene.tweens.add({
    targets: splat,
    alpha: 0,
    scaleX: 1.9,
    scaleY: 0.52,
    duration: 260,
    ease: "Sine.easeOut",
    onComplete: () => splat.destroy(),
  });
  for (let i = 0; i < 7; i += 1) {
    spawnSlimeParticle(scene, x, y - 4, Phaser.Math.FloatBetween(2.4, 4.2));
  }
}

export function spawnGloopSlimeballVisual(
  scene,
  payload = {},
  ownerSprite = null,
) {
  if (!scene?.events || !scene?.add) return null;

  const direction = Number(payload.direction) === -1 ? -1 : 1;
  const angle = direction < 0 ? Math.PI : 0;
  const start = resolveStart(payload, ownerSprite, angle);
  const radius = Math.max(
    1,
    Number(payload.collisionRadius) || Number(SLIMEBALL.collisionRadius) || 28,
  );
  const mapCollisionRects = getMapCollisionRects(
    scene,
    payload.mapCollisionRects,
  );
  const worldBounds = resolveWorldBounds(scene);
  const sprite = createSlimeballSprite(
    scene,
    start.x,
    start.y,
    radius,
    Number(payload.scale) || Number(SLIMEBALL.visualScale) || 1,
  );
  const debug = createDebugCircle(scene, radius);
  const glow = scene.add.circle(
    start.x,
    start.y,
    radius * 1.65,
    0x55c7ff,
    0.18,
  );
  glow.setDepth(RENDER_LAYERS.ATTACKS + 1);
  glow.setBlendMode(Phaser.BlendModes.ADD);

  const cfg = {
    speed: Math.max(1, Number(payload.speed) || Number(SLIMEBALL.speed) || 390),
    range: Math.max(1, Number(payload.range) || Number(SLIMEBALL.range) || 930),
    gravity: Math.max(
      0,
      Number(payload.gravity) || Number(SLIMEBALL.gravity) || 380,
    ),
    airDrag: Math.max(
      0,
      Number(payload.airDrag) || Number(SLIMEBALL.airDrag) || 0,
    ),
    initialVy: Number.isFinite(Number(payload.initialVy))
      ? Number(payload.initialVy)
      : Number(SLIMEBALL.initialVy) || -70,
    maxBounces: Math.max(
      0,
      Number(payload.maxBounces) || Number(SLIMEBALL.maxBounces) || 2,
    ),
    bounceDampingY: Math.max(
      0.1,
      Number(payload.bounceDampingY) ||
        Number(SLIMEBALL.bounceDampingY) ||
        0.74,
    ),
    bounceDampingX: Math.max(
      0.1,
      Number(payload.bounceDampingX) ||
        Number(SLIMEBALL.bounceDampingX) ||
        0.92,
    ),
    minBounceSpeed: Math.max(
      0,
      Number(payload.minBounceSpeed) || Number(SLIMEBALL.minBounceSpeed) || 0,
    ),
    floorY: Math.min(
      Number(payload.floorY) || Number(worldBounds.maxY) || 1000,
      Number(worldBounds.maxY) || 1000,
    ),
    maxLifetimeMs: Math.max(
      250,
      Number(payload.maxLifetimeMs) || Number(SLIMEBALL.maxLifetimeMs) || 4200,
    ),
    trailIntervalMs: Math.max(18, Number(SLIMEBALL.trailIntervalMs) || 42),
    worldMinX: Number.isFinite(Number(payload.worldMinX))
      ? Number(payload.worldMinX)
      : Number(worldBounds.minX) || WORLD_MIN_X,
    worldMaxX: Number.isFinite(Number(payload.worldMaxX))
      ? Number(payload.worldMaxX)
      : Number(worldBounds.maxX) || WORLD_MAX_X,
    mapCollisionRects,
  };

  let vx = direction * cfg.speed;
  let vy = cfg.initialVy;
  let traveled = 0;
  let elapsed = 0;
  let bounces = 0;
  let nextTrailAt = 0;
  let disposed = false;

  const cleanup = (withSplat = false) => {
    if (disposed) return;
    disposed = true;
    scene.events.off("update", update);
    if (withSplat) {
      playSound(scene, "gloop-hit", { volume: 0.5 });
      spawnSlimeSplat(scene, sprite.x, sprite.y);
    }
    try {
      sprite.destroy();
      glow.destroy();
      debug?.destroy?.();
    } catch (_) {}
  };

  const update = (_, delta = 16) => {
    if (!sprite?.active) {
      cleanup(false);
      return;
    }
    const dt = Math.max(0.001, Number(delta) / 1000);
    elapsed += Number(delta) || 16;
    const prevX = sprite.x;
    const prevY = sprite.y;
    vy += cfg.gravity * dt;
    if (cfg.airDrag > 0 && vx !== 0) {
      const dragFactor = Math.max(0, 1 - cfg.airDrag * dt);
      vx *= dragFactor;
    }
    sprite.x += vx * dt;
    sprite.y += vy * dt;
    traveled += Math.hypot(sprite.x - prevX, sprite.y - prevY);
    // sprite.rotation += direction * dt * 5.2;

    const collisionRects =
      Array.isArray(cfg.mapCollisionRects) && cfg.mapCollisionRects.length
        ? cfg.mapCollisionRects
        : getMapCollisionRects(scene);
    for (const rect of collisionRects) {
      if (
        !sweptCircleOverlapsRect(prevX, prevY, sprite.x, sprite.y, rect, radius)
      ) {
        continue;
      }
      if (
        vy > 0 &&
        isHorizontalPlatform(rect) &&
        hasTopPlatformContact(prevX, prevY, sprite.x, sprite.y, rect, radius)
      ) {
        const platformTop = Number(rect?.top);
        bounces += 1;
        if (bounces > cfg.maxBounces) {
          cleanup(true);
          return;
        }
        sprite.y = platformTop - radius;
        const bounceVy = Math.abs(vy) * cfg.bounceDampingY;
        if (bounceVy < cfg.minBounceSpeed) {
          cleanup(true);
          return;
        }
        vy = -bounceVy;
        vx *= cfg.bounceDampingX;
        spawnSlimeSplat(scene, sprite.x, platformTop);
        break;
      }
      if (hasWallCenterContact(prevX, sprite.x, sprite.y, rect, vx, radius)) {
        cleanup(true);
        return;
      }
    }

    if (sprite.y + radius >= cfg.floorY && vy > 0) {
      bounces += 1;
      if (bounces > cfg.maxBounces) {
        cleanup(true);
        return;
      }
      sprite.y = cfg.floorY - radius;
      const bounceVy = Math.abs(vy) * cfg.bounceDampingY;
      if (bounceVy < cfg.minBounceSpeed) {
        cleanup(true);
        return;
      }
      vy = -bounceVy;
      vx *= cfg.bounceDampingX;
      spawnSlimeSplat(scene, sprite.x, cfg.floorY);
    }

    if (
      sprite.x - radius <= cfg.worldMinX ||
      sprite.x + radius >= cfg.worldMaxX
    ) {
      cleanup(true);
      return;
    }

    if (elapsed >= nextTrailAt) {
      nextTrailAt = elapsed + cfg.trailIntervalMs;
      spawnSlimeParticle(
        scene,
        sprite.x - Math.sign(vx || direction) * 7,
        sprite.y,
      );
    }

    if (glow?.active) {
      glow.x = sprite.x;
      glow.y = sprite.y;
      glow.alpha = 0.13 + 0.06 * Math.sin(elapsed / 90);
    }
    if (debug?.active) {
      debug.x = sprite.x;
      debug.y = sprite.y;
    }

    if (traveled >= cfg.range || elapsed >= cfg.maxLifetimeMs) {
      cleanup(true);
    }
  };

  scene.events.on("update", update);
  sprite.once("destroy", () => cleanup(false));
  return sprite;
}

export function performGloopSlimeball(instance, attackContext = null) {
  const { scene, player: p } = instance;
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const slowDurationMs = Math.max(1, Number(SLIMEBALL.slowDurationMs) || 2000);
  const slowSpeedMult = Math.max(0.1, Number(SLIMEBALL.slowSpeedMult) || 0.7);
  const slowJumpMult = Math.max(0.1, Number(SLIMEBALL.slowJumpMult) || 0.7);
  const direction = Number(context?.direction) === -1 ? -1 : 1;
  const attackId = createRuntimeId("gloopSlimeball");
  const worldBounds = resolveWorldBounds(scene);
  const unlockFlip = lockPlayerFlip(p);

  p.flipX = direction < 0;
  playAttackAnimation(scene, p);
  playSound(scene, "gloop-attack", { volume: 0.58 });
  scene.time.delayedCall(Number(SLIMEBALL.flipLockMs) || 520, () => {
    try {
      unlockFlip();
    } catch (_) {}
  });

  return {
    type: `${NAME}-slimeball`,
    id: attackId,
    direction,
    angle: direction < 0 ? Math.PI : 0,
    speed: Number(SLIMEBALL.speed) || 390,
    range: Number(SLIMEBALL.range) || 930,
    startup: Number(SLIMEBALL.castDelayMs) || 300,
    collisionRadius: Number(SLIMEBALL.collisionRadius) || 28,
    scale: Number(SLIMEBALL.visualScale) || 0.24,
    gravity: Number(SLIMEBALL.gravity) || 380,
    airDrag: Number(SLIMEBALL.airDrag) || 0,
    initialVy: Number(SLIMEBALL.initialVy) || -70,
    maxBounces: Number(SLIMEBALL.maxBounces) || 2,
    bounceDampingY: Number(SLIMEBALL.bounceDampingY) || 0.74,
    bounceDampingX: Number(SLIMEBALL.bounceDampingX) || 0.92,
    minBounceSpeed: Number(SLIMEBALL.minBounceSpeed) || 0,
    maxLifetimeMs: Number(SLIMEBALL.maxLifetimeMs) || 4200,
    floorY:
      Number(worldBounds.maxY) || Number(SLIMEBALL.bounceFloorOffsetY) || 1000,
    worldMinX: Number(worldBounds.minX) || WORLD_MIN_X,
    worldMaxX: Number(worldBounds.maxX) || WORLD_MAX_X,
    mapCollisionRects: getMapCollisionRects(scene),
    slowDurationMs,
    slowSpeedMult,
    slowJumpMult,
    damage: Math.max(
      1,
      Math.round(instance.constructor?.getStats?.()?.baseDamage || 0),
    ),
  };
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
  for (const shape of ACTIVE_DEBUG_SHAPES) {
    if (shape?.active) shape.setVisible(DEBUG_DRAW);
  }
}
