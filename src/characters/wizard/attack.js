import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";

const FIREBALL = getResolvedCharacterAttackConfig("wizard", "fireball");

const FIREBALL_SPEED = FIREBALL.speed;
const FIREBALL_RANGE = FIREBALL.range;
const FIREBALL_VISUAL_RADIUS = FIREBALL.visualRadius;
const FIREBALL_COLLISION_RADIUS = FIREBALL.collisionRadius;
const FIREBALL_INITIAL_SCALE = FIREBALL.initialScale;
const FIREBALL_ACTIVE_SCALE = FIREBALL.activeScale;
const FIREBALL_GLOW_RADIUS_MULT = FIREBALL.glowRadiusMultiplier;
const FIREBALL_BOB_AMPLITUDE = FIREBALL.bobAmplitude;
const FIREBALL_VERTICAL_OFFSET = FIREBALL.verticalOffset;
const FIREBALL_CAST_DELAY_MS = FIREBALL.castDelayMs;
const FIREBALL_FLIP_LOCK_MS = FIREBALL.flipLockMs;
const FIREBALL_BOB_TWEEN_MS = FIREBALL.bobTweenMs;
const FIREBALL_FORWARD_OFFSET = FIREBALL.forwardOffset;
const FIREBALL_BOB_FREQ_MS = FIREBALL.bobFreqMs;
const FIREBALL_DEPTH = FIREBALL.depth;
const FIREBALL_BASE_ANGLE_DEG = FIREBALL.baseAngleDeg;

let DEBUG_DRAW = false;
const ACTIVE_DEBUG_SHAPES = new Set();

function registerDebugShape(shape) {
  if (!shape) return shape;
  ACTIVE_DEBUG_SHAPES.add(shape);
  shape.setVisible(DEBUG_DRAW);
  shape.once("destroy", () => {
    ACTIVE_DEBUG_SHAPES.delete(shape);
  });
  return shape;
}

function createDebugCircle(scene) {
  if (!scene?.add) return null;
  const circle = scene.add.circle(
    0,
    0,
    FIREBALL_COLLISION_RADIUS,
    0x00ffff,
    0.08,
  );
  circle.setStrokeStyle(1, 0x00ffff, 0.8);
  circle.setDepth(9999);
  return registerDebugShape(circle);
}

function attachDebugFollower(scene, target) {
  if (!scene || !target) return null;
  const circle = createDebugCircle(scene);
  if (!circle) return null;
  const updater = () => {
    if (!circle.active || !target.active) return;
    circle.x = target.x;
    circle.y = target.y;
  };
  scene.events.on("update", updater);
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    scene.events.off("update", updater);
    circle.destroy();
  };
  return {
    destroy,
    shape: circle,
  };
}

function createFireballSprite(scene, x, y, direction) {
  const key = scene.textures.exists("wizard-fireball")
    ? "wizard-fireball"
    : scene.textures.exists("fireball")
      ? "fireball"
      : scene.textures.exists("wizard")
        ? "wizard"
        : null;
  const sprite = key
    ? scene.add.sprite(x, y, key)
    : scene.add.circle(x, y, FIREBALL_VISUAL_RADIUS, 0xff8b3d, 0.9);
  sprite.setDepth(FIREBALL_DEPTH);
  if (sprite.setScale) sprite.setScale(FIREBALL_INITIAL_SCALE);
  if (sprite.setAngle)
    sprite.setAngle(
      direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG,
    );

  // Ensure animated fireball plays if atlas frames are available
  if (key === "wizard-fireball" && scene.textures.exists("wizard-fireball")) {
    const animKey = "wizard-fireball:loop";
    if (!scene.anims.exists(animKey)) {
      const tex = scene.textures.get("wizard-fireball");
      const names = (tex && tex.getFrameNames && tex.getFrameNames()) || [];
      const frames = names.filter((n) => n && n !== "__BASE");
      if (frames.length > 1) {
        frames.sort((a, b) => {
          const ra = /([0-9]+)(?!.*[0-9])/.exec(a);
          const rb = /([0-9]+)(?!.*[0-9])/.exec(b);
          if (ra && rb) return Number(ra[1]) - Number(rb[1]);
          return a.localeCompare(b);
        });
        scene.anims.create({
          key: animKey,
          frames: frames.map((f) => ({ key: "wizard-fireball", frame: f })),
          frameRate: 20,
          repeat: -1,
        });
      }
    }
    if (sprite.anims && scene.anims.exists("wizard-fireball:loop")) {
      sprite.anims.play("wizard-fireball:loop", true);
    }
  }
  return sprite;
}

function spawnFireballTrail(scene, sprite) {
  if (!scene?.add) return null;
  if (!scene.add.circle) return null;
  const glow = scene.add.circle(
    sprite.x,
    sprite.y,
    FIREBALL_VISUAL_RADIUS * FIREBALL_GLOW_RADIUS_MULT,
    0xff6b2c,
    0.22,
  );
  glow.setDepth(FIREBALL_DEPTH - 1);
  const update = () => {
    if (!glow.active || !sprite.active) return;
    glow.x = sprite.x;
    glow.y = sprite.y;
    if (glow.scale) {
      glow.scale = Phaser.Math.FloatBetween(0.95, 1.1);
    }
  };
  scene.events.on("update", update);
  return {
    destroy() {
      scene.events.off("update", update);
      glow.destroy();
    },
  };
}

function spawnImpact(scene, x, y, playSound = true) {
  try {
    // Use simple circle flash instead of particles to avoid texture issues
    if (scene.add?.circle) {
      const flash = scene.add.circle(
        x,
        y,
        FIREBALL_VISUAL_RADIUS,
        0xffd9a0,
        0.6,
      );
      flash.setBlendMode(Phaser.BlendModes.ADD);
      scene.tweens.add({
        targets: flash,
        alpha: 0,
        scale: 1.4,
        duration: 220,
        onComplete: () => flash.destroy(),
      });
    }
    // Play impact sound (audible to everyone if called from remote visual too)
    if (playSound) {
      const played = scene.sound?.play("wizard-impact", { volume: 0.45 });
      if (!played) {
        scene.sound?.play("sfx-damage", { volume: 0.4 });
      }
    }
  } catch (_) {}
}

function playWizardCastWindup(scene, ownerSprite, volume = 0.3) {
  try {
    if (ownerSprite?.anims) {
      if (scene.anims?.exists("wizard-throw")) {
        ownerSprite.anims.play("wizard-throw", false);
      } else if (scene.anims?.exists("throw")) {
        ownerSprite.anims.play("throw", false);
      }
    }
  } catch (_) {}

  try {
    const played = scene.sound?.play("wizard-fireball", { volume });
    if (!played) {
      scene.sound?.play("draven-fireball", { volume: Math.max(0.2, volume * 0.8) });
    }
  } catch (_) {}
}

function resolveProjectileStart(payload, ownerSprite, angle, direction) {
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

  const resolvedAngle = Number.isFinite(Number(angle))
    ? Number(angle)
    : direction < 0
      ? Math.PI
      : 0;
  return {
    x:
      (ownerSprite?.x || 0) +
      Math.cos(resolvedAngle) *
        ((ownerSprite?.displayWidth || 80) * FIREBALL_FORWARD_OFFSET),
    y: ownerSprite
      ? ownerSprite.y -
          (ownerSprite.displayHeight || ownerSprite.height || 120) *
            FIREBALL_VERTICAL_OFFSET +
        Math.sin(resolvedAngle) *
          ((ownerSprite.displayWidth || ownerSprite.width || 80) *
            FIREBALL_FORWARD_OFFSET)
      : 0,
  };
}

function spawnWizardFireballProjectile(
  scene,
  payload,
  {
    ownerSprite = null,
  } = {},
) {
  if (!scene?.add) return null;

  const direction = payload?.direction || 1;
  const angle = Number.isFinite(Number(payload?.angle))
    ? Number(payload.angle)
    : direction < 0
      ? Math.PI
      : 0;
  const forwardX = Math.cos(angle);
  const forwardY = Math.sin(angle);
  const normalX = -forwardY;
  const normalY = forwardX;
  const start = resolveProjectileStart(payload, ownerSprite, angle, direction);
  const range = payload?.range || FIREBALL_RANGE;
  const travelDuration =
    payload?.duration || Math.round((range / FIREBALL_SPEED) * 1000);
  const startup = Math.max(0, Number(payload?.startup) || 0);
  const bob = payload?.bob ?? FIREBALL_BOB_AMPLITUDE;
  const scale = Number(payload?.scale) || FIREBALL_ACTIVE_SCALE;
  const attackId = String(payload?.id || createRuntimeId("wizardFireball"));

  const sprite = createFireballSprite(scene, start.x, start.y, direction);
  if (sprite.setAngle) {
    sprite.setAngle(Phaser.Math.RadToDeg(angle) + FIREBALL_BASE_ANGLE_DEG);
  }
  scene.tweens.add({
    targets: sprite,
    scale,
    ease: "Sine.easeOut",
    duration: startup,
  });
  const debugFollower = attachDebugFollower(scene, sprite);
  if (debugFollower) {
    sprite.once("destroy", () => debugFollower.destroy());
  }
  const trail = spawnFireballTrail(scene, sprite);

  let startupFollower = null;
  const followOwnerDuringStartup =
    startup > 0 && ownerSprite && ownerSprite.active;
  if (followOwnerDuringStartup) {
    const updateStartupOrigin = () => {
      if (!sprite.active || !ownerSprite?.active) return;
      const liveStart = resolveProjectileStart({}, ownerSprite, angle, direction);
      sprite.x = liveStart.x;
      sprite.y = liveStart.y;
    };
    updateStartupOrigin();
    scene.events.on("update", updateStartupOrigin);
    startupFollower = () => {
      scene.events.off("update", updateStartupOrigin);
      startupFollower = null;
    };
  }

  const launch = () => {
    if (!sprite.active) return;
    if (startupFollower) startupFollower();
    const launchX = sprite.x;
    const launchY = sprite.y;

    scene.tweens.add({
      targets: { t: 0 },
      t: 1,
      ease: "Linear",
      duration: travelDuration,
      onUpdate: (tween) => {
        if (!sprite.active) return;
        const progress = Number(tween?.targets?.[0]?.t) || 0;
        const travel = range * progress;
        const bobOffset =
          Math.sin((travelDuration * progress) / FIREBALL_BOB_FREQ_MS) * bob;
        sprite.x = launchX + forwardX * travel + normalX * bobOffset;
        sprite.y = launchY + forwardY * travel + normalY * bobOffset;
      },
      onComplete: () => {
        spawnImpact(scene, sprite.x, sprite.y, false);
        sprite.destroy();
        if (trail) trail.destroy();
        debugFollower?.destroy();
      },
    });
  };

  if (startup > 0) {
    scene.time.delayedCall(startup, launch);
  } else {
    launch();
  }
  return sprite;
}

export function performWizardFireball(instance, attackContext = null) {
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
  const attackId = createRuntimeId("wizardFireball");

  const unlockFlip = lockPlayerFlip(p);
  playWizardCastWindup(scene, p, 0.55);
  scene.time.delayedCall(FIREBALL_FLIP_LOCK_MS, () => {
    try {
      unlockFlip();
    } catch (_) {}
  });

  return {
    type: "wizard-fireball",
    id: attackId,
    direction,
    angle,
    range: FIREBALL_RANGE,
    duration: Math.round((FIREBALL_RANGE / FIREBALL_SPEED) * 1000),
    startup: FIREBALL_CAST_DELAY_MS,
    bob: FIREBALL_BOB_AMPLITUDE,
    scale: FIREBALL_ACTIVE_SCALE,
    damage: Math.max(
      1,
      Math.round(instance.constructor?.getStats?.()?.baseDamage || 0),
    ),
  };
}

export function spawnWizardFireballVisual(scene, payload, ownerSprite) {
  return spawnWizardFireballProjectile(scene, payload, {
    ownerSprite,
  });
}

export function spawnWizardFireballAuthoritative(scene, payload, localContext = {}) {
  return spawnWizardFireballProjectile(scene, payload, {
    ownerSprite: localContext?.ownerSprite || null,
  });
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
  for (const shape of ACTIVE_DEBUG_SHAPES) {
    shape.setVisible(DEBUG_DRAW);
  }
}
