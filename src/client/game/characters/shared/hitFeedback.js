import { DELIVERIES } from "../../../../shared/combat/attackDelivery";
import { spawnDamageImpact, spawnDuckGuardImpact } from "../../scene/effects";
import { hitstop } from "./shotPrediction";

// One hit reaction for every attack (docs/development/client.md, "Hit
// feedback"), so a hit reads the same whoever threw it:
//
// 1. the struck fighter flashes white for a moment,
// 2. the shared damage burst plays on their body (and the guard bubble if they
//    were ducking),
// 3. their animation holds for the attack delivery's hitstop.
//
// Each viewer sees it once, at the earliest moment they know of the hit: the
// attacker at its predicted contact, everyone else at the server's health
// update. Attack-specific sounds and effects (fireball bursts, explosions,
// each character's hit sound) play alongside it and are not replaced.
export const HIT_FEEDBACK = Object.freeze({
  flashColor: 0xffffff,
  flashAlpha: 0.85,
  flashMs: 110,
});

// The animation hold a delivery gives the struck fighter; 0 for unknown.
export function hitstopForDelivery(delivery) {
  return DELIVERIES[delivery]?.hitstopMs || 0;
}

// A white copy of the fighter's current frame, drawn over it and faded out.
// A copy keeps the fighter's own tint (team, power-ups, invisibility) intact.
function flashSilhouette(scene, sprite) {
  if (!scene?.add?.sprite || !scene.tweens?.add || !sprite?.texture?.key) return null;
  if (sprite.visible === false || !((sprite.alpha ?? 1) > 0.05)) return null;
  const ghost = scene.add.sprite(sprite.x, sprite.y, sprite.texture.key, sprite.frame?.name);
  const follow = () => {
    if (!sprite.active || !ghost.active) return;
    ghost.setPosition?.(sprite.x, sprite.y);
    ghost.setFlip?.(sprite.flipX, sprite.flipY);
  };
  ghost.setOrigin?.(sprite.originX ?? 0.5, sprite.originY ?? 0.5);
  ghost.setScale?.(sprite.scaleX ?? 1, sprite.scaleY ?? 1);
  ghost.setRotation?.(sprite.rotation || 0);
  ghost.setTintFill?.(HIT_FEEDBACK.flashColor);
  ghost.setAlpha?.(HIT_FEEDBACK.flashAlpha * (sprite.alpha ?? 1));
  ghost.setDepth?.((Number(sprite.depth) || 0) + 1);
  follow();
  scene.tweens.add({
    targets: ghost,
    alpha: 0,
    duration: HIT_FEEDBACK.flashMs,
    ease: "Quad.easeIn",
    onUpdate: follow,
    onComplete: () => ghost.destroy(),
  });
  return ghost;
}

// The shared reaction on a struck fighter. `hitstopMs` is 0 for damage that is
// not a blow (burn ticks), which still flashes and bursts.
export function playHitFeedback(scene, sprite, { hitstopMs = 0, duckBlocked = false } = {}) {
  if (!scene || !sprite?.active) return false;
  flashSilhouette(scene, sprite);
  spawnDamageImpact(scene, sprite);
  if (duckBlocked) spawnDuckGuardImpact(scene, sprite);
  hitstop(sprite, hitstopMs);
  return true;
}
