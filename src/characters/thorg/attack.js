import socket from "../../socket";

const RECT_W = 120;
const RECT_H = 60;
const WINDUP_MS = 180;
const STRIKE_MS = 290;
const DURATION = WINDUP_MS + STRIKE_MS;
const FOLLOW_AFTER_WINDUP_MS = 70;
const DAMAGE_TICK_MS = 90;
const SPRITE_FORWARD_OFFSET = -Math.PI / 2; // weapon art points downward at rotation=0
let DEBUG_DRAW = false;

function rectsOverlap(ax1, ay1, ax2, ay2, bx1, by1, bx2, by2) {
  return ax1 <= bx2 && ax2 >= bx1 && ay1 <= by2 && ay2 >= by1;
}

function makeId() {
  return `thorgFall_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
}

export function performThorgFallAttack(instance) {
  const { scene, player: p, username, gameId, opponentPlayersRef } = instance;
  const direction = p.flipX ? -1 : 1;
  const rageActive = !!p._thorgRageActive;
  const baseAngle = p.angle || 0;
  p._lockFlip = true;
  p._lockedFlipX = p.flipX;
  const unlockFlip = () => {
    if (p && p._lockFlip) {
      p._lockFlip = false;
      delete p._lockedFlipX;
    }
    if (p && p.active) p.setAngle(baseAngle);
  };
  const attackId = makeId();
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
  const range = 110;
  let endX0 = 0;
  let endY0 = 0;
  const arcHeight = 120; // peak above start
  const curveMagnitude = 20;
  const resolveStrikePath = () => {
    const a = getAnchor();
    strikeStartX = a.x - direction * 14;
    strikeStartY = a.y - 8;
    endX0 = strikeStartX + direction * range;
    endY0 = a.y + 100;
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
    if (
      p._lockFlip &&
      p._lockedFlipX !== undefined &&
      p.flipX !== p._lockedFlipX
    ) {
      p.flipX = p._lockedFlipX;
    }

    const strikeElapsed = Math.max(0, elapsed - WINDUP_MS);
    const t = Math.min(1, strikeElapsed / STRIKE_MS);
    const { x, y } = samplePath(t);

    // Windup lean: pull torso back before release so it doesn't feel static.
    if (!strikeStarted) {
      const windupT = Phaser.Math.Clamp(elapsed / WINDUP_MS, 0, 1);
      const leanDeg = Phaser.Math.Linear(0, -8 * direction, windupT);
      p.setAngle(baseAngle + leanDeg);
    }

    if (!strikeStarted && elapsed >= WINDUP_MS) {
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
        let bx1, by1, bx2, by2;
        if (spr.body) {
          bx1 = spr.body.x;
          by1 = spr.body.y;
          bx2 = spr.body.x + spr.body.width;
          by2 = spr.body.y + spr.body.height;
        } else {
          const halfW = (spr.displayWidth || spr.width || 0) / 2;
          const halfH = (spr.displayHeight || spr.height || 0) / 2;
          bx1 = spr.x - halfW;
          bx2 = spr.x + halfW;
          by1 = spr.y - halfH;
          by2 = spr.y + halfH;
        }
        if (rectsOverlap(left, top, right, bottom, bx1, by1, bx2, by2)) {
          hitSet.add(name);
          socket.emit("hit", {
            attacker: username,
            target: name,
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

    if (elapsed >= DURATION) {
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
        duration: STRIKE_MS,
        delay: WINDUP_MS,
        ease: "Sine.easeOut",
      });

      const renderVis = () => {
        if (!sprite.active) return;
        if (!strikeStarted) {
          const windupT = Phaser.Math.Clamp(elapsed / WINDUP_MS, 0, 1);
          const followAnchor = getAnchor();
          const windupBackX = followAnchor.x - direction * 18;
          const windupBackY = followAnchor.y - 12;
          sprite.x = Phaser.Math.Linear(followAnchor.x, windupBackX, windupT);
          sprite.y = Phaser.Math.Linear(followAnchor.y, windupBackY, windupT);
          sprite.rotation = Phaser.Math.Linear(baseRot, windupRot, windupT);
          return;
        }

        const strikeElapsed = Math.max(0, elapsed - WINDUP_MS);
        const tNow = Phaser.Math.Clamp(strikeElapsed / STRIKE_MS, 0, 1);
        if (elapsed <= WINDUP_MS + FOLLOW_AFTER_WINDUP_MS) {
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
      scene.time.delayedCall(DURATION + 30, () => {
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
  };
}

export function changeDebugState(state) {
  DEBUG_DRAW = !!state;
}
