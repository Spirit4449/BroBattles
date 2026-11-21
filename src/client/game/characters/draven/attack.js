import { characterDefinitions } from "../../../../shared/characters/index.js";
import { trackDebugShape, isAttackDebugDraw } from "../shared/attackDebugDraw";
import { applyTeamVisual, teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
// Draven splash attack extracted
import { getResolvedCharacterAttackConfig, getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { playSpriteAnimation } from "../shared/animationState";
import { playPlayerSound } from "../../audio/playerAudio";
import { playInfernoHit } from "./infernoAudio";
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
      playPlayerSound(scene, p, "draven-fireball");
    }
  } catch (_) {}

  const stop = () => {
    scene.events.off("update", updateListener);
    scene.events.off("presentation:reset", stop);
    p.off?.("attack:interrupted", stop);
    if (dbg) dbg.destroy();
  };
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
      stop();
    }
  };
  scene.events.on("update", updateListener);
  scene.events.once?.("presentation:reset", stop);
  p.once?.("attack:interrupted", stop);
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

// The explosion art (scripts/art/draven-pixel/fx.cjs) is 48 art pixels drawn
// at 2x; at this scale each art pixel is 2 world px and the fireball peaks
// around 56 px, small enough not to bury the struck player.
const EXPLOSION_SCALE = 1;
// Inferno impacts repeat on every damage tick, so they are smaller still.
const INFERNO_EXPLOSION_SCALE = 0.8;
const INFERNO = getResolvedCharacterSpecialConfig(NAME, "inferno");
const lastInfernoExplosion = new Map();

export function spawnExplosion(scene, x, y, owner = null, scale = EXPLOSION_SCALE) {
  const texture = teamColor(owner) === TEAM_RED && scene?.textures?.exists("draven-explosion-red") ? "draven-explosion-red" : "draven-explosion";
  try {
    if (!scene || !scene.add || !scene.textures?.exists(texture)) {
      return null;
    }
    const e = scene.add.sprite(x, y, texture);
    // The impact must sit above the struck actor, not behind their body.
    e.setDepth(RENDER_LAYERS.ATTACKS);
    e.setScale(scale);
    e.setAlpha(0.9);
    applyTeamVisual(e, owner);
    const destroy = () => {
      scene.events?.off("presentation:reset", destroy);
      scene.tweens?.killTweensOf?.(e);
      e.destroy();
    };
    scene.events?.once?.("presentation:reset", destroy);
    if (scene.anims?.exists(texture)) {
      // The art opens on the impact flash; there is no build-up to skip.
      e.anims.play({ key: texture, frameRate: 24 });
      e.once("animationcomplete", destroy);
    } else {
      // No animation defined; fade out and destroy for a minimal visual cue
      scene.tweens?.add({
        targets: e,
        alpha: 0,
        duration: 200,
        onComplete: destroy,
      });
    }
    return e;
  } catch (_) {
    return null;
  }
}

// Inferno damage ticks every special.inferno.damageTickMs per target; showing
// an impact on each one buries the target in fire. Each target shows at most
// one (smaller) explosion per special.inferno.explosionPulseMs.
export function spawnInfernoExplosion(scene, x, y, owner = null, target = null, now = Date.now()) {
  const key = target || `${Math.round(x / 32)}:${Math.round(y / 32)}`;
  const last = lastInfernoExplosion.get(key);
  if (last !== undefined && now - last < INFERNO.explosionPulseMs) return null;
  lastInfernoExplosion.set(key, now);
  if (lastInfernoExplosion.size > 64) {
    for (const [k, at] of lastInfernoExplosion) if (now - at >= INFERNO.explosionPulseMs) lastInfernoExplosion.delete(k);
  }
  playInfernoHit(scene, x, y);
  return spawnExplosion(scene, x, y, owner, INFERNO_EXPLOSION_SCALE);
}
