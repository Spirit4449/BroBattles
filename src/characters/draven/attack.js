// Draven splash attack extracted
import socket from "../../socket";
import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { rectsOverlap, getSpriteBounds } from "../shared/combatGeometry";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import { emitVaultHitForRect } from "../shared/vaultTargeting";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const SPLASH = getResolvedCharacterAttackConfig("draven", "splash");
const SPLASH_W = SPLASH.width;
const SPLASH_H = SPLASH.height;
const ACTIVE_WINDOW_MS = SPLASH.activeWindowMs;
const FLIP_UNLOCK_MS = SPLASH.flipUnlockMs;
const DAMAGE_TICK_MS = SPLASH.damageTickMs;
const DAMAGE_START_MS = SPLASH.damageStartMs;
const TIP_OFFSET = SPLASH.tipOffset;
const MIN_SPLASH_H = SPLASH.minHeight;
const GROW_DURATION_MS = SPLASH.growDurationMs;
const CENTER_Y_FACTOR = SPLASH.centerYFactor;
const HITBOX_INFLATE = SPLASH.hitboxInflate;
var DEBUG_DRAW = false; // Draw debug rectangle of current hitbox

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

  // Play attack animation if present
  if (
    scene.anims &&
    (scene.anims.exists("draven-throw") || scene.anims.exists("throw"))
  ) {
    p.anims.play(
      scene.anims.exists("draven-throw") ? "draven-throw" : "throw",
      true,
    );
  }

  // Debug visuals removed (box no longer drawn)
  // Continuous damage ticking within active window (owner only)
  let elapsed = 0;
  let dbg = null;
  if (DEBUG_DRAW && scene && scene.add) {
    dbg = scene.add.graphics();
    dbg.setDepth(RENDER_LAYERS.ATTACKS);
  }
  // Play fireball SFX (local-only)
  try {
    if (scene.sound) {
      scene.sound.play("draven-fireball", { volume: 0.4, rate: 1 });
    }
  } catch (_) {}

  const updateListener = () => {
    const dt = scene.game.loop.delta || 16;
    elapsed += dt;
    // Reinforce visual flip lock every frame
    enforceLockedFlip(p);
    if (DEBUG_DRAW && dbg) {
      dbg.clear();
      const growT = Phaser.Math.Clamp(
        elapsed / Math.max(1, GROW_DURATION_MS),
        0,
        1,
      );
      const currentHeight = MIN_SPLASH_H + (SPLASH_H - MIN_SPLASH_H) * growT;
      const centerX = p.x + direction * TIP_OFFSET;
      const baseCenterY = p.y - p.height * CENTER_Y_FACTOR;
      const finalBottom = baseCenterY + SPLASH_H / 2;
      dbg.fillStyle(0xff6f3c, 0.08);
      dbg.fillRect(
        centerX - SPLASH_W / 2,
        finalBottom - currentHeight,
        SPLASH_W,
        currentHeight,
      );
      dbg.lineStyle(2, 0xff9a4d, 0.92);
      dbg.strokeRect(
        centerX - SPLASH_W / 2,
        finalBottom - currentHeight,
        SPLASH_W,
        currentHeight,
      );
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

function applySplashDamage({
  scene,
  centerX,
  centerY,
  w,
  h,
  attacker,
  gameId,
  opponents,
  hitSet,
}) {
  // Server now owns the damage truth for Draven splash. Keep this helper
  // purely for optional local debug visualization without emitting hits.
  const inflate = HITBOX_INFLATE;
  const left = centerX - w / 2 - inflate;
  const right = centerX + w / 2 + inflate;
  const top = centerY - h / 2 - inflate;
  const bottom = centerY + h / 2 + inflate;
  if (DEBUG_DRAW) {
    const list = Object.values(opponents || {});
    for (const wrap of list) {
      const spr = wrap && wrap.opponent;
      if (!spr) continue;
      const bounds = getSpriteBounds(spr);
      rectsOverlap(
        left,
        top,
        right,
        bottom,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
      );
    }
  }
  return null;
}

export function spawnExplosion(scene, x, y) {
  try {
    if (!scene || !scene.add || !scene.textures?.exists("draven-explosion")) {
      return null;
    }
    const e = scene.add.sprite(x, y, "draven-explosion");
    e.setDepth(RENDER_LAYERS.ATTACKS);
    e.setScale(2.2);
    if (scene.anims?.exists("draven-explosion")) {
      e.anims.play("draven-explosion");
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

export function changeDebugState(state) {
  if (state) {
    DEBUG_DRAW = true;
  } else {
    DEBUG_DRAW = false;
  }
}
