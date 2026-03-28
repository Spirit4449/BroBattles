import { getResolvedCharacterAttackConfig } from "../../lib/characterTuning.js";
import { rectsOverlap, getSpriteBounds } from "../shared/combatGeometry";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import {
  buildThrowArcGeometry,
  sampleThrowArcPoint,
} from "../shared/attackAim";

const FALL = getResolvedCharacterAttackConfig("thorg", "fall");

const RECT_W = FALL.rectWidth;
const RECT_H = FALL.rectHeight;
export const THORG_FALL_WINDUP_MS = FALL.windupMs;
export const THORG_FALL_STRIKE_MS = FALL.strikeMs;
export const THORG_FALL_DURATION_MS =
  THORG_FALL_WINDUP_MS + THORG_FALL_STRIKE_MS;
export const THORG_FALL_FOLLOW_AFTER_WINDUP_MS = FALL.followAfterWindupMs;
export const THORG_FALL_RANGE = FALL.range;
export const THORG_FALL_ARC_HEIGHT = FALL.arcHeight;
export const THORG_FALL_CURVE_MAGNITUDE = FALL.curveMagnitude;
export const THORG_FALL_END_Y_OFFSET = FALL.endYOffset;
const DAMAGE_TICK_MS = FALL.damageTickMs;
const HITBOX_INFLATE = FALL.hitboxInflate;
const SPRITE_FORWARD_OFFSET = FALL.spriteForwardOffset;
const ORIGIN_OFFSET_X = FALL.originOffsetX;
const ORIGIN_HEIGHT_FACTOR = FALL.originHeightFactor;
const START_OFFSET_X = FALL.startOffsetX;
const START_OFFSET_Y = FALL.startOffsetY;
let DEBUG_DRAW = false;

export function performThorgFallAttack(instance, attackContext = null) {
  const { scene, player: p, username, gameId, opponentPlayersRef } = instance;
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
  const rageActive = !!p._thorgRageActive;
  const baseAngle = 0;
  const range = Math.max(1, Number(context?.range) || THORG_FALL_RANGE);
  const speedScale = Math.max(0.85, Number(context?.speedScale) || 1);
  const strikeMs = Math.max(180, Math.round(THORG_FALL_STRIKE_MS / speedScale));
  const totalDurationMs = THORG_FALL_WINDUP_MS + strikeMs;
  const targetX = Number(context?.targetX);
  const targetY = Number(context?.targetY);

  if (typeof p._thorgAttackCleanup === "function") {
    try {
      p._thorgAttackCleanup();
    } catch (_) {}
  }

  let finished = false;
  const baseUnlockFlip = lockPlayerFlip(p);
  const unlockFlip = (force = false) => {
    if (finished && !force) return;
    finished = true;
    baseUnlockFlip();
    if (p) delete p._thorgAttackCleanup;
    if (p && p.active) p.setAngle(0);
  };
  p._thorgAttackCleanup = () => unlockFlip(true);
  const attackId = createRuntimeId("thorgFall");
  const hitSet = new Set();

  // play simple throw animation if present
  if (scene.anims) {
    if (scene.anims.exists("thorg-throw")) p.anims.play("thorg-throw", true);
    else if (scene.anims.exists("throw")) p.anims.play("throw", true);
  }

  // Visual SFX local-only
  try {
    if (scene.sound) {
      // Play both legacy thorg sound (if present) and the new release swoosh
      try {
        scene.sound.play("thorg-throw", { volume: 0.6 });
      } catch (_) {}
      // Swoosh plays on impact below, not at lift start.
    }
  } catch (e) {}

  // movement proxy t from 0->1
  let elapsed = 0;
  let dmgAccum = 0;
  let strikeStarted = false;
  const getAnchor = () => ({
    x: p.x + Math.cos(angle) * ORIGIN_OFFSET_X,
    y: p.y - p.height * ORIGIN_HEIGHT_FACTOR,
  });
  let strikeGeometry = null;
  const resolvePathRotation = (progress, fallbackRotation = 0) => {
    const tNow = Phaser.Math.Clamp(progress, 0, 1);
    const delta = 0.04;
    const from =
      tNow >= 1 - delta
        ? samplePath(Math.max(0, tNow - delta))
        : samplePath(tNow);
    const to =
      tNow >= 1 - delta
        ? samplePath(tNow)
        : samplePath(Math.min(1, tNow + delta));
    const dx = Number(to?.x) - Number(from?.x);
    const dy = Number(to?.y) - Number(from?.y);
    if (Math.abs(dx) < 0.001 && Math.abs(dy) < 0.001) {
      return fallbackRotation;
    }
    return Math.atan2(dy, dx) + direction * 0.1 + SPRITE_FORWARD_OFFSET;
  };
  const resolveStrikePath = () => {
    const a = getAnchor();
    strikeGeometry = buildThrowArcGeometry({
      originX: a.x,
      originY: a.y,
      angle,
      range,
      targetX: Number.isFinite(targetX) ? targetX : null,
      targetY: Number.isFinite(targetY) ? targetY : null,
      startBackOffset: Math.abs(Number(START_OFFSET_X) || 0),
      startLiftY: START_OFFSET_Y,
      endDropY: THORG_FALL_END_Y_OFFSET,
      arcHeight: THORG_FALL_ARC_HEIGHT,
      curveMagnitude: THORG_FALL_CURVE_MAGNITUDE,
      samples: 28,
    });
  };
  const samplePath = (t) =>
    strikeGeometry
      ? sampleThrowArcPoint(strikeGeometry, t)
      : { x: p.x, y: p.y };
  resolveStrikePath();
  let dbg = null;

  const update = () => {
    const dt = scene.game.loop.delta || 16;
    elapsed += dt;
    dmgAccum += dt;
    // enforce flip lock
    enforceLockedFlip(p);

    const strikeElapsed = Math.max(0, elapsed - THORG_FALL_WINDUP_MS);
    const t = Math.min(1, strikeElapsed / strikeMs);
    const { x, y } = samplePath(t);

    // Windup lean: pull torso back before release so it doesn't feel static.
    if (!strikeStarted) {
      const windupT = Phaser.Math.Clamp(elapsed / THORG_FALL_WINDUP_MS, 0, 1);
      const leanDeg = Phaser.Math.Linear(0, -8 * direction, windupT);
      p.setAngle(baseAngle + leanDeg);
    }

    if (!strikeStarted && elapsed >= THORG_FALL_WINDUP_MS) {
      strikeStarted = true;
      resolveStrikePath();
      p.setAngle(baseAngle + 4 * direction);
      try {
        if (scene.sound) scene.sound.play("swoosh", { volume: 0.5 });
      } catch (_) {}
    }

    // Damage ticks during flight
    if (strikeStarted && dmgAccum >= DAMAGE_TICK_MS) {
      dmgAccum = 0;
      const left = x - RECT_W / 2 - HITBOX_INFLATE;
      const right = x + RECT_W / 2 + HITBOX_INFLATE;
      const top = y - RECT_H / 2 - HITBOX_INFLATE;
      const bottom = y + RECT_H / 2 + HITBOX_INFLATE;
      const list = Object.values(opponentPlayersRef || {});
      for (const wrap of list) {
        const spr = wrap && wrap.opponent;
        const name = wrap && wrap.username;
        if (!spr || !name || hitSet.has(name)) continue;
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
          // Server now owns Thorg hit truth. We only track overlaps locally so
          // the same target is not repeatedly treated as "fresh" by visuals.
          hitSet.add(name);
        }
      }
    }

    if (DEBUG_DRAW) {
      try {
        if (!dbg && scene.add) {
          dbg = scene.add.graphics();
          dbg.setDepth(9);
        }
        if (dbg) {
          dbg.clear();
          dbg.lineStyle(2, 0xff0000, 0.9);
          dbg.strokeRect(x - RECT_W / 2, y - RECT_H / 2, RECT_W, RECT_H);
        }
      } catch (_) {}
    }

    if (elapsed >= totalDurationMs) {
      scene.events.off("update", update);
      if (dbg) dbg.destroy();
      p.setAngle(baseAngle);
      scene.time.delayedCall(80, unlockFlip);
    }
  };

  // Spawn a local visual 'bat' if texture exists. Do not show any hitbox by default.
  try {
    const startAnchor = getAnchor();
    const texKey = scene.textures.exists("thorg-bat")
      ? "thorg-bat"
      : scene.textures.exists("thorg-weapon")
        ? "thorg-weapon"
        : null;
    if (texKey && scene.add) {
      const sprite = scene.add.sprite(startAnchor.x, startAnchor.y, texKey);
      sprite.setDepth(7);
      sprite.setScale(rageActive ? 0.82 : 0.72);
      sprite.setFlipX(false);
      const baseRot = angle + SPRITE_FORWARD_OFFSET + direction * 0.08;
      const windupRot = baseRot - direction * 0.35;
      sprite.rotation = baseRot;
      // Play animation name convention: 'thorg-bat-fly' or 'thorg-weapon-fly'
      const animName = `${texKey}-fly`;
      if (scene.anims && scene.anims.exists(animName)) {
        sprite.anims.play(animName);
      }
      scene.tweens.add({
        targets: sprite,
        scale: rageActive ? 1.34 : 1.16,
        duration: strikeMs,
        delay: THORG_FALL_WINDUP_MS,
        ease: "Sine.easeOut",
      });
      let visualCleanupStarted = false;
      const cleanupVisual = () => {
        if (visualCleanupStarted) return;
        visualCleanupStarted = true;
        scene.events.off("update", renderVis);
        if (!sprite.active) return;
        scene.tweens?.add({
          targets: sprite,
          alpha: 0,
          scaleX: sprite.scaleX * 0.72,
          scaleY: sprite.scaleY * 0.72,
          duration: 160,
          ease: "Quad.easeOut",
          onComplete: () => {
            if (sprite.active) sprite.destroy();
          },
        });
      };

      const renderVis = () => {
        if (!sprite.active) return;
        if (!strikeStarted) {
          const windupT = Phaser.Math.Clamp(
            elapsed / THORG_FALL_WINDUP_MS,
            0,
            1,
          );
          const followAnchor = getAnchor();
          const windupBackX = followAnchor.x - direction * 18;
          const windupBackY = followAnchor.y - 12;
          sprite.x = Phaser.Math.Linear(followAnchor.x, windupBackX, windupT);
          sprite.y = Phaser.Math.Linear(followAnchor.y, windupBackY, windupT);
          sprite.rotation = Phaser.Math.Linear(baseRot, windupRot, windupT);
          return;
        }

        const strikeElapsed = Math.max(0, elapsed - THORG_FALL_WINDUP_MS);
        const tNow = Phaser.Math.Clamp(
          strikeElapsed / strikeMs,
          0,
          1,
        );
        if (
          elapsed <=
          THORG_FALL_WINDUP_MS + THORG_FALL_FOLLOW_AFTER_WINDUP_MS
        ) {
          resolveStrikePath();
        }
        const pt = samplePath(tNow);
        sprite.x = pt.x;
        sprite.y = pt.y;
        sprite.rotation = resolvePathRotation(tNow, sprite.rotation);
      };

      scene.events.on("update", renderVis);
      scene.time.delayedCall(totalDurationMs + 10, cleanupVisual);
    }
  } catch (e) {
    // ignore visual failures
  }

  scene.events.on("update", update);

  return {
    type: "thorg-fall",
    id: attackId,
    direction,
    angle,
    range,
    target: Number.isFinite(targetX) && Number.isFinite(targetY)
      ? { x: targetX, y: targetY }
      : null,
    strikeMs,
    duration: totalDurationMs,
  };
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
}
