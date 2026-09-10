import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";
import { playSpriteAnimation } from "../shared/animationState";

import { createFireballParticles } from "./fireballParticles";

const FIREBALL = getResolvedCharacterAttackConfig("wizard", "fireball");

const FIREBALL_SPEED = FIREBALL.speed;
const FIREBALL_RANGE = FIREBALL.range;
const FIREBALL_VISUAL_RADIUS = FIREBALL.visualRadius;
const FIREBALL_COLLISION_RADIUS = FIREBALL.collisionRadius;
const FIREBALL_ACTIVE_SCALE = FIREBALL.activeScale;
const FIREBALL_BOB_AMPLITUDE = FIREBALL.bobAmplitude;
const FIREBALL_VERTICAL_OFFSET = FIREBALL.verticalOffset;
const FIREBALL_CAST_DELAY_MS = FIREBALL.castDelayMs;
const FIREBALL_FLIP_LOCK_MS = FIREBALL.flipLockMs;
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
  circle.setDepth(RENDER_LAYERS.ATTACKS + 10);
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

const FIREBALL_TEXTURE = "wizard-fireball-unified";
const FIREBALL_FLIGHT_ANIM = "wizard-fireball-unified:flight";

function createFireballSprite(scene, x, y, direction) {
  const hasSheet = scene.textures.exists(FIREBALL_TEXTURE);
  const sprite = hasSheet
    ? scene.add.sprite(x, y, FIREBALL_TEXTURE, "fire16")
    : scene.add.circle(x, y, FIREBALL_VISUAL_RADIUS, 0x8ae7ff, 0.9);
  sprite.setDepth(Math.max(FIREBALL_DEPTH, RENDER_LAYERS.ATTACKS));
  // The same lower hot-core anchor is used for every spawn and flight cell.
  if (hasSheet) {
    sprite.setOrigin(0.5, 0.79);
    sprite.texture?.setFilter?.(1);
  }
  sprite.setScale(FIREBALL_ACTIVE_SCALE);
  sprite.setAngle(direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG);
  if (hasSheet) {
    if (!scene.anims.exists(FIREBALL_FLIGHT_ANIM)) {
      scene.anims.create({
        key: FIREBALL_FLIGHT_ANIM,
        frames: Array.from({ length: 16 }, (_, i) => ({ key: FIREBALL_TEXTURE, frame: `fire${i + 16}` })),
        frameRate: 24,
        repeat: -1,
      });
    }
    sprite.anims.play(FIREBALL_FLIGHT_ANIM, true);
  }
  return sprite;
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
  playSpriteAnimation({
    scene,
    sprite: ownerSprite,
    character: "wizard",
    logical: "throw",
    fallback: "idle",
    force: false,
  });

  try {
    const played = scene.sound?.play("wizard-fireball", { volume });
    if (!played) {
      scene.sound?.play("draven-fireball", {
        volume: Math.max(0.2, volume * 0.8),
      });
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
  { ownerSprite = null } = {},
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

  const charged = scene._wizardCharges?.get(payload?.id || ownerSprite);
  const sprite = charged?.release() || createFireballSprite(scene, start.x, start.y, direction);
  const offsetX = charged ? sprite.x - start.x : 0;
  const offsetY = charged ? sprite.y - start.y : 0;
  sprite.setScale(scale);
  if (!charged) {
    sprite.alpha = 0;
    scene.tweens.add({ targets: sprite, alpha: 1, duration: 90 });
  }
  if (sprite.setAngle) {
    sprite.setAngle(Phaser.Math.RadToDeg(angle) + FIREBALL_BASE_ANGLE_DEG);
  }
  const debugFollower = attachDebugFollower(scene, sprite);
  if (debugFollower) {
    sprite.once("destroy", () => debugFollower.destroy());
  }
  let trail = null;
  let travelTween = null;

  let launchTimer = null;
  const discard = () => {
    scene.events.off("presentation:reset", discard);
    travelTween?.stop();
    startupFollower?.();
    launchTimer?.remove?.(false);
    trail?.destroy?.();
    debugFollower?.destroy?.();
    sprite.destroy?.();
  };
  scene.events.once("presentation:reset", discard);
  sprite.once?.("destroy", () => {
    scene.events.off("presentation:reset", discard);
    scene.tweens.killTweensOf(sprite);
    travelTween?.stop();
    startupFollower?.();
    launchTimer?.remove?.(false);
    trail?.stop();
  });

  let startupFollower = null;
  const followOwnerDuringStartup =
    startup > 0 && ownerSprite && ownerSprite.active;
  if (followOwnerDuringStartup) {
    const updateStartupOrigin = () => {
      if (!sprite.active || !ownerSprite?.active) return;
      const liveStart = resolveProjectileStart(
        {},
        ownerSprite,
        angle,
        direction,
      );
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
    const launchX = sprite.x - offsetX;
    const launchY = sprite.y - offsetY;
    trail = createFireballParticles(scene, sprite, angle);

    travelTween = scene.tweens.add({
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
        const correction = Math.min(1, travelDuration * progress / 240);
        const settle = 1 - correction * correction * (3 - 2 * correction);
        sprite.x = launchX + forwardX * travel + normalX * bobOffset + offsetX * settle;
        sprite.y = launchY + forwardY * travel + normalY * bobOffset + offsetY * settle;
      },
      onComplete: () => {
        spawnImpact(scene, sprite.x, sprite.y, false);
        sprite.destroy();
        trail?.stop();
        debugFollower?.destroy();
      },
    });
  };

  if (startup > 0) {
    launchTimer = scene.time.delayedCall(startup, launch);
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
  chargeWizardFireball(scene, p, { id: attackId, angle, direction });
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

export function spawnWizardFireballAuthoritative(
  scene,
  payload,
  localContext = {},
) {
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

// Staff-tip coordinates in the wizard's untrimmed 231 x 190 attack frames.
const STAFF_TIPS = [[142, 76], [140, 76], [142, 76], [142, 72], [134, 74], [144, 70], [138, 68], [140, 66]];
export function getWizardStaffTip(owner) {
  const match = /attack(\d+)|throw(\d+)/i.exec(String(owner.frame?.name || ""));
  const [x, y] = match ? STAFF_TIPS[Math.min(7, Number(match[1] ?? match[2]))] : [88, 62];
  const sx = (owner.displayWidth || 231) / 231;
  const sy = (owner.displayHeight || 190) / 190;
  return {
    x: owner.x + (x - (owner.originX ?? 0.5) * 231) * sx * (owner.flipX ? -1 : 1),
    y: owner.y + (y - (owner.originY ?? 0.5) * 190) * sy,
  };
}

// Spawn frames are selected from the same sheet using cast elapsed time.
// They clamp at frame 15 and can never wrap back to the initial spark.
export function chargeWizardFireball(scene, owner, payload = {}) {
  if (!owner?.active) return;
  const key = payload.id || owner;
  const charges = scene._wizardCharges ||= new Map();
  charges.get(key)?.destroy();
  const direction = payload.direction || (owner.flipX ? -1 : 1);
  const angle = Number.isFinite(Number(payload.angle)) ? Number(payload.angle) : direction < 0 ? Math.PI : 0;
  const start = getWizardStaffTip(owner);
  const sprite = createFireballSprite(scene, start.x, start.y, direction);
  const hasSheet = scene.textures.exists(FIREBALL_TEXTURE);
  sprite.setAngle(Phaser.Math.RadToDeg(angle) + FIREBALL_BASE_ANGLE_DEG);
  if (hasSheet) {
    sprite.anims.stop();
    sprite.setFrame("fire00");
  }
  let elapsed = 0;
  let detached = false;
  const detach = () => {
    if (detached) return;
    detached = true;
    charges.delete(key);
    scene.events.off("postupdate", update);
    scene.events.off("shutdown", destroy);
    scene.events.off("presentation:reset", destroy);
    owner.off?.("destroy", destroy);
  };
  const destroy = () => { detach(); sprite.destroy(); };
  const update = (_time, delta = 16.67) => {
    elapsed += Math.max(0, delta);
    if (!owner.active || owner.body?.enable === false || elapsed > FIREBALL_CAST_DELAY_MS + 700) return destroy();
    Object.assign(sprite, getWizardStaffTip(owner));
    const t = Math.min(1, elapsed / FIREBALL_CAST_DELAY_MS);
    if (hasSheet) sprite.setFrame(`fire${String(Math.min(15, Math.floor(t * 16))).padStart(2, "0")}`);
    else sprite.setScale(FIREBALL_ACTIVE_SCALE * (0.025 + 0.975 * t));
  };
  charges.set(key, { destroy, release() {
    detach();
    sprite.setScale(FIREBALL_ACTIVE_SCALE);
    if (hasSheet) sprite.anims.play(FIREBALL_FLIGHT_ANIM, true);
    return sprite;
  } });
  scene.events.on("postupdate", update);
  scene.events.once("shutdown", destroy);
  scene.events.once("presentation:reset", destroy);
  owner.once?.("destroy", destroy);
  return sprite;
}
