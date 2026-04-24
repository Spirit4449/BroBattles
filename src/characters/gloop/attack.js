import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const NAME = "gloop";
const SLIMEBALL = getResolvedCharacterAttackConfig(NAME, "slimeball");
const WORLD_MIN_X = -400;
const WORLD_MAX_X = 4000;

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
      x: originX + Math.cos(angle) * width * (Number(SLIMEBALL.forwardOffset) || 0.32),
      y: originY - height * (Number(SLIMEBALL.verticalOffset) || 0.1),
    };
  }

  const width = ownerSprite?.displayWidth || ownerSprite?.width || 80;
  const height = ownerSprite?.displayHeight || ownerSprite?.height || 100;
  return {
    x: (ownerSprite?.x || 0) + Math.cos(angle) * width * (Number(SLIMEBALL.forwardOffset) || 0.32),
    y: (ownerSprite?.y || 0) - height * (Number(SLIMEBALL.verticalOffset) || 0.1),
  };
}

function createSlimeballSprite(scene, x, y, scale) {
  const key = scene?.textures?.exists(`${NAME}-slimeball`)
    ? `${NAME}-slimeball`
    : scene?.textures?.exists("wizard-fireball")
      ? "wizard-fireball"
      : null;
  const sprite = key
    ? scene.add.sprite(x, y, key)
    : scene.add.circle(x, y, 18, 0x55c7ff, 0.95);
  sprite.setDepth(RENDER_LAYERS.ATTACKS + 6);
  if (sprite.setScale) sprite.setScale(Math.max(0.05, Number(scale) || 0.24));
  if (sprite.setTint) sprite.setTint(0x7de7ff);
  if (sprite.setBlendMode) sprite.setBlendMode(Phaser.BlendModes.NORMAL);
  return sprite;
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

export function spawnGloopSlimeballVisual(scene, payload = {}, ownerSprite = null) {
  if (!scene?.events || !scene?.add) return null;

  const direction = Number(payload.direction) === -1 ? -1 : 1;
  const angle = direction < 0 ? Math.PI : 0;
  const start = resolveStart(payload, ownerSprite, angle);
  const radius = Math.max(
    1,
    Number(payload.collisionRadius) || Number(SLIMEBALL.collisionRadius) || 28,
  );
  const sprite = createSlimeballSprite(
    scene,
    start.x,
    start.y,
    Number(payload.scale) || Number(SLIMEBALL.visualScale) || 0.24,
  );
  const debug = createDebugCircle(scene, radius);
  const glow = scene.add.circle(start.x, start.y, radius * 1.65, 0x55c7ff, 0.18);
  glow.setDepth(RENDER_LAYERS.ATTACKS + 1);
  glow.setBlendMode(Phaser.BlendModes.ADD);

  const cfg = {
    speed: Math.max(1, Number(payload.speed) || Number(SLIMEBALL.speed) || 390),
    range: Math.max(1, Number(payload.range) || Number(SLIMEBALL.range) || 930),
    gravity: Math.max(0, Number(payload.gravity) || Number(SLIMEBALL.gravity) || 380),
    initialVy: Number.isFinite(Number(payload.initialVy))
      ? Number(payload.initialVy)
      : Number(SLIMEBALL.initialVy) || -70,
    maxBounces: Math.max(0, Number(payload.maxBounces) || Number(SLIMEBALL.maxBounces) || 2),
    bounceDampingY: Math.max(0.1, Number(payload.bounceDampingY) || Number(SLIMEBALL.bounceDampingY) || 0.74),
    bounceDampingX: Math.max(0.1, Number(payload.bounceDampingX) || Number(SLIMEBALL.bounceDampingX) || 0.92),
    floorY: Math.min(
      Number(payload.floorY) || start.y + (Number(SLIMEBALL.bounceFloorOffsetY) || 185),
      Number(scene?.physics?.world?.bounds?.height) || 1000,
    ),
    maxLifetimeMs: Math.max(250, Number(payload.maxLifetimeMs) || Number(SLIMEBALL.maxLifetimeMs) || 4200),
    trailIntervalMs: Math.max(18, Number(SLIMEBALL.trailIntervalMs) || 42),
    worldMinX: Number(payload.worldMinX) || WORLD_MIN_X,
    worldMaxX: Number(payload.worldMaxX) || WORLD_MAX_X,
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
    if (withSplat) spawnSlimeSplat(scene, sprite.x, sprite.y);
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
    sprite.x += vx * dt;
    sprite.y += vy * dt;
    traveled += Math.abs(sprite.x - prevX);
    sprite.rotation += direction * dt * 5.2;

    if (sprite.y + radius >= cfg.floorY && vy > 0) {
      bounces += 1;
      if (bounces > cfg.maxBounces) {
        cleanup(true);
        return;
      }
      sprite.y = cfg.floorY - radius;
      vy = -Math.abs(vy) * cfg.bounceDampingY;
      vx *= cfg.bounceDampingX;
      spawnSlimeSplat(scene, sprite.x, cfg.floorY);
    }

    if (sprite.x - radius <= cfg.worldMinX || sprite.x + radius >= cfg.worldMaxX) {
      cleanup(true);
      return;
    }

    if (elapsed >= nextTrailAt) {
      nextTrailAt = elapsed + cfg.trailIntervalMs;
      spawnSlimeParticle(scene, sprite.x - Math.sign(vx || direction) * 7, sprite.y);
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
  const direction = Number(context?.direction) === -1 ? -1 : 1;
  const attackId = createRuntimeId("gloopSlimeball");
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
    initialVy: Number(SLIMEBALL.initialVy) || -70,
    maxBounces: Number(SLIMEBALL.maxBounces) || 2,
    bounceDampingY: Number(SLIMEBALL.bounceDampingY) || 0.74,
    bounceDampingX: Number(SLIMEBALL.bounceDampingX) || 0.92,
    maxLifetimeMs: Number(SLIMEBALL.maxLifetimeMs) || 4200,
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
