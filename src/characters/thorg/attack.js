import socket from "../../socket";

const RECT_W = 120;
const RECT_H = 60;
const DURATION = 380;
const DAMAGE_TICK_MS = 90;
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
  p._lockFlip = true;
  p._lockedFlipX = p.flipX;
  const unlockFlip = () => {
    if (p && p._lockFlip) {
      p._lockFlip = false;
      delete p._lockedFlipX;
    }
  };
  const attackId = makeId();
  const hitSet = new Set();

  // play simple throw animation if present
  if (
    scene.anims &&
    (scene.anims.exists("thorg-throw") || scene.anims.exists("throw"))
  ) {
    p.anims.play(
      scene.anims.exists("thorg-throw") ? "thorg-throw" : "throw",
      true
    );
  }

  // Visual SFX local-only
  try {
    if (scene.sound) {
      // Play both legacy thorg sound (if present) and the new release swoosh
      try {
        scene.sound.play("thorg-throw", { volume: 0.6 });
      } catch (_) {}
      try {
        scene.sound.play("swoosh", { volume: 0.5 });
      } catch (_) {}
    }
  } catch (e) {}

  // movement proxy t from 0->1
  let elapsed = 0;
  let dmgAccum = 0;
  const startX0 = p.x + (direction >= 0 ? 10 : -10);
  const startY0 = p.y - p.height * 0.5;
  const range = 140;
  const endX0 = startX0 + direction * range;
  const endY0 = p.y + 100; // drop much lower before dissipating
  const arcHeight = 120; // peak above start
  const curveMagnitude = 20;
  const samplePath = (t) => {
    const clamped = Phaser.Math.Clamp(t, 0, 1);
    const curve = Math.sin(Math.PI * clamped) * (curveMagnitude * direction);
    const x = Phaser.Math.Linear(startX0, endX0, clamped) + curve;
    const y =
      Phaser.Math.Linear(startY0, endY0, clamped) -
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

    const t = Math.min(1, elapsed / DURATION);
    const { x, y } = samplePath(t);

    // Damage ticks during flight
    if (dmgAccum >= DAMAGE_TICK_MS) {
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
            damage:
              (instance.constructor.getStats &&
                instance.constructor.getStats().damage) ||
              1,
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

    if (t >= 1) {
      scene.events.off("update", update);
      if (dbg) dbg.destroy();
      scene.time.delayedCall(80, unlockFlip);
    }
  };

  // Spawn a local visual 'bat' if texture exists. Do not show any hitbox by default.
  try {
    const texKey = scene.textures.exists("thorg-bat")
      ? "thorg-bat"
      : scene.textures.exists("thorg-weapon")
      ? "thorg-weapon"
      : null;
    if (texKey && scene.add) {
      const sprite = scene.add.sprite(startX0, startY0, texKey);
      sprite.setDepth(7);
      sprite.setScale(0.3);
      sprite.setFlipX(direction < 0);
      // Play animation name convention: 'thorg-bat-fly' or 'thorg-weapon-fly'
      const animName = `${texKey}-fly`;
      if (scene.anims && scene.anims.exists(animName)) {
        sprite.anims.play(animName);
      }
      const proxyVis = { t: 0 };
      // scale up over time
      scene.tweens.add({
        targets: sprite,
        scale: 1.25,
        duration: DURATION,
        ease: "Sine.easeOut",
      });
      scene.tweens.add({
        targets: proxyVis,
        t: 1,
        duration: DURATION,
        ease: "Sine.easeIn",
        onUpdate: () => {
          const pt = samplePath(proxyVis.t);
          sprite.x = pt.x;
          sprite.y = pt.y;
        },
        onComplete: () => sprite.destroy(),
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
