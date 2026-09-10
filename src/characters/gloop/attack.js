import { advanceSlimeball, slimeLaunch } from "../../shared/gloopProjectile";
import { createSlimeVisual } from "./slimeVisual";
import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";
import { playSpriteAnimation } from "../shared/animationState";

const NAME = "gloop";
const SLIMEBALL = getResolvedCharacterAttackConfig(NAME, "slimeball");
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
  playSpriteAnimation({
    scene,
    sprite,
    character: NAME,
    logical: "throw",
    fallback: "special",
  });
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
    const body = obj?.body || obj;
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

export function handleGloopSlimeSplat(scene, payload) {
  scene._gloopSplats ||= new Map();
  scene._gloopSplats.set(payload.id, { ...payload, at: Date.now() });
  for (const [id, hit] of scene._gloopSplats) if (Date.now() - hit.at > 5000) scene._gloopSplats.delete(id);
  scene.events.emit("gloop-slimeball-splat", payload);
}

export function spawnGloopSlimeballVisual(
  scene,
  payload = {},
  ownerSprite = null,
) {
  if (!scene?.events || !scene?.add) return null;

  const direction = Number(payload.direction) === -1 ? -1 : 1;
  const angle = Number.isFinite(payload.angle) ? payload.angle : direction < 0 ? Math.PI : 0;
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

  const state = { ...cfg, x: start.x, y: start.y, vx: Math.cos(angle) * cfg.speed,
    vy: cfg.initialVy, collisionRadius: radius, elapsed: 0, traveled: 0, bounceCount: 0 };
  const visual = createSlimeVisual(scene, state,
    Number(payload.scale) || Number(SLIMEBALL.visualScale) || 1.5);
  const debug = createDebugCircle(scene, radius);
  let disposed = false;
  let ended = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    scene.events.off("update", update);
    scene.events.off("gloop-slimeball-splat", splat);
    scene.events.off("presentation:reset", cleanup);
    scene.events.off("shutdown", cleanup);
    visual.destroy();
    debug?.destroy?.();
  };
  const splat = (hit) => {
    if (hit.id !== payload.id || ended || disposed) return;
    ended = true;
    // The slow-effect renderer draws residue in the victim's current frame.
    // A terrain impact here would leave a stationary puddle in midair.
    visual.finish({ onCharacter: true });
    debug?.setVisible(false);
  };
  const update = (_, delta = 16) => {
    if (disposed) return;
    if (!ended) {
      const impacts = advanceSlimeball(state, delta, cfg.mapCollisionRects);
      for (const hit of impacts) {
        visual.impact(hit);
        playSound(scene, "gloop-hit", { volume: hit.terminal ? 0.48 : 0.3,
          rate: state.bounceCount > 1 ? 0.85 : 1.05 });
      }
      if (state.done) { ended = true; visual.finish(); debug?.setVisible(false); }
      if (debug?.active) { debug.x = state.x; debug.y = state.y; }
    }
    if (!visual.update(delta) && ended) cleanup();
  };
  scene.events.on("gloop-slimeball-splat", splat);
  const pendingSplat = scene._gloopSplats?.get(payload.id);
  if (pendingSplat) splat(pendingSplat);
  scene.events.on("update", update);
  scene.events.once("presentation:reset", cleanup);
  scene.events.once("shutdown", cleanup);
  visual.body.once("destroy", cleanup);
  visual.update(0);
  return visual.body;
}

export function performGloopSlimeball(instance, attackContext = null) {
  const { scene, player: p } = instance;
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const slowDurationMs = Math.max(1, Number(SLIMEBALL.slowDurationMs) || 2000);
  const slowSpeedMult = Math.max(0.1, Number(SLIMEBALL.slowSpeedMult) || 0.7);
  const slowJumpMult = Math.max(0.1, Number(SLIMEBALL.slowJumpMult) || 0.7);
  const direction = Number(context?.direction) === -1 ? -1 : 1;
  const target = context.target || { x: context.targetX ?? p.x + direction * 320, y: context.targetY ?? p.y + 40 };
  const previewLaunch = context.physicsVersion === 2 && context.start &&
    [context.start.x, context.start.y, context.angle, context.speed, context.initialVy].every(Number.isFinite);
  const launch = previewLaunch ? {
    start: { ...context.start }, angle: context.angle, speed: context.speed,
    initialVy: context.initialVy, direction: context.direction, target: { ...target }, physicsVersion: 2,
  } : slimeLaunch({ x: p.x, y: p.y, width: p.displayWidth || p.width,
    height: p.displayHeight || p.height }, target, SLIMEBALL);
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
    ...launch,
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
