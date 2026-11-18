import { characterDefinitions } from "../../../../shared/characters/index.js";
import { trackDebugShape, isAttackDebugDraw } from "../shared/attackDebugDraw";
import { applyTeamVisual, teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
// Draven splash attack extracted
import { getResolvedCharacterAttackConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { playSpriteAnimation } from "../shared/animationState";
import { playPlayerSound } from "../../audio/playerAudio";
import { attackerPose, attachedRectShape } from "../../../../shared/combat/attackDelivery";
import { attackDescriptors } from "../../../../shared/characters/index.js";
import { predictAttachedContacts, notePredictedHit } from "../shared/shotPrediction";

const { key: NAME } = characterDefinitions.draven;

const SPLASH = getResolvedCharacterAttackConfig(NAME, "splash");
const ACTIVE_WINDOW_MS = SPLASH.activeWindowMs;
const FLIP_UNLOCK_MS = SPLASH.flipUnlockMs;
const TIP_OFFSET = SPLASH.tipOffset;
const CENTER_Y_FACTOR = SPLASH.centerYFactor;
// Where the server draws a confirmed splash on its target.
const IMPACT_OFFSET_Y = Number(attackDescriptors["draven-splash"]?.events?.onHitAction?.offsetY) || 0;

export function performDravenSplashAttack(instance, attackContext = null) {
  const { scene, player: p } = instance;
  const context = attackContext || instance.consumeAttackContext?.() || {};
  const direction =
    Number(context?.direction) === -1 ||
    (p.flipX && Number(context?.direction) !== 1)
      ? -1
      : 1;

  // Lock facing direction for the whole attack window
  const unlockFlip = lockPlayerFlip(p); // remember original orientation
  const attackId = createRuntimeId("dravenSplash");

  playSpriteAnimation({
    scene,
    sprite: p,
    character: NAME,
    logical: "throw",
    fallback: "idle",
    id: attackId,
  });

  // Continuous damage ticking within active window (owner only)
  let elapsed = 0;
  let dbg = null;
  // The splash is predicted against enemies as drawn with the server's shape
  // (attackDelivery.attachedRectShape); each enemy is struck once.
  const startedAt = performance.now();
  const struck = new Set();
  // Play fireball SFX (local-only)
  try {
    if (scene.sound) {
      playPlayerSound(scene, p, "draven-fireball", { volume: 0.4, rate: 1 });
    }
  } catch (_) {}

  const updateListener = () => {
    const dt = scene.game.loop.delta || 16;
    elapsed += dt;
    // Reinforce visual flip lock every frame
    enforceLockedFlip(p);
    const shapes = attachedRectShape(attackerPose(NAME, p.x, p.y, { flip: direction < 0 }), SPLASH,
      performance.now() - startedAt);
    for (const hit of predictAttachedContacts(shapes, { skip: struck })) {
      struck.add(hit.target.name);
      if (hit.target.sprite) spawnExplosion(scene, hit.target.sprite.x, hit.target.sprite.y + IMPACT_OFFSET_Y);
      notePredictedHit({ delivery: "attached", character: NAME, target: hit.target, attacker: p });
    }
    if (isAttackDebugDraw() && scene.add) {
      if (!dbg) {
        dbg = trackDebugShape(scene.add.graphics());
        dbg.setDepth(RENDER_LAYERS.ATTACKS);
      }
      dbg.clear();
      dbg.fillStyle(0xff6f3c, 0.08);
      dbg.lineStyle(2, 0xff9a4d, 0.92);
      for (const { left, top, right, bottom } of shapes) {
        dbg.fillRect(left, top, right - left, bottom - top);
        dbg.strokeRect(left, top, right - left, bottom - top);
      }
    }
    if (elapsed >= ACTIVE_WINDOW_MS) {
      scene.events.off("update", updateListener);
      if (dbg) dbg.destroy();
    }
  };
  scene.events.on("update", updateListener);
  // Unlock facing after fixed delay independent of explosion window
  scene.time.delayedCall(FLIP_UNLOCK_MS, unlockFlip);

  // Broadcast only minimal data (old config removed)
  return {
    type: "draven-splash",
    id: attackId,
    direction,
    tipOffset: TIP_OFFSET,
    centerYFactor: CENTER_Y_FACTOR,
    delay: SPLASH.remoteExplosionDelayMs,
  };
}

export function spawnExplosion(scene, x, y, owner = null) {
  const texture = teamColor(owner) === TEAM_RED && scene?.textures?.exists("draven-explosion-red") ? "draven-explosion-red" : "draven-explosion";
  try {
    if (!scene || !scene.add || !scene.textures?.exists(texture)) {
      return null;
    }
    const e = scene.add.sprite(x, y, texture);
    // The impact must sit above the struck actor, not behind their body.
    e.setDepth(RENDER_LAYERS.ATTACKS);
    e.setScale(2.05);
    e.setAlpha(0.42);
    scene.tweens?.add({ targets: e, alpha: 0.92, duration: 70, ease: "Sine.easeOut" });
    applyTeamVisual(e, owner);
    if (scene.anims?.exists(texture)) {
      // Begin with visible contact rather than replaying the pre-impact buildup.
      e.anims.play({ key: texture, startFrame: 3, frameRate: 22 });
      e.once("animationcomplete", () => e.destroy());
    } else {
      // No animation defined; fade out and destroy for a minimal visual cue
      scene.tweens?.add({
        targets: e,
        alpha: 0,
        duration: 200,
        onComplete: () => e.destroy(),
      });
    }
    return e;
  } catch (_) {
    return null;
  }
}
