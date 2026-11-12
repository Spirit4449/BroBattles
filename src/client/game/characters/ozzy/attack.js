import { applyTeamVisual, teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { getResolvedCharacterAttackConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { rigPoint } from "../shared/rig";
import rigData from "../../../../shared/characters/characterRig.js";

const { launchPoint } = rigData;
import { attachToPlayer } from "../shared/attachToPlayer";
import { playSpriteAnimation } from "../shared/animationState";

import { createFireballParticles, spawnFireballBurst } from "./fireballParticles";
import { ensureFireballTextures, FIREBALL_ORIGIN, EXPLOSION_ORIGIN, EXPLOSION_FRAMES, explosionTextureKey } from "./fireballArt";
import { playPlayerSound } from "../../audio/playerAudio";
import { consumeOnce } from "../shared/packetDedupe";
import { attackCollisionCenter } from "../../../../shared/combat/shotContact";
import { launchTravel, launchDurationMs } from "../../../../shared/combat/launchRamp";
import { predictShotContact, predictAttachedContacts, shotBlockerContact, notePredictedHit } from "../shared/shotPrediction";
import { ozzyChargeShapes } from "../../../../shared/characters/ozzyCharge";

const FIREBALL = getResolvedCharacterAttackConfig("ozzy", "fireball");

const FIREBALL_RANGE = FIREBALL.range;
const FIREBALL_VISUAL_RADIUS = FIREBALL.visualRadius;
const FIREBALL_COLLISION_RADIUS = FIREBALL.collisionRadius;
const FIREBALL_SPLASH_RADIUS = FIREBALL.splashRadius || FIREBALL.collisionRadius;
const FIREBALL_ACTIVE_SCALE = FIREBALL.activeScale;
const FIREBALL_BOB_AMPLITUDE = FIREBALL.bobAmplitude;
const FIREBALL_CAST_DELAY_MS = FIREBALL.castDelayMs;
const FIREBALL_FLIP_LOCK_MS = FIREBALL.flipLockMs;
const FIREBALL_BOB_FREQ_MS = FIREBALL.bobFreqMs;
const FIREBALL_DEPTH = FIREBALL.depth;
const FIREBALL_BASE_ANGLE_DEG = FIREBALL.baseAngleDeg;
// The ball eases off the staff on the same curve the server's hitbox uses.
const FIREBALL_DURATION_MS = Math.round(launchDurationMs(FIREBALL.range, FIREBALL));

// Each release is drawn once, whether predicted locally or echoed by the server.
export const consumeOzzyRelease = (scene, id) => consumeOnce(scene, "ozzy-release", id, 4000);

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

const FIREBALL_TEXTURE = "ozzy-fireball-unified";
const FIREBALL_FLIGHT_ANIM = "ozzy-fireball-unified:flight";

function createFireballSprite(scene, x, y, direction, owner = null) {
  ensureFireballTextures(scene);
  const texture = teamColor(owner) === TEAM_RED && scene.textures.exists("ozzy-fireball-red") ? "ozzy-fireball-red" : FIREBALL_TEXTURE;
  const flightAnimation = `${texture}:flight`;
  const hasSheet = scene.textures.exists(texture);
  const sprite = hasSheet
    ? scene.add.sprite(x, y, texture, "fire16")
    : scene.add.circle(x, y, FIREBALL_VISUAL_RADIUS, 0x8ae7ff, 0.9);
  sprite.setDepth(Math.max(FIREBALL_DEPTH, RENDER_LAYERS.ATTACKS));
  // Every spawn and flight cell is anchored on the ball's centre.
  if (hasSheet) {
    sprite.setOrigin(FIREBALL_ORIGIN.x, FIREBALL_ORIGIN.y);
    sprite.texture?.setFilter?.(0);
  }
  sprite.setScale(FIREBALL_ACTIVE_SCALE);
  sprite.setAngle(direction < 0 ? -FIREBALL_BASE_ANGLE_DEG : FIREBALL_BASE_ANGLE_DEG);
  if (hasSheet) {
    if (!scene.anims.exists(flightAnimation)) {
      scene.anims.create({
        key: flightAnimation,
        frames: Array.from({ length: 16 }, (_, i) => ({ key: texture, frame: `fire${i + 16}` })),
        frameRate: 24,
        repeat: -1,
      });
    }
    sprite.anims.play(flightAnimation, true);
  }
  sprite._bbFlightAnimation = flightAnimation;
  return sprite;
}

// The ball bursts into pixel flames that rise and break apart into smoke.
function spawnExplosion(scene, x, y, owner) {
  const texture = explosionTextureKey(teamColor(owner) === TEAM_RED ? "red" : "blue");
  if (!scene.add?.sprite || !scene.textures?.exists?.(texture)) return false;
  const key = `${texture}:burst`;
  if (!scene.anims.exists(key)) {
    scene.anims.create({
      key,
      frames: Array.from({ length: EXPLOSION_FRAMES }, (_, i) => ({ key: texture, frame: `boom${i}` })),
      frameRate: 20,
      repeat: 0,
    });
  }
  const boom = scene.add.sprite(Math.round(x), Math.round(y), texture, "boom0")
    .setOrigin(EXPLOSION_ORIGIN.x, EXPLOSION_ORIGIN.y)
    .setScale(FIREBALL_ACTIVE_SCALE)
    .setDepth(Math.max(FIREBALL_DEPTH, RENDER_LAYERS.ATTACKS) + 1);
  const destroy = () => {
    scene.events.off("presentation:reset", destroy);
    scene.events.off("shutdown", destroy);
    if (boom.active) boom.destroy();
  };
  boom.once("animationcomplete", destroy);
  scene.events.once("presentation:reset", destroy);
  scene.events.once("shutdown", destroy);
  boom.anims.play(key);
  return true;
}

function spawnImpact(scene, x, y, playSound = true, owner = null) {
  try {
    spawnFireballBurst(scene, x, y, owner);
    // Without the generated sheet (tests, a failed canvas) fall back to a flash.
    if (!spawnExplosion(scene, x, y, owner) && scene.add?.circle) {
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
      const played = playPlayerSound(scene, { x, y }, "ozzy-impact", { volume: 0.45 });
      if (!played) {
        playPlayerSound(scene, { x, y }, "sfx-damage", { volume: 0.4 });
      }
    }
  } catch (_) {}
}

// Each fireball id is its own cast, so a new fireball starts the throw over
// while a repeated packet for the same fireball leaves it alone.
export function playOzzyCastWindup(scene, ownerSprite, volume = 0.3, id = null) {
  playSpriteAnimation({
    scene,
    sprite: ownerSprite,
    character: "ozzy",
    logical: "throw",
    fallback: "idle",
    id,
  });

  try {
    const played = playPlayerSound(scene, ownerSprite, "ozzy-fireball", { volume });
    if (!played) {
      playPlayerSound(scene, ownerSprite, "draven-fireball", {
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
  // The same rig muzzle the server spawns from (ozzy.json fireballMuzzle).
  return launchPoint("ozzy", FIREBALL.muzzle, {
    x: Number(ownerSprite?.x) || 0, y: Number(ownerSprite?.y) || 0, flip: direction < 0,
  }, resolvedAngle) || { x: Number(ownerSprite?.x) || 0, y: Number(ownerSprite?.y) || 0 };
}

// The server's damage circle for a fireball `travel` px along its line, which
// has no bob and starts at the unsettled muzzle point.
function fireballDamageCenter(start, angle, travel) {
  return attackCollisionCenter({
    x: start.x + Math.cos(angle) * travel, y: start.y + Math.sin(angle) * travel, angle, traveled: travel,
    collisionForwardOffset: FIREBALL.collisionForwardOffset, collisionOffsetY: FIREBALL.collisionOffsetY,
  });
}

function spawnOzzyFireballProjectile(
  scene,
  payload,
  { ownerSprite = null, predictHits = false } = {},
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
    payload?.duration || Math.round(launchDurationMs(range, FIREBALL));
  const startup = Math.max(0, Number(payload?.startup) || 0);
  const bob = payload?.bob ?? FIREBALL_BOB_AMPLITUDE;
  const scale = Number(payload?.scale) || FIREBALL_ACTIVE_SCALE;
  const attackId = String(payload?.id || createRuntimeId("ozzyFireball"));

  const charged = scene._ozzyCharges?.get(payload?.id || ownerSprite);
  const sprite = charged?.release() || createFireballSprite(scene, start.x, start.y, direction, ownerSprite);
  applyTeamVisual(sprite, ownerSprite);
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
    // The fireball stops on the first thing it touches and bursts there. The
    // caster predicts that contact; every flight also stops where the server
    // says it burst (see burstOzzyFireball).
    let damageFrom = predictHits ? fireballDamageCenter({ x: launchX, y: launchY }, angle, 0) : null;
    const shooter = ownerSprite?.username;
    let lastTravel = 0;
    const burst = (x, y) => {
      if (!sprite.active) return;
      travelTween?.stop();
      spawnImpact(scene, x, y, false, sprite);
      sprite.destroy();
      trail?.stop();
      debugFollower?.destroy();
    };
    const flights = scene._ozzyFlights ||= new Map();
    flights.set(attackId, burst);
    sprite.once?.("destroy", () => { if (flights.get(attackId) === burst) flights.delete(attackId); });

    travelTween = scene.tweens.add({
      targets: { t: 0 },
      t: 1,
      ease: "Linear",
      duration: travelDuration,
      onUpdate: (tween) => {
        if (!sprite.active) return;
        const progress = Number(tween?.targets?.[0]?.t) || 0;
        const flown = travelDuration * progress;
        let travel = progress >= 1 ? range : Math.min(range, launchTravel(flown, FIREBALL));
        // A wall built against the caster stops the fireball, as on the server.
        const blockedAt = shotBlockerContact(shooter,
          { x: launchX + forwardX * lastTravel, y: launchY + forwardY * lastTravel },
          { x: launchX + forwardX * travel, y: launchY + forwardY * travel }, FIREBALL_COLLISION_RADIUS);
        if (blockedAt !== null) travel = lastTravel + (travel - lastTravel) * blockedAt;
        lastTravel = travel;
        // The bob grows in with the launch so the ball leaves the staff level.
        const bobIn = Math.min(1, flown / Math.max(1, FIREBALL.launchEaseMs || 1));
        const bobOffset = Math.sin(flown / FIREBALL_BOB_FREQ_MS) * bob * bobIn * bobIn;
        const correction = Math.min(1, flown / 240);
        const settle = 1 - correction * correction * (3 - 2 * correction);
        sprite.x = launchX + forwardX * travel + normalX * bobOffset + offsetX * settle;
        sprite.y = launchY + forwardY * travel + normalY * bobOffset + offsetY * settle;
        if (damageFrom) {
          const damageTo = fireballDamageCenter({ x: launchX, y: launchY }, angle, travel);
          const hit = predictShotContact(damageFrom, damageTo, FIREBALL_COLLISION_RADIUS);
          damageFrom = damageTo;
          if (hit) {
            // A struck player is the centre of the burst, as on the server;
            // mode objects burst where they were touched.
            const at = hit.target.sprite && hit.bounds
              ? { x: (hit.bounds.left + hit.bounds.right) / 2, y: (hit.bounds.top + hit.bounds.bottom) / 2 }
              : { x: hit.x, y: hit.y };
            predictSplash(at, "released");
            burst(at.x, at.y);
            return;
          }
        }
        if (blockedAt !== null) burst(sprite.x, sprite.y);
      },
      onComplete: () => burst(sprite.x, sprite.y),
    });
  };

  if (startup > 0) {
    launchTimer = scene.time.delayedCall(startup, launch);
  } else {
    launch();
  }
  return sprite;
}

export function performOzzyFireball(instance, attackContext = null) {
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
  const attackId = createRuntimeId("ozzyFireball");

  const unlockFlip = lockPlayerFlip(p);
  playOzzyCastWindup(scene, p, 0.55, attackId);
  chargeOzzyFireball(scene, p, { id: attackId, angle, direction, predict: true });
  scene.time.delayedCall(FIREBALL_FLIP_LOCK_MS, () => {
    try {
      unlockFlip();
    } catch (_) {}
  });
  // The caster releases on time instead of a round trip later; the server's
  // echo of this id is then skipped. An interrupted charge releases nothing.
  scene.time.delayedCall(FIREBALL_CAST_DELAY_MS, () => {
    if (!scene._ozzyCharges?.has(attackId) || !p.active) return;
    if (!consumeOzzyRelease(scene, attackId)) return;
    spawnOzzyFireballProjectile(scene, { id: attackId, angle, direction, range: FIREBALL_RANGE,
      duration: FIREBALL_DURATION_MS, bob: FIREBALL_BOB_AMPLITUDE,
      scale: FIREBALL_ACTIVE_SCALE }, { ownerSprite: p, predictHits: true });
  });

  return {
    type: "ozzy-fireball",
    id: attackId,
    direction,
    angle,
    range: FIREBALL_RANGE,
    duration: FIREBALL_DURATION_MS,
    startup: FIREBALL_CAST_DELAY_MS,
    bob: FIREBALL_BOB_AMPLITUDE,
    scale: FIREBALL_ACTIVE_SCALE,
    damage: Math.max(
      1,
      Math.round(instance.constructor?.getStats?.()?.baseDamage || 0),
    ),
  };
}

// Everyone inside the splash around `at` is hit once, the struck target included.
function predictSplash(at, delivery) {
  const splashed = new Set();
  for (let victim; (victim = predictShotContact(at, at, FIREBALL_SPLASH_RADIUS, { skip: splashed }));) {
    splashed.add(victim.target.name);
    notePredictedHit({ delivery, character: "ozzy", target: victim.target });
  }
}

// The server reports where a fireball burst; a flight still in the air stops
// and explodes there. Flights that already burst (the caster's prediction, or
// the end of range) ignore it.
export function burstOzzyFireball(scene, data) {
  const burst = scene?._ozzyFlights?.get(String(data?.id));
  const x = Number(data?.x), y = Number(data?.y);
  if (!burst || !Number.isFinite(x) || !Number.isFinite(y)) return false;
  burst(x, y);
  return true;
}

export function spawnOzzyFireballVisual(scene, payload, ownerSprite) {
  return spawnOzzyFireballProjectile(scene, payload, {
    ownerSprite,
  });
}

export function spawnOzzyFireballAuthoritative(
  scene,
  payload,
  localContext = {},
) {
  return spawnOzzyFireballProjectile(scene, payload, {
    ownerSprite: localContext?.ownerSprite || null,
  });
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
  for (const shape of ACTIVE_DEBUG_SHAPES) {
    shape.setVisible(DEBUG_DRAW);
  }
}

// The staff tip on the frame being shown (ozzy.json `rig.points.staffTip`).
export function getOzzyStaffTip(owner) {
  return rigPoint(owner, "staffTip", "ozzy") || { x: owner.x, y: owner.y };
}

// Spawn frames are selected from the same sheet using cast elapsed time.
// They clamp at frame 15 and can never wrap back to the initial spark.
export function chargeOzzyFireball(scene, owner, payload = {}) {
  if (!owner?.active) return;
  const key = payload.id || owner;
  const charges = scene._ozzyCharges ||= new Map();
  charges.get(key)?.destroy();
  const direction = payload.direction || (owner.flipX ? -1 : 1);
  const angle = Number.isFinite(Number(payload.angle)) ? Number(payload.angle) : direction < 0 ? Math.PI : 0;
  const start = getOzzyStaffTip(owner);
  const sprite = createFireballSprite(scene, start.x, start.y, direction, owner);
  applyTeamVisual(sprite, owner);
  const hasSheet = scene.textures.exists(FIREBALL_TEXTURE);
  sprite.setAngle(Phaser.Math.RadToDeg(angle) + FIREBALL_BASE_ANGLE_DEG);
  if (hasSheet) {
    sprite.anims.stop();
    sprite.setFrame("fire00");
  }
  // The forming ball already burns anyone on top of or behind the ozzy
  // (shared/characters/ozzyCharge.js). It bursts where the server says, or
  // where the caster predicts, and is then never released.
  const flights = scene._ozzyFlights ||= new Map();
  const flightId = payload.id != null ? String(payload.id) : null;
  let burst = null;
  const attachment = attachToPlayer(scene, owner, {
    key: `ozzy-charge:${key === owner ? "owner" : key}`,
    objects: [sprite],
    lifetimeMs: FIREBALL_CAST_DELAY_MS + 700,
    endOn: ["attack:interrupted"],
    onEnd: () => { if (charges.get(key) === entry) charges.delete(key); },
    update(elapsed) {
      if (payload.predict && elapsed > 0) {
        const pose = { x: owner.x, y: owner.y, flip: direction < 0 };
        const [hit] = predictAttachedContacts(ozzyChargeShapes(pose, elapsed));
        if (hit) {
          const at = { x: hit.x, y: hit.y };
          predictSplash(at, "attached");
          burst(at.x, at.y);
          return false;
        }
      }
      Object.assign(sprite, getOzzyStaffTip(owner));
      const t = Math.min(1, elapsed / FIREBALL_CAST_DELAY_MS);
      if (hasSheet) sprite.setFrame(`fire${String(Math.min(15, Math.floor(t * 16))).padStart(2, "0")}`);
      else sprite.setScale(FIREBALL_ACTIVE_SCALE * (0.025 + 0.975 * t));
      return true;
    },
  });
  const destroy = () => attachment.destroy();
  burst = (x, y) => {
    if (!sprite.active) return;
    spawnImpact(scene, x, y, false, sprite);
    destroy();
  };
  if (flightId) flights.set(flightId, burst);
  sprite.once?.("destroy", () => { if (flightId && flights.get(flightId) === burst) flights.delete(flightId); });
  const entry = { destroy, release() {
    attachment.detach();
    sprite.setScale(FIREBALL_ACTIVE_SCALE);
    if (hasSheet) sprite.anims.play(sprite._bbFlightAnimation || FIREBALL_FLIGHT_ANIM, true);
    return sprite;
  } };
  charges.set(key, entry);
  return sprite;
}
