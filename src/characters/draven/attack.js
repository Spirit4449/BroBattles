// Draven splash attack extracted
import socket from "../../socket";
import { getCharacterTuning } from "../../lib/characterStats.js";
import { rectsOverlap, getSpriteBounds } from "../shared/combatGeometry";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import { emitVaultHitForRect } from "../shared/vaultTargeting";
import {
  getChargeRatioFromContext,
  scaleByCharge,
} from "../shared/chargeAttack";

const DRAVEN_TUNING = getCharacterTuning("draven");
const SPLASH = DRAVEN_TUNING.attack?.splash || {};
const SPLASH_CHARGE = DRAVEN_TUNING.attack?.charge || {};
const SPLASH_W = SPLASH.width ?? 165;
const SPLASH_H = SPLASH.height ?? 130; // Tuned final max height
const ACTIVE_WINDOW_MS = SPLASH.activeWindowMs ?? 450; // Attack stays active this long (moving with player)
const FLIP_UNLOCK_MS = SPLASH.flipUnlockMs ?? 530; // Facing locked for full active window
const DAMAGE_TICK_MS = SPLASH.damageTickMs ?? 90; // Damage cadence
const DAMAGE_START_MS = SPLASH.damageStartMs ?? 100; // Telegraph before any damage
const TIP_OFFSET = SPLASH.tipOffset ?? 50; // Horizontal distance from player center to splash center
const MIN_SPLASH_H = SPLASH.minHeight ?? 20; // Initial small height for upward sweep
const GROW_DURATION_MS = SPLASH.growDurationMs ?? 220; // Time over which the hitbox grows to full height
const CENTER_Y_FACTOR = SPLASH.centerYFactor ?? 0.15;
const HITBOX_INFLATE = SPLASH.hitboxInflate ?? 6;
var DEBUG_DRAW = false; // Draw debug rectangle of current hitbox

export function performDravenSplashAttack(instance, attackContext = null) {
  const { scene, player: p, username, gameId, opponentPlayersRef } = instance;
  const chargeRatio = getChargeRatioFromContext(attackContext);

  // Lock facing direction for the whole attack window
  const direction = p.flipX ? -1 : 1; // -1 = facing left, 1 = facing right
  const unlockFlip = lockPlayerFlip(p); // remember original orientation
  const attackId = createRuntimeId("dravenSplash");
  // Track which opponents have already been hit (each only once per attack instance)
  const hitSet = new Set();

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
  let damageAccum = 0; // accumulator for tick scheduling
  let dbg = null;
  if (DEBUG_DRAW && scene && scene.add) {
    dbg = scene.add.graphics();
    dbg.setDepth(8);
  }
  // Play fireball SFX (local-only)
  try {
    if (scene.sound) {
      scene.sound.play("draven-fireball", {
        volume: scaleByCharge({
          baseValue: 0.4,
          chargeRatio,
          maxScale: SPLASH_CHARGE.audioVolumeMax || 1,
        }),
        rate: scaleByCharge({
          baseValue: 1,
          chargeRatio,
          maxScale: SPLASH_CHARGE.audioRateMax || 1,
        }),
      });
    }
  } catch (_) {}

  const updateListener = () => {
    const dt = scene.game.loop.delta || 16;
    elapsed += dt;
    damageAccum += dt;
    // Reinforce visual flip lock every frame
    enforceLockedFlip(p);
    if (elapsed >= DAMAGE_START_MS && damageAccum >= DAMAGE_TICK_MS) {
      damageAccum = 0;
      // Dynamic center (moves with player) using locked direction
      const cx = p.x + (direction > 0 ? TIP_OFFSET : -TIP_OFFSET);
      const baseCenterY = p.y - p.height * CENTER_Y_FACTOR; // original center reference
      const growT = Math.min(1, elapsed / GROW_DURATION_MS);
      const currentH = MIN_SPLASH_H + (SPLASH_H - MIN_SPLASH_H) * growT;
      const finalBottom = baseCenterY + SPLASH_H / 2; // anchor bottom at final position
      const rectTop = finalBottom - currentH; // grow upward by moving top upward
      const cy = (rectTop + finalBottom) / 2; // derived center for current rectangle
      const hitData = applySplashDamage({
        scene,
        centerX: cx,
        centerY: cy,
        w: SPLASH_W,
        h: currentH,
        chargeRatio,
        attacker: username,
        gameId,
        opponents: opponentPlayersRef,
        hitSet,
      });
      // For each newly hit target spawn an explosion immediately
      if (hitData && hitData.newHits && hitData.newHits.length) {
        for (const h of hitData.newHits) {
          spawnExplosion(scene, h.x, h.y);
          socket.emit("game:action", {
            type: "draven-splash-explode",
            id: attackId,
            x: h.x,
            y: h.y,
            attacker: username,
          });
        }
      }
      if (DEBUG_DRAW && dbg) {
        dbg.clear();
        dbg.lineStyle(2, 0xffd28a, 0.9);
        dbg.fillStyle(0xffd28a, 0.15);
        const left = cx - SPLASH_W / 2;
        dbg.strokeRect(left, rectTop, SPLASH_W, currentH);
        dbg.fillRect(left, rectTop, SPLASH_W, currentH);
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
    chargeRatio,
  };
}

function applySplashDamage({
  scene,
  centerX,
  centerY,
  w,
  h,
  chargeRatio,
  attacker,
  gameId,
  opponents,
  hitSet,
}) {
  // Splash rectangle bounds (slightly inflated so edge contacts count)
  const inflate = HITBOX_INFLATE; // px padding to be more forgiving
  const left = centerX - w / 2 - inflate;
  const right = centerX + w / 2 + inflate;
  const top = centerY - h / 2 - inflate;
  const bottom = centerY + h / 2 + inflate;
  const list = Object.values(opponents || {});
  let hitAny = false;
  const newHits = [];
  for (const wrap of list) {
    const spr = wrap && wrap.opponent;
    const name = wrap && wrap.username;
    if (!spr || !name || (hitSet && hitSet.has(name))) continue;
    const bounds = getSpriteBounds(spr);
    if (
      rectsOverlap(
        left,
        top,
        right,
        bottom,
        bounds.left,
        bounds.top,
        bounds.right,
        bounds.bottom,
      )
    ) {
      if (hitSet) hitSet.add(name);
      socket.emit("hit", {
        attacker,
        target: name,
        attackType: "basic", // treat as basic attack damage
        chargeRatio,
        attackTime: Date.now(),
        gameId,
      });
      hitAny = true;
      newHits.push({
        x: (bounds.left + bounds.right) / 2,
        y: (bounds.top + bounds.bottom) / 2 + 4,
      });
      // Optional: tiny debug flash (comment out in production)
      // const flash = scene.add.rectangle((bx1+bx2)/2, (by1+by2)/2, 10, 10, 0xffd28a, 0.6);
      // scene.tweens.add({ targets: flash, alpha: 0, duration: 180, onComplete: ()=> flash.destroy() });
    }
  }
  emitVaultHitForRect({
    attacker,
    left,
    top,
    right,
    bottom,
    attackType: "basic",
    chargeRatio,
    gameId,
    hitSet,
  });
  if (hitAny) {
    try {
      scene.sound.play("draven-hit", { volume: 0.8 });
    } catch (_) {}
    return { newHits };
  }
  return null;
}

export function spawnExplosion(scene, x, y) {
  try {
    if (!scene || !scene.add || !scene.textures?.exists("draven-explosion")) {
      return null;
    }
    const e = scene.add.sprite(x, y, "draven-explosion");
    e.setDepth(9);
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
