import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import socket from "../../socket.js";
import { createRuntimeId } from "../shared/runtimeId.js";
import { lockPlayerFlip } from "../shared/flipLock.js";
import { emitVaultHitForCircle } from "../shared/vaultTargeting.js";
import { RENDER_LAYERS } from "../../gameScene/renderLayers.js";

const NAME = "huntress";
const ARROWS = getResolvedCharacterAttackConfig(NAME, "arrowSpread");
const DEFAULT_GRAVITY = 1100;
const DEFAULT_MAX_LIFETIME_MS = 2600;
const DEFAULT_SPECIAL_RELEASE_MS = 0;

let DEBUG_DRAW = false;
const ACTIVE_DEBUG_SHAPES = new Set();

function degToRad(degrees) {
  return (Number(degrees) || 0) * (Math.PI / 180);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function resolveAimBallistics(angle, speed, range) {
  const upFactor = clamp(-Math.sin(Number(angle) || 0), 0, 1);
  const speedScale = 1 - upFactor * 0.32;
  const rangeScale = 1 + upFactor * 0.45;
  return {
    speed: Math.max(1, Number(speed) * speedScale),
    range: Math.max(120, Number(range) * rangeScale),
    upFactor,
  };
}

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
  const circle = scene.add.circle(0, 0, radius, 0xfff2a6, 0.08);
  circle.setStrokeStyle(1, 0xfff2a6, 0.75);
  circle.setDepth(RENDER_LAYERS.ATTACKS + 20);
  return registerDebugShape(circle);
}

function playAttackAnimation(scene, sprite, special = false) {
  if (!scene?.anims || !sprite?.anims) return;
  const preferred = special ? `${NAME}-special` : `${NAME}-throw`;
  const fallback = `${NAME}-throw`;
  try {
    if (scene.anims.exists(preferred)) sprite.anims.play(preferred, true);
    else if (scene.anims.exists(fallback)) sprite.anims.play(fallback, true);
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

function resolveStart(payload, ownerSprite, angle, defaults = ARROWS) {
  const startX = Number(payload?.start?.x);
  const startY = Number(payload?.start?.y);
  if (Number.isFinite(startX) && Number.isFinite(startY)) {
    return { x: startX, y: startY };
  }

  const originX = Number(payload?.origin?.x);
  const originY = Number(payload?.origin?.y);
  if (Number.isFinite(originX) && Number.isFinite(originY)) {
    return { x: originX, y: originY };
  }

  const width = ownerSprite?.displayWidth || ownerSprite?.width || 80;
  const height = ownerSprite?.displayHeight || ownerSprite?.height || 120;
  return {
    x:
      (ownerSprite?.x || 0) +
      Math.cos(angle) * width * (Number(defaults.forwardOffset) || 0.28),
    y:
      (ownerSprite?.y || 0) -
      height * (Number(defaults.verticalOffset) || 0.12) +
      Math.sin(angle) * width * (Number(defaults.forwardOffset) || 0.28),
  };
}

function buildSpreadProjectiles({
  baseInstanceId = "",
  angle,
  count,
  spreadDeg,
  speed,
  range,
  collisionRadius,
  damage,
  visualScale,
  burn = null,
  gravity = DEFAULT_GRAVITY,
  maxLifetimeMs = DEFAULT_MAX_LIFETIME_MS,
  embedMs = 2000,
}) {
  const total = Math.max(1, Number(count) || 1);
  const spread = degToRad(spreadDeg);
  const center = (total - 1) / 2;
  return Array.from({ length: total }, (_, index) => {
    const offset =
      total === 1 ? 0 : ((index - center) / Math.max(1, center)) * (spread / 2);
    return {
      id: `${String(baseInstanceId || "huntress")}:${index}`,
      index,
      angle: angle + offset,
      speed,
      range,
      collisionRadius,
      damage,
      scale: visualScale,
      burn,
      gravity,
      maxLifetimeMs,
      embedMs,
    };
  });
}

function createArrowSprite(scene, x, y, angle, scale, burning = false) {
  const textureKey = scene?.textures?.exists(`${NAME}-arrow`)
    ? `${NAME}-arrow`
    : scene?.textures?.exists("arrow")
      ? "arrow"
      : null;
  const arrow = textureKey
    ? scene.add.sprite(x, y, textureKey)
    : scene.add.rectangle(x, y, 44, 10, burning ? 0xff7a2f : 0xf8f0c0, 0.95);
  arrow.setDepth(RENDER_LAYERS.ATTACKS + 4);
  arrow.setRotation(angle);
  if (arrow.setScale) arrow.setScale(Math.max(0.05, Number(scale) || 0.22));
  if (burning && arrow.setTint) arrow.setTint(0xff8a2f);
  return arrow;
}

function spawnArrowTrail(scene, arrow, burning = false) {
  if (!burning || !scene?.add) return null;
  let nextAt = 0;
  const update = () => {
    if (!arrow?.active) return;
    const now = scene.time?.now || Date.now();
    if (now < nextAt) return;
    nextAt = now + 45;
    const spark = scene.add.circle(
      arrow.x + Phaser.Math.Between(-5, 5),
      arrow.y + Phaser.Math.Between(-5, 5),
      Phaser.Math.FloatBetween(2.2, 4.2),
      Phaser.Math.RND.pick([0xff5a1f, 0xffb020, 0xffe077]),
      0.78,
    );
    spark.setDepth(RENDER_LAYERS.ATTACKS + 2);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: spark,
      alpha: 0,
      scale: 0.35,
      y: spark.y - Phaser.Math.Between(8, 18),
      duration: 260,
      ease: "Quad.easeOut",
      onComplete: () => spark.destroy(),
    });
  };
  scene.events.on("update", update);
  return () => scene.events.off("update", update);
}

function spawnFireBurst(scene, x, y, count = 9) {
  if (!scene?.add) return;
  const total = Math.max(1, Number(count) || 1);
  for (let i = 0; i < total; i += 1) {
    const ember = scene.add.circle(
      x + Phaser.Math.Between(-8, 8),
      y + Phaser.Math.Between(-8, 8),
      Phaser.Math.FloatBetween(2, 4.8),
      Phaser.Math.RND.pick([0xff4a1a, 0xff8a1f, 0xffc54c, 0xfff0a1]),
      0.82,
    );
    ember.setDepth(RENDER_LAYERS.ATTACKS + 3);
    ember.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: ember,
      alpha: 0,
      x: ember.x + Phaser.Math.Between(-20, 20),
      y: ember.y + Phaser.Math.Between(-22, -6),
      scale: Phaser.Math.FloatBetween(0.25, 0.6),
      duration: Phaser.Math.Between(220, 380),
      ease: "Quad.easeOut",
      onComplete: () => ember.destroy(),
    });
  }
}

function spawnBurningTipFx(scene, arrow) {
  if (!scene?.add || !arrow?.active) return;
  const tipX = arrow.x + Math.cos(arrow.rotation || 0) * 16;
  const tipY = arrow.y + Math.sin(arrow.rotation || 0) * 16;
  spawnFireBurst(scene, tipX, tipY, 3);
}

function normalizeSpriteTargets(targetSprites = [], ownerSprite = null) {
  return (Array.isArray(targetSprites) ? targetSprites : [])
    .map((entry) => {
      const sprite = entry?.sprite || entry?.opponent || entry;
      const username =
        String(
          entry?.username ||
            entry?._username ||
            sprite?.username ||
            sprite?._username ||
            "",
        ).trim() || null;
      return sprite
        ? {
            sprite,
            username,
          }
        : null;
    })
    .filter(
      (entry) =>
        entry?.sprite && entry.sprite !== ownerSprite && entry.sprite.active,
    );
}

function getMapObjects(scene, explicitObjects = null) {
  const out = [];
  const seen = new Set();
  const add = (obj) => {
    if (!obj || seen.has(obj)) return;
    seen.add(obj);
    out.push(obj);
  };

  if (Array.isArray(explicitObjects) && explicitObjects.length) {
    for (const obj of explicitObjects) add(obj);
  } else if (Array.isArray(scene?._mapObjects)) {
    for (const obj of scene._mapObjects) add(obj);
  }

  // Include static collider game objects as a safety net so collision checks
  // cover map colliders even if they were not added to scene._mapObjects.
  const staticEntries = scene?.physics?.world?.staticBodies?.entries;
  if (Array.isArray(staticEntries)) {
    for (const body of staticEntries) {
      const gameObject = body?.gameObject;
      if (gameObject?.body) add(gameObject);
    }
  }

  return out;
}

export function spawnGroundBurn(scene, x, y, durationMs = 2200) {
  if (!scene?.add) return;
  const ring = scene.add.circle(x, y, 26, 0xff6a1a, 0.22);
  ring.setDepth(RENDER_LAYERS.ATTACKS + 1);
  ring.setBlendMode(Phaser.BlendModes.ADD);
  ring.setScale(0.7, 0.28);
  scene.tweens.add({
    targets: ring,
    alpha: 0,
    scaleX: 1.6,
    scaleY: 0.52,
    duration: durationMs,
    ease: "Sine.easeOut",
    onComplete: () => ring.destroy(),
  });
}

class HuntressArrow extends Phaser.Physics.Arcade.Image {
  constructor(
    scene,
    payload,
    projectile,
    ownerSprite = null,
    {
      mapObjects = null,
      targetSprites = null,
      isOwner = false,
      username = "",
      gameId = "",
    } = {},
  ) {
    const angle = Number.isFinite(Number(projectile?.angle))
      ? Number(projectile.angle)
      : Number(payload?.angle) || 0;
    const defaults = {
      forwardOffset: Number(ARROWS.forwardOffset) || 0.28,
      verticalOffset: Number(ARROWS.verticalOffset) || 0.12,
    };
    const start = resolveStart(payload, ownerSprite, angle, defaults);
    super(scene, start.x, start.y, `${NAME}-arrow`);

    this.scene = scene;
    this.ownerSprite = ownerSprite || null;
    this.cfg = {
      angle,
      speed: Math.max(
        1,
        Number(projectile?.speed) || Number(payload?.speed) || ARROWS.speed,
      ),
      collisionRadius: Math.max(
        1,
        Number(projectile?.collisionRadius) ||
          Number(payload?.collisionRadius) ||
          Number(ARROWS.collisionRadius) ||
          16,
      ),
      damage: Math.max(
        1,
        Number(projectile?.damage) ||
          Number(payload?.damage) ||
          Number(ARROWS.damagePerArrow) ||
          1,
      ),
      scale:
        Number(projectile?.scale) ||
        Number(payload?.scale) ||
        Number(ARROWS.visualScale) ||
        0.22,
      burn: projectile?.burn || payload?.burn || null,
      gravity: Math.max(
        0,
        Number(projectile?.gravity) ||
          Number(payload?.gravity) ||
          DEFAULT_GRAVITY,
      ),
      maxLifetimeMs: Math.max(
        200,
        Number(projectile?.maxLifetimeMs) ||
          Number(payload?.maxLifetimeMs) ||
          DEFAULT_MAX_LIFETIME_MS,
      ),
      embedMs: Math.max(
        120,
        Number(projectile?.embedMs) || Number(payload?.embedMs) || 2000,
      ),
      sinkPx: Math.max(
        0,
        Number(projectile?.sinkPx) ||
          Number(payload?.sinkPx) ||
          (projectile?.burn || payload?.burn ? 12 : 9),
      ),
      attackType:
        String(payload?.attackType || "").trim() ||
        (projectile?.burn || payload?.burn
          ? "huntress-burning-arrow"
          : "huntress-arrow"),
      instanceId:
        String(projectile?.id || payload?.id || "").trim() ||
        createRuntimeId("huntressArrow"),
      isOwner: isOwner === true,
      username: String(username || "").trim(),
      gameId: String(gameId || "").trim(),
    };
    this.createdAt = Number(scene?.time?.now) || 0;
    this.embedded = false;
    this._disposed = false;
    this._hitSomething = false;
    this.mapOverlaps = [];
    this.targetOverlaps = [];
    this.mapObjectsRef = getMapObjects(scene, mapObjects);
    this.lastX = this.x;
    this.lastY = this.y;
    this._nextTipFxAt = 0;
    this._submittedHit = false;
    this._vaultHitSubmitted = false;

    scene.add.existing(this);
    scene.physics.add.existing(this);
    this.setDepth(RENDER_LAYERS.ATTACKS + 4);
    this.setScale(this.cfg.scale);
    this.setRotation(angle);
    if (this.setTint && this.cfg.burn) this.setTint(0xff8a2f);
    this.body.allowGravity = false;
    this.body.setCircle(this.cfg.collisionRadius);
    this.body.setOffset(
      Math.max(0, ((this.width || 0) - this.cfg.collisionRadius * 2) / 2),
      Math.max(0, ((this.height || 0) - this.cfg.collisionRadius * 2) / 2),
    );

    this.vx = Math.cos(angle) * this.cfg.speed;
    this.vy = Math.sin(angle) * this.cfg.speed;
    this.cleanupTrail = spawnArrowTrail(scene, this, !!this.cfg.burn);
    this.debug = createDebugCircle(scene, this.cfg.collisionRadius);
    this.attachMapOverlap(this.mapObjectsRef);
    this.attachTargetOverlap(
      normalizeSpriteTargets(targetSprites, ownerSprite),
    );
    scene.events.on("update", this.updateArrow, this);
  }

  attachMapOverlap(objects = []) {
    if (!this.scene?.physics?.add?.overlap) return;
    for (const obj of objects) {
      if (!obj?.body || obj.body.enable === false || obj === this) continue;
      const overlap = this.scene.physics.add.overlap(this, obj, () => {
        if (!this.isPointInsideMapBody(obj.body, this.x, this.y)) return;
        this.embedAt(this.x, this.y, this.rotation, {
          groundBurn: !!this.cfg.burn,
          groundBurnMs: this.cfg.burn?.groundBurnMs,
        });
      });
      if (overlap) this.mapOverlaps.push(overlap);
    }
  }

  isPointInsideMapBody(body, x, y) {
    const left = Number(body?.left);
    const right = Number(body?.right);
    const top = Number(body?.top);
    const bottom = Number(body?.bottom);
    if (![left, right, top, bottom].every(Number.isFinite)) return false;
    return x >= left && x <= right && y >= top && y <= bottom;
  }

  findSweptMapCollisionPoint(prevX, prevY, nextX, nextY) {
    const objects = this.mapObjectsRef;
    if (!Array.isArray(objects) || !objects.length) return null;
    const dx = nextX - prevX;
    const dy = nextY - prevY;
    const distance = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(distance / 2));

    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      const x = prevX + dx * t;
      const y = prevY + dy * t;
      for (const obj of objects) {
        const body = obj?.body;
        if (!body || body.enable === false) continue;
        if (this.isPointInsideMapBody(body, x, y)) {
          return { x, y, body, object: obj };
        }
      }
    }
    return null;
  }

  attachTargetOverlap(entries = []) {
    if (!this.scene?.physics?.add?.overlap) return;
    for (const entry of entries) {
      const sprite = entry?.sprite;
      if (!sprite?.body || sprite.body.enable === false) continue;
      const overlap = this.scene.physics.add.overlap(this, sprite, () => {
        this.embedIntoTarget(entry);
      });
      if (overlap) this.targetOverlaps.push(overlap);
    }
  }

  emitHitForTarget(targetName) {
    if (this._submittedHit || !this.cfg.isOwner) return false;
    const attacker = String(this.cfg.username || "").trim();
    const target = String(targetName || "").trim();
    if (!attacker || !target) return false;
    this._submittedHit = true;
    try {
      socket.emit("hit", {
        attacker,
        target,
        damage: this.cfg.damage || 1,
        attackType: this.cfg.attackType || "huntress-arrow",
        instanceId: this.cfg.instanceId,
        attackTime: Date.now(),
        gameId: this.cfg.gameId || undefined,
      });
    } catch (_) {}
    return true;
  }

  tryDamageVault() {
    if (this._vaultHitSubmitted || !this.cfg.isOwner || this._submittedHit) {
      return false;
    }
    const attacker = String(this.cfg.username || "").trim();
    if (!attacker) return false;
    const hit = emitVaultHitForCircle({
      attacker,
      x: this.x,
      y: this.y,
      radius: Math.max(10, Number(this.cfg.collisionRadius) || 10),
      attackType: this.cfg.attackType || "huntress-arrow",
      instanceId: this.cfg.instanceId,
      gameId: this.cfg.gameId || undefined,
    });
    if (hit) {
      this._vaultHitSubmitted = true;
      this._submittedHit = true;
    }
    return !!hit;
  }

  embedIntoTarget(targetEntry) {
    const targetSprite = targetEntry?.sprite || targetEntry;
    if (!targetSprite?.active) {
      this.embedAt(this.x, this.y, this.rotation);
      return;
    }
    if (!this.isMeaningfulTargetHit(targetSprite)) {
      return;
    }
    const targetName =
      String(
        targetEntry?.username ||
          targetSprite?._username ||
          targetSprite?.username ||
          "",
      ).trim() || null;
    this.emitHitForTarget(targetName);
    this._hitSomething = true;
    this.cleanupTrail?.();
    this.targetSprite = targetSprite;
    const sink = Math.max(0, Number(this.cfg.sinkPx) || 0);
    const sinkX = Math.cos(this.rotation || 0) * sink;
    const sinkY = Math.sin(this.rotation || 0) * sink;
    this.x += sinkX;
    this.y += sinkY;
    this.embedOffsetX = this.x - targetSprite.x;
    this.embedOffsetY = this.y - targetSprite.y;
    this.embedRotation = this.rotation;
    this.freezeMotion();
    if (this.cfg.burn) {
      spawnFireBurst(this.scene, this.x, this.y - 6, 12);
      spawnFireBurst(this.scene, targetSprite.x, targetSprite.y - 20, 10);
    }
    const expire = () => this.destroyArrow();
    this.scene.time.delayedCall(this.cfg.embedMs, expire);
  }

  isMeaningfulTargetHit(targetSprite) {
    const body = targetSprite?.body;
    if (!body) return true;
    const left = Number(body.left);
    const right = Number(body.right);
    const top = Number(body.top);
    const bottom = Number(body.bottom);
    const width = Math.max(1, right - left);
    const height = Math.max(1, bottom - top);
    if (![left, right, top, bottom].every(Number.isFinite)) return true;

    const insetX = Math.min(10, width * 0.16);
    const insetY = Math.min(12, height * 0.14);
    const tightLeft = left + insetX;
    const tightRight = right - insetX;
    const tightTop = top + insetY;
    const tightBottom = bottom - insetY;

    const nearestX = Math.max(tightLeft, Math.min(this.x, tightRight));
    const nearestY = Math.max(tightTop, Math.min(this.y, tightBottom));
    const dist = Math.hypot(this.x - nearestX, this.y - nearestY);
    const allowed = Math.max(6, Number(this.cfg.collisionRadius) * 0.72);
    return dist <= allowed;
  }

  embedAt(x, y, rotation = this.rotation, options = {}) {
    this._hitSomething = true;
    this.cleanupTrail?.();
    this.freezeMotion();
    const sink = Math.max(0, Number(this.cfg.sinkPx) || 0);
    const sinkX = Math.cos(rotation || 0) * sink;
    const sinkY = Math.sin(rotation || 0) * sink;
    this.setPosition(x + sinkX, y + sinkY);
    this.setRotation(rotation);
    if (options.groundBurn) {
      spawnGroundBurn(
        this.scene,
        x,
        y,
        Math.max(250, Number(options.groundBurnMs) || 2200),
      );
      spawnFireBurst(this.scene, x, y - 4, 14);
    }
    this.scene.time.delayedCall(this.cfg.embedMs, () => this.destroyArrow());
  }

  freezeMotion() {
    this.embedded = true;
    this.vx = 0;
    this.vy = 0;
    if (this.body) {
      this.body.enable = false;
      this.body.stop();
    }
    this.mapOverlaps.forEach((entry) => {
      try {
        entry?.destroy?.();
      } catch (_) {}
    });
    this.targetOverlaps.forEach((entry) => {
      try {
        entry?.destroy?.();
      } catch (_) {}
    });
    this.mapOverlaps.length = 0;
    this.targetOverlaps.length = 0;
  }

  updateArrow(_, delta = 16) {
    if (!this.active || this._disposed) return;
    if (this.embedded) {
      if (this.targetSprite?.active) {
        this.x = this.targetSprite.x + (this.embedOffsetX || 0);
        this.y = this.targetSprite.y + (this.embedOffsetY || 0);
        this.rotation = this.embedRotation || this.rotation;
      }
      if (this.debug?.active) {
        this.debug.x = this.x;
        this.debug.y = this.y;
      }
      return;
    }

    const dtSec = Math.max(0.001, Number(delta) / 1000);
    const prevX = this.x;
    const prevY = this.y;
    this.vy += this.cfg.gravity * dtSec;
    const nextX = prevX + this.vx * dtSec;
    const nextY = prevY + this.vy * dtSec;
    const nextRotation = Math.atan2(this.vy, this.vx);
    const mapImpact = this.findSweptMapCollisionPoint(prevX, prevY, nextX, nextY);
    if (mapImpact) {
      this.embedAt(mapImpact.x, mapImpact.y, nextRotation, {
        groundBurn: !!this.cfg.burn,
        groundBurnMs: this.cfg.burn?.groundBurnMs,
      });
      return;
    }
    this.x = nextX;
    this.y = nextY;
    this.rotation = nextRotation;
    this.body?.updateFromGameObject?.();
    this.lastX = this.x;
    this.lastY = this.y;

    if (this.tryDamageVault()) {
      this.embedAt(this.x, this.y, this.rotation, {
        groundBurn: !!this.cfg.burn,
        groundBurnMs: this.cfg.burn?.groundBurnMs,
      });
      return;
    }

    if (this.cfg.burn) {
      const now = Number(this.scene?.time?.now) || 0;
      if (now >= this._nextTipFxAt) {
        this._nextTipFxAt = now + 55;
        spawnBurningTipFx(this.scene, this);
      }
    }

    if (this.debug?.active) {
      this.debug.x = this.x;
      this.debug.y = this.y;
    }

    const worldHeight =
      Number(this.scene?.physics?.world?.bounds?.height) ||
      Number(this.scene?.scale?.height) ||
      1000;
    if (this.y >= worldHeight - 4) {
      this.embedAt(this.x, Math.min(this.y, worldHeight), this.rotation, {
        groundBurn: !!this.cfg.burn,
        groundBurnMs: this.cfg.burn?.groundBurnMs,
      });
      return;
    }

    const elapsed = (Number(this.scene?.time?.now) || 0) - this.createdAt;
    if (elapsed >= this.cfg.maxLifetimeMs) {
      this.destroyArrow();
    }
  }

  destroyArrow() {
    if (this._disposed) return;
    this._disposed = true;
    this.cleanupTrail?.();
    this.scene?.events?.off("update", this.updateArrow, this);
    this.mapOverlaps.forEach((entry) => {
      try {
        entry?.destroy?.();
      } catch (_) {}
    });
    this.targetOverlaps.forEach((entry) => {
      try {
        entry?.destroy?.();
      } catch (_) {}
    });
    this.mapOverlaps.length = 0;
    this.targetOverlaps.length = 0;
    if (this.debug?.active) this.debug.destroy();
    this.destroy();
  }
}

function buildTargetSprites(context = {}) {
  const entries = [];
  for (const [username, wrapper] of Object.entries(
    context?.opponentPlayersRef || {},
  )) {
    if (wrapper?.opponent) {
      entries.push({ sprite: wrapper.opponent, username });
    }
  }
  for (const [username, wrapper] of Object.entries(
    context?.teamPlayersRef || {},
  )) {
    if (wrapper?.opponent) {
      entries.push({ sprite: wrapper.opponent, username });
    }
  }
  return entries;
}

function spawnArrowProjectile(
  scene,
  payload,
  projectile,
  ownerSprite = null,
  localContext = {},
) {
  if (!scene?.physics?.add) return null;
  return new HuntressArrow(scene, payload, projectile, ownerSprite, {
    mapObjects: localContext?.mapObjects || null,
    targetSprites: localContext?.targetSprites || null,
    isOwner: localContext?.isOwner === true,
    username: String(localContext?.username || "").trim(),
    gameId: String(localContext?.gameId || "").trim(),
  });
}

function buildProjectileDefaults(payload = {}, defaults = ARROWS) {
  const resolvedSpeed = Math.max(
    1,
    Number(payload?.speed) || Number(defaults.speed) || 1,
  );
  const resolvedRange = Math.max(
    1,
    Number(payload?.range) || Number(defaults.range) || 1,
  );
  const rangeLifetimeMs = Math.ceil(
    (resolvedRange / resolvedSpeed) * 1000 * 1.35,
  );
  return {
    speed: resolvedSpeed,
    range: resolvedRange,
    collisionRadius: Math.max(
      1,
      Number(payload?.collisionRadius) ||
        Number(defaults.collisionRadius) ||
        16,
    ),
    damage: Math.max(
      1,
      Number(payload?.damage) ||
        Number(defaults.damagePerArrow) ||
        Number(defaults.damage) ||
        1,
    ),
    visualScale:
      Number(payload?.scale) ||
      Number(defaults.visualScale) ||
      Number(defaults.scale) ||
      0.22,
    burn: payload?.burn || null,
    gravity:
      Number(payload?.gravity) || Number(defaults.gravity) || DEFAULT_GRAVITY,
    maxLifetimeMs:
      Number(payload?.maxLifetimeMs) ||
      Number(defaults.maxLifetimeMs) ||
      rangeLifetimeMs ||
      DEFAULT_MAX_LIFETIME_MS,
    embedMs:
      Number(payload?.embedMs) ||
      Number(defaults.embedMs) ||
      Number(ARROWS.embedMs) ||
      2000,
  };
}

function spawnArrowSpread(
  scene,
  payload,
  ownerSprite = null,
  localContext = {},
) {
  const defaults = payload?.burn
    ? {
        count: Number(payload?.count) || 6,
        spreadDeg: Number(payload?.spreadDeg) || 26,
        speed: Number(payload?.speed) || 930,
        collisionRadius: Number(payload?.collisionRadius) || 18,
        damagePerArrow: Number(payload?.damage) || 1000,
        visualScale: Number(payload?.scale) || 0.24,
        gravity: Number(payload?.gravity) || 980,
        maxLifetimeMs: Number(payload?.maxLifetimeMs) || 2800,
        embedMs: Number(payload?.embedMs) || 2200,
        releaseMs: Number(payload?.releaseMs) || 0,
      }
    : ARROWS;
  const projectileDefaults = buildProjectileDefaults(payload, defaults);
  const projectiles = Array.isArray(payload?.projectiles)
    ? payload.projectiles
    : buildSpreadProjectiles({
        baseInstanceId: String(payload?.id || createRuntimeId("huntressArrow")),
        angle: Number(payload?.angle) || 0,
        count: payload?.count || defaults.count,
        spreadDeg: payload?.spreadDeg || defaults.spreadDeg,
        speed: projectileDefaults.speed,
        range: projectileDefaults.range,
        collisionRadius: projectileDefaults.collisionRadius,
        damage: projectileDefaults.damage,
        visualScale: projectileDefaults.visualScale,
        burn: projectileDefaults.burn,
        gravity: projectileDefaults.gravity,
        maxLifetimeMs: projectileDefaults.maxLifetimeMs,
        embedMs: projectileDefaults.embedMs,
      });

  const normalizedProjectiles = projectiles.map((projectile, index) => ({
    ...projectile,
    id:
      String(projectile?.id || "").trim() ||
      `${String(payload?.id || "huntress")}:${index}`,
  }));

  normalizedProjectiles.forEach((projectile, index) => {
    const delay =
      Math.max(
        0,
        Number(payload?.releaseMs) ||
          Number(defaults.releaseMs) ||
          (payload?.burn ? DEFAULT_SPECIAL_RELEASE_MS : 0),
      ) * index;
    if (delay > 0) {
      scene.time.delayedCall(delay, () =>
        spawnArrowProjectile(
          scene,
          payload,
          projectile,
          ownerSprite,
          localContext,
        ),
      );
    } else {
      spawnArrowProjectile(
        scene,
        payload,
        projectile,
        ownerSprite,
        localContext,
      );
    }
  });
}

export function performHuntressArrowSpread(instance, attackContext = null) {
  const { scene, player: p } = instance;
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const angle = Number.isFinite(Number(context?.angle))
    ? Number(context.angle)
    : p.flipX
      ? Math.PI
      : 0;
  const direction =
    Number(context?.direction) === -1 ||
    (Math.cos(angle) < -0.1 && Number(context?.direction) !== 1)
      ? -1
      : 1;
  const baseSpeed = Math.max(
    1,
    Number(ARROWS.speed) * (Number(context?.speedScale) || 1),
  );
  const baseRange = Math.max(
    120,
    Number(context?.range) || Number(ARROWS.range) || 760,
  );
  const ballistic = resolveAimBallistics(angle, baseSpeed, baseRange);
  const speed = ballistic.speed;
  const range = ballistic.range;
  const lifetimeMs = Math.max(
    250,
    Number(ARROWS.maxLifetimeMs) || Math.ceil((range / speed) * 1000 * 1.35),
  );
  const attackId = createRuntimeId("huntressArrow");
  const unlockFlip = lockPlayerFlip(p);

  playAttackAnimation(scene, p);
  playSound(scene, "huntress-attack", { volume: 0.55 });
  scene.time.delayedCall(Number(ARROWS.flipLockMs) || 260, () => {
    try {
      unlockFlip();
    } catch (_) {}
  });

  return {
    type: `${NAME}-arrow`,
    id: attackId,
    direction,
    angle,
    speed,
    range,
    startup: Number(ARROWS.castDelayMs) || 100,
    count: Number(ARROWS.count) || 3,
    spreadDeg: Number(ARROWS.spreadDeg) || 9,
    collisionRadius: Number(ARROWS.collisionRadius) || 16,
    damage: Number(ARROWS.damagePerArrow) || 1000,
    scale: Number(ARROWS.visualScale) || 0.22,
    gravity: Number(ARROWS.gravity) || DEFAULT_GRAVITY,
    maxLifetimeMs: lifetimeMs || DEFAULT_MAX_LIFETIME_MS,
    embedMs: Number(ARROWS.embedMs) || 2000,
  };
}

export function spawnHuntressArrowVisual(
  scene,
  payload,
  ownerSprite,
  localContext = {},
) {
  spawnArrowSpread(scene, payload, ownerSprite, localContext);
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
  for (const shape of ACTIVE_DEBUG_SHAPES) {
    if (shape?.active) shape.setVisible(DEBUG_DRAW);
  }
}

export { HuntressArrow };
