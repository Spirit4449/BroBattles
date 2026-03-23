import socket from "../../socket";
import { getCharacterTuning } from "../../lib/characterStats.js";
import { rectsOverlap, getSpriteBounds } from "../shared/combatGeometry";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip, enforceLockedFlip } from "../shared/flipLock";
import {
  getChargeRatioFromContext,
  scaleByCharge,
} from "../shared/chargeAttack";

const THORG_TUNING = getCharacterTuning("thorg");
const FALL = THORG_TUNING.attack?.fall || {};
const FALL_CHARGE = THORG_TUNING.attack?.charge || {};

const RECT_W = FALL.rectWidth ?? 120;
const RECT_H = FALL.rectHeight ?? 60;
export const THORG_FALL_WINDUP_MS = FALL.windupMs ?? 180;
export const THORG_FALL_STRIKE_MS = FALL.strikeMs ?? 290;
export const THORG_FALL_DURATION_MS =
  THORG_FALL_WINDUP_MS + THORG_FALL_STRIKE_MS;
export const THORG_FALL_FOLLOW_AFTER_WINDUP_MS = FALL.followAfterWindupMs ?? 70;
export const THORG_FALL_RANGE = FALL.range ?? 120;
export const THORG_FALL_ARC_HEIGHT = FALL.arcHeight ?? 120;
export const THORG_FALL_CURVE_MAGNITUDE = FALL.curveMagnitude ?? 20;
export const THORG_FALL_END_Y_OFFSET = FALL.endYOffset ?? 300;
const DAMAGE_TICK_MS = FALL.damageTickMs ?? 90;
const SPRITE_FORWARD_OFFSET = FALL.spriteForwardOffset ?? -Math.PI / 2; // weapon art points downward at rotation=0
let DEBUG_DRAW = false;

export function performThorgFallAttack(instance, attackContext = null) {
  const { scene, player: p, username, gameId, opponentPlayersRef } = instance;
  const direction = p.flipX ? -1 : 1;
  const chargeRatio = getChargeRatioFromContext(attackContext);
  const rageActive = !!p._thorgRageActive;
  const baseAngle = 0;

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
    x: p.x + (direction >= 0 ? 10 : -10),
    y: p.y - p.height * 0.5,
  });
  let strikeStartX = 0;
  let strikeStartY = 0;
  const range = scaleByCharge({
    baseValue: THORG_FALL_RANGE,
    chargeRatio,
    maxScale: FALL_CHARGE.rangeScaleMax || 1,
  });
  let endX0 = 0;
  let endY0 = 0;
  const arcHeight = THORG_FALL_ARC_HEIGHT; // peak above start
  const curveMagnitude = THORG_FALL_CURVE_MAGNITUDE;
  const resolveStrikePath = () => {
    const a = getAnchor();
    strikeStartX = a.x - direction * 14;
    strikeStartY = a.y - 8;
    endX0 = strikeStartX + direction * range;
    endY0 = a.y + THORG_FALL_END_Y_OFFSET;
  };
  const samplePath = (t) => {
    const clamped = Phaser.Math.Clamp(t, 0, 1);
    const curve = Math.sin(Math.PI * clamped) * (curveMagnitude * direction);
    const x = Phaser.Math.Linear(strikeStartX, endX0, clamped) + curve;
    const y =
      Phaser.Math.Linear(strikeStartY, endY0, clamped) -
      arcHeight * Math.sin(Math.PI * clamped);
    return { x, y };
  };
  let dbg = null;

  const update = () => {
    const dt = scene.game.loop.delta || 16;
    elapsed += dt;
    dmgAccum += dt;
    // enforce flip lock
    enforceLockedFlip(p);

    const strikeElapsed = Math.max(0, elapsed - THORG_FALL_WINDUP_MS);
    const t = Math.min(1, strikeElapsed / THORG_FALL_STRIKE_MS);
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
      const left = x - RECT_W / 2 - 6;
      const right = x + RECT_W / 2 + 6;
      const top = y - RECT_H / 2 - 6;
      const bottom = y + RECT_H / 2 + 6;
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
          hitSet.add(name);
          socket.emit("hit", {
            attacker: username,
            target: name,
            chargeRatio,
            attackTime: Date.now(),
            gameId,
          });
          try {
            if (scene.sound) scene.sound.play("thorg-hit", { volume: 0.8 });
          } catch (_) {}
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

    if (elapsed >= THORG_FALL_DURATION_MS) {
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
      const baseAim = direction >= 0 ? 0 : Math.PI;
      const baseRot = baseAim + SPRITE_FORWARD_OFFSET + direction * 0.08;
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
        duration: THORG_FALL_STRIKE_MS,
        delay: THORG_FALL_WINDUP_MS,
        ease: "Sine.easeOut",
      });

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
          strikeElapsed / THORG_FALL_STRIKE_MS,
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
        const nextPt = samplePath(Math.min(1, tNow + 0.035));
        sprite.x = pt.x;
        sprite.y = pt.y;
        const targetRot =
          Math.atan2(nextPt.y - pt.y, nextPt.x - pt.x) +
          direction * 0.1 +
          SPRITE_FORWARD_OFFSET;
        // Use half-strength rotation so it doesn't spin/tilt too far.
        const delta = Phaser.Math.Angle.Wrap(targetRot - baseRot);
        sprite.rotation = baseRot + delta * 0.5;
      };

      scene.events.on("update", renderVis);
      scene.time.delayedCall(THORG_FALL_DURATION_MS + 30, () => {
        scene.events.off("update", renderVis);
        if (sprite.active) sprite.destroy();
      });
    }
  } catch (e) {
    // ignore visual failures
  }

  scene.events.on("update", update);

  return {
    type: "thorg-fall",
    id: attackId,
    direction,
    range,
    chargeRatio,
  };
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
}
