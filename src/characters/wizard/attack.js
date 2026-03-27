import { getCharacterTuning } from "../../lib/characterStats.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import {
  getChargeRatioFromContext,
  scaleByCharge,
} from "../shared/chargeAttack";

const WIZARD_TUNING = getCharacterTuning("wizard");
const FIREBALL = WIZARD_TUNING.attack?.fireball || {};
const WIZARD_CHARGE = WIZARD_TUNING.attack?.charge || {};

const FIREBALL_SPEED = FIREBALL.speed ?? 450; // px per second after launch
const FIREBALL_RANGE = FIREBALL.range ?? 1050; // px travel before despawn
const FIREBALL_VISUAL_RADIUS = FIREBALL.visualRadius ?? 14;
const FIREBALL_COLLISION_RADIUS = FIREBALL.collisionRadius ?? 38;
const FIREBALL_INITIAL_SCALE = FIREBALL.initialScale ?? 0.1; // spawn scale
const FIREBALL_ACTIVE_SCALE = FIREBALL.activeScale ?? 0.5; // scale once flying
const FIREBALL_GLOW_RADIUS_MULT = FIREBALL.glowRadiusMultiplier ?? 1.35;
const FIREBALL_BOB_AMPLITUDE = FIREBALL.bobAmplitude ?? 5;
const FIREBALL_VERTICAL_OFFSET = FIREBALL.verticalOffset ?? 0.12; // fraction of height to lift from feet
const FIREBALL_CAST_DELAY_MS = FIREBALL.castDelayMs ?? 300; // pre-launch delay
const FIREBALL_FLIP_LOCK_MS = FIREBALL.flipLockMs ?? 300; // how long flip is locked (cast delay + 100ms)
const FIREBALL_BOB_TWEEN_MS = FIREBALL.bobTweenMs ?? 220; // remote bob tween duration
const FIREBALL_FORWARD_OFFSET = FIREBALL.forwardOffset ?? 0.23; // multiplier applied to sprite width for spawn X offset
const FIREBALL_BOB_FREQ_MS = FIREBALL.bobFreqMs ?? 120; // divisor for owner bob sine wave (larger = slower)
const FIREBALL_DEPTH = FIREBALL.depth ?? 100; // ensure rendering above tilemap and ground
const FIREBALL_BASE_ANGLE_DEG = FIREBALL.baseAngleDeg ?? -90; // sideways orientation; right=+90, left=-90

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

function resolveProjectileStart(payload, ownerSprite, direction) {
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

  return {
    x:
      (ownerSprite?.x || 0) +
      direction * ((ownerSprite?.displayWidth || 80) * FIREBALL_FORWARD_OFFSET),
    y: ownerSprite
      ? ownerSprite.y -
        (ownerSprite.displayHeight || ownerSprite.height || 120) *
          FIREBALL_VERTICAL_OFFSET
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
  const start = resolveProjectileStart(payload, ownerSprite, direction);
  const range = payload?.range || FIREBALL_RANGE;
  const travelDuration =
    payload?.duration || Math.round((range / FIREBALL_SPEED) * 1000);
  const startup = Math.max(0, Number(payload?.startup) || 0);
  const bob = payload?.bob ?? FIREBALL_BOB_AMPLITUDE;
  const scale = Number(payload?.scale) || FIREBALL_ACTIVE_SCALE;
  const chargeRatio = Number(payload?.chargeRatio) || 0;
  const attackId = String(payload?.id || createRuntimeId("wizardFireball"));
  const chargedCollisionRadius = scaleByCharge({
    baseValue: FIREBALL_COLLISION_RADIUS,
    chargeRatio,
    maxScale: WIZARD_CHARGE.scaleMax || 1,
  });

  const sprite = createFireballSprite(scene, start.x, start.y, direction);
  if (sprite.setAngle) {
    sprite.setAngle(
      direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG,
    );
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
      const liveStart = resolveProjectileStart({}, ownerSprite, direction);
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
      targets: sprite,
      x: launchX + direction * range,
      ease: "Linear",
      duration: travelDuration,
      onComplete: () => {
        spawnImpact(scene, sprite.x, sprite.y, false);
        sprite.destroy();
        if (trail) trail.destroy();
        debugFollower?.destroy();
      },
    });
    scene.tweens.add({
      targets: sprite,
      y: launchY + bob,
      ease: "Sine.easeInOut",
      yoyo: true,
      duration: FIREBALL_BOB_TWEEN_MS,
      repeat: Math.ceil(travelDuration / FIREBALL_BOB_TWEEN_MS),
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
  const chargeRatio = getChargeRatioFromContext(attackContext);
  const direction = p.flipX ? -1 : 1;
  const attackId = createRuntimeId("wizardFireball");
  const chargedScale = scaleByCharge({
    baseValue: FIREBALL_ACTIVE_SCALE,
    chargeRatio,
    maxScale: WIZARD_CHARGE.scaleMax || 1,
  });

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
    range: FIREBALL_RANGE,
    duration: Math.round((FIREBALL_RANGE / FIREBALL_SPEED) * 1000),
    startup: FIREBALL_CAST_DELAY_MS,
    bob: FIREBALL_BOB_AMPLITUDE,
    scale: chargedScale,
    chargeRatio,
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
