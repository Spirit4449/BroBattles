// Draven splash attack extracted
import socket from "../../socket";

const SPLASH_W = 165;
const SPLASH_H = 130; // Tuned final max height
const ACTIVE_WINDOW_MS = 450; // Attack stays active this long (moving with player)
const FLIP_UNLOCK_MS = 530; // Facing locked for full active window
const DAMAGE_TICK_MS = 90; // Damage cadence
const DAMAGE_START_MS = 100; // Telegraph before any damage
const TIP_OFFSET = 50; // Horizontal distance from player center to splash center
const MIN_SPLASH_H = 20; // Initial small height for upward sweep
const GROW_DURATION_MS = 220; // Time over which the hitbox grows to full height
var DEBUG_DRAW = false; // Draw debug rectangle of current hitbox

// Rectangle overlap helper (inclusive edges)
function rectsOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

// Util to build unique id for correlating remote visuals (no gameplay authority)
function makeId() {
  return `dravenSplash_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function performDravenSplashAttack(instance) {
  const { scene, player: p, username, gameId, opponentPlayersRef } = instance;

  // Lock facing direction for the whole attack window
  const direction = p.flipX ? -1 : 1; // -1 = facing left, 1 = facing right
  p._lockFlip = true;
  p._lockedFlipX = p.flipX; // remember original orientation
  const unlockFlip = () => {
    if (p && p._lockFlip) {
      p._lockFlip = false;
      delete p._lockedFlipX;
    }
  };
  const attackId = makeId();
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
      scene.sound.play("draven-fireball", { volume: 0.4 });
    }
  } catch (_) {}

  const updateListener = () => {
    const dt = scene.game.loop.delta || 16;
    elapsed += dt;
    damageAccum += dt;
    // Reinforce visual flip lock every frame
    if (
      p._lockFlip &&
      p._lockedFlipX !== undefined &&
      p.flipX !== p._lockedFlipX
    ) {
      p.flipX = p._lockedFlipX;
      if (p.body && p.body.setOffset && typeof p._lockedFlipX === "boolean") {
        // Attempt to reapply any offset logic if provided by player script
        if (typeof p.scene !== "undefined" && p.scene.events) {
          // No direct accessor to applyFlipOffsetLocal here; player module enforces on change.
        }
      }
    }
    if (elapsed >= DAMAGE_START_MS && damageAccum >= DAMAGE_TICK_MS) {
      damageAccum = 0;
      // Dynamic center (moves with player) using locked direction
      const cx = p.x + (direction > 0 ? TIP_OFFSET : -TIP_OFFSET);
      const baseCenterY = p.y - p.height * 0.15; // original center reference
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
  // Splash rectangle bounds (slightly inflated so edge contacts count)
  const inflate = 6; // px padding to be more forgiving
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
    // Determine opponent bounds (prefer physics body for accuracy)
    let bx1, by1, bx2, by2;
    if (spr.body) {
      // Arcade body.x/y are top-left
      bx1 = spr.body.x;
      by1 = spr.body.y;
      bx2 = spr.body.x + spr.body.width;
      by2 = spr.body.y + spr.body.height;
    } else {
      // Fallback to approximate sprite rectangle using display size
      const halfW = (spr.displayWidth || spr.width || 0) / 2;
      const halfH = (spr.displayHeight || spr.height || 0) / 2;
      bx1 = spr.x - halfW;
      bx2 = spr.x + halfW;
      by1 = spr.y - halfH;
      by2 = spr.y + halfH;
    }
    if (rectsOverlap(left, top, right, bottom, bx1, by1, bx2, by2)) {
      if (hitSet) hitSet.add(name);
      socket.emit("hit", {
        attacker,
        target: name,
        attackType: "basic", // treat as basic attack damage
        attackTime: Date.now(),
        gameId,
      });
      hitAny = true;
      newHits.push({ x: (bx1 + bx2) / 2, y: (by1 + by2) / 2 + 4 });
      // Optional: tiny debug flash (comment out in production)
      // const flash = scene.add.rectangle((bx1+bx2)/2, (by1+by2)/2, 10, 10, 0xffd28a, 0.6);
      // scene.tweens.add({ targets: flash, alpha: 0, duration: 180, onComplete: ()=> flash.destroy() });
    }
  }
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
