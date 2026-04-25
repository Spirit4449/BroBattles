import { getResolvedCharacterSpecialConfig } from "../../lib/characterTuning.js";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const NAME = "gloop";
const HOOK = getResolvedCharacterSpecialConfig(NAME, "hook");
const ACTIVE_HOOK_VISUALS = new WeakMap();

function playSpecialAnimation(scene, player) {
  if (!scene?.anims || !player?.anims) return;
  try {
    if (scene.anims.exists(`${NAME}-special`)) {
      player.anims.play(`${NAME}-special`, true);
    } else if (scene.anims.exists(`${NAME}-throw`)) {
      player.anims.play(`${NAME}-throw`, true);
    }
  } catch (_) {}
}

function resolveAngle(player, specialData = null) {
  if (Number.isFinite(Number(specialData?.angle))) {
    return Number(specialData.angle);
  }
  const direction = Number(specialData?.direction) === -1 ? -1 : 1;
  return direction < 0 || player?.flipX ? Math.PI : 0;
}

function resolveStart(player, angle) {
  const width = player?.displayWidth || player?.width || 80;
  const height = player?.displayHeight || player?.height || 100;
  return {
    x: (player?.x || 0) + Math.cos(angle) * width * 0.28,
    y: (player?.y || 0) - height * 0.12,
  };
}

function resolveActionStart(player, specialData = null, angle = 0) {
  const sx = Number(specialData?.start?.x);
  const sy = Number(specialData?.start?.y);
  if (Number.isFinite(sx) && Number.isFinite(sy)) {
    return { x: sx, y: sy };
  }
  return resolveStart(player, angle);
}

function resolveHandTextureKey(scene, variant = "open") {
  const wantClosed = String(variant || "").toLowerCase() === "closed";
  if (wantClosed && scene?.textures?.exists(`${NAME}-hand-closed`)) {
    return `${NAME}-hand-closed`;
  }
  if (!wantClosed && scene?.textures?.exists(`${NAME}-hand-open`)) {
    return `${NAME}-hand-open`;
  }
  if (scene?.textures?.exists(`${NAME}-hand`)) {
    return `${NAME}-hand`;
  }
  return null;
}

function createHand(scene, x, y, angle, scale, variant = "open") {
  const key = resolveHandTextureKey(scene, variant);
  const hand = key
    ? scene.add.sprite(x, y, key)
    : scene.add.ellipse(x, y, 44, 26, 0x72f0ff, 0.9);
  hand.setDepth(RENDER_LAYERS.ATTACKS + 9);
  if (hand.setScale) hand.setScale(Math.max(0.05, Number(scale) || 0.28));
  if (hand.setRotation) hand.setRotation(angle);
  if (hand.setTint) hand.setTint(0x98f5ff);
  return hand;
}

function spawnTrailDot(scene, x, y, alpha = 0.72, intensity = "normal") {
  const heavy = String(intensity).toLowerCase() === "heavy";
  const count = heavy ? 2 : 1;
  for (let i = 0; i < count; i += 1) {
    const dot = scene.add.circle(
      x + Phaser.Math.Between(heavy ? -7 : -4, heavy ? 7 : 4),
      y + Phaser.Math.Between(heavy ? -7 : -4, heavy ? 7 : 4),
      Phaser.Math.FloatBetween(heavy ? 4.2 : 3.2, heavy ? 7.8 : 6.2),
      Phaser.Math.RND.pick([0x55c7ff, 0x87f6ff, 0x2d9cff, 0xb7f6ff]),
      alpha,
    );
    dot.setDepth(RENDER_LAYERS.ATTACKS + 3);
    dot.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: dot,
      alpha: 0,
      scaleX: heavy ? 0.28 : 0.35,
      scaleY: heavy ? 0.28 : 0.35,
      duration: Phaser.Math.Between(heavy ? 240 : 220, heavy ? 420 : 340),
      ease: "Quad.easeOut",
      onComplete: () => dot.destroy(),
    });
  }
}

function cleanupHookVisual(ownerPlayer, visual) {
  try {
    visual?.travelTween?.stop?.();
  } catch (_) {}
  try {
    visual?.returnTween?.stop?.();
  } catch (_) {}
  try {
    visual?.hand?.destroy?.();
    visual?.tether?.destroy?.();
  } catch (_) {}
  if (ownerPlayer) {
    const current = ACTIVE_HOOK_VISUALS.get(ownerPlayer);
    if (current === visual) ACTIVE_HOOK_VISUALS.delete(ownerPlayer);
  }
}

function setHandVariant(scene, hand, variant = "open") {
  if (!hand?.setTexture) return;
  const key = resolveHandTextureKey(scene, variant);
  if (!key || hand.texture?.key === key) return;
  try {
    hand.setTexture(key);
  } catch (_) {}
}

export function playHookAction(
  scene,
  player,
  specialData = null,
  isOwner = false,
) {
  if (!scene?.add || !player?.active) return;
  try {
    scene.sound?.play?.("gloop-special", {
      volume: isOwner ? 0.68 : 0.38,
    });
  } catch (_) {}
  const angle = resolveAngle(player, specialData);
  const range = Math.max(
    1,
    Number(specialData?.range) || Number(HOOK.range) || 780,
  );
  const speed = Math.max(
    1,
    Number(specialData?.speed) || Number(HOOK.speed) || 900,
  );
  const start = resolveActionStart(player, specialData, angle);
  const end = {
    x: start.x + Math.cos(angle) * range,
    y: start.y + Math.sin(angle) * range,
  };
  const outMs = Math.max(120, Math.round((range / speed) * 1000));
  const retractMs = Math.max(120, Math.round(outMs * 0.45));
  const hand = createHand(
    scene,
    start.x,
    start.y,
    angle,
    Number(HOOK.visualScale) || 0.28,
    "open",
  );
  const tether = scene.add.graphics();
  tether.setDepth(RENDER_LAYERS.ATTACKS + 4);
  tether.setBlendMode(Phaser.BlendModes.ADD);

  const drawTether = () => {
    if (!hand?.active || !tether?.active) return;
    tether.clear();
    tether.lineStyle(12, 0x55c7ff, isOwner ? 0.55 : 0.4);
    tether.beginPath();
    tether.moveTo(start.x, start.y);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
    tether.lineStyle(4, 0xd8fbff, isOwner ? 0.95 : 0.72);
    tether.beginPath();
    tether.moveTo(start.x, start.y);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
  };

  let nextTrailAt = 0;
  const travel = scene.tweens.add({
    targets: hand,
    x: end.x,
    y: end.y,
    duration: outMs,
    ease: "Cubic.easeOut",
    onUpdate: () => {
      drawTether();
      const now = scene.time?.now || 0;
      if (now >= nextTrailAt) {
        nextTrailAt = now + Math.max(14, Number(HOOK.trailIntervalMs) || 24);
        spawnTrailDot(scene, hand.x, hand.y, 0.86, "heavy");
      }
    },
    onComplete: () => {
      const returnTween = scene.tweens.add({
        targets: hand,
        x: start.x,
        y: start.y,
        alpha: 0.35,
        duration: retractMs,
        ease: "Sine.easeIn",
        onUpdate: drawTether,
        onComplete: () => {
          try {
            cleanupHookVisual(player, ACTIVE_HOOK_VISUALS.get(player));
          } catch (_) {}
        },
      });
      const visual = ACTIVE_HOOK_VISUALS.get(player);
      if (visual) visual.returnTween = returnTween;
    },
  });

  const visual = {
    hand,
    tether,
    drawTether,
    start,
    owner: player,
    travelTween: travel,
    returnTween: null,
    phase: "out",
  };
  ACTIVE_HOOK_VISUALS.set(player, visual);

  hand.once("destroy", () => {
    try {
      travel?.remove?.();
      tether?.destroy?.();
    } catch (_) {}
    const current = ACTIVE_HOOK_VISUALS.get(player);
    if (current?.hand === hand) {
      ACTIVE_HOOK_VISUALS.delete(player);
    }
  });
}

export function playHookCatchAction(
  scene,
  ownerPlayer,
  actionData = null,
  isOwner = false,
) {
  if (!scene?.add || !ownerPlayer?.active) return;
  try {
    scene.sound?.play?.("gloop-pull", {
      volume: isOwner ? 0.62 : 0.36,
    });
  } catch (_) {}
  const startX = Number(actionData?.start?.x);
  const startY = Number(actionData?.start?.y);
  const endX = Number(actionData?.end?.x);
  const endY = Number(actionData?.end?.y);
  if (!Number.isFinite(startX) || !Number.isFinite(startY)) return;
  if (!Number.isFinite(endX) || !Number.isFinite(endY)) return;
  const pullDurationMs = Math.max(
    100,
    Number(actionData?.pullDurationMs) || 640,
  );
  const angle = Math.atan2(endY - startY, endX - startX);
  let visual = ACTIVE_HOOK_VISUALS.get(ownerPlayer);
  let hand = visual?.hand || null;
  let tether = visual?.tether || null;

  if (!hand?.active || !tether?.active) {
    hand = createHand(
      scene,
      startX,
      startY,
      angle,
      Number(HOOK.visualScale) || 0.28,
      "closed",
    );
    tether = scene.add.graphics();
    tether.setDepth(RENDER_LAYERS.ATTACKS + 4);
    tether.setBlendMode(Phaser.BlendModes.ADD);
    visual = {
      hand,
      tether,
      owner: ownerPlayer,
      start: { x: startX, y: startY },
      drawTether: null,
      travelTween: null,
      returnTween: null,
      phase: "catch",
    };
    ACTIVE_HOOK_VISUALS.set(ownerPlayer, visual);
  }

  visual.start = { x: startX, y: startY };
  setHandVariant(scene, hand, "closed");
  try {
    visual?.travelTween?.stop?.();
    visual?.returnTween?.stop?.();
  } catch (_) {}

  const drawTether = () => {
    if (!hand?.active || !tether?.active) return;
    tether.clear();
    tether.lineStyle(13, 0x55c7ff, isOwner ? 0.58 : 0.44);
    tether.beginPath();
    tether.moveTo(startX, startY);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
    tether.lineStyle(4, 0xd8fbff, isOwner ? 0.95 : 0.74);
    tether.beginPath();
    tether.moveTo(startX, startY);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
  };
  visual.drawTether = drawTether;
  visual.phase = "catch";

  if (hand?.setRotation) hand.setRotation(angle);
  drawTether();

  let nextTrailAt = 0;
  const pauseMs = Math.max(40, Number(HOOK.catchPauseMs) || 110);
  const catchTravelMs = Math.max(
    120,
    Math.round(
      pullDurationMs * (Number(HOOK.catchPullDurationMult) || 1.18),
    ),
  );

  scene.time.delayedCall(pauseMs, () => {
    if (!hand?.active) return;
    const returnTween = scene.tweens.add({
    targets: hand,
    x: endX,
    y: endY,
      duration: catchTravelMs,
      ease: "Cubic.easeOut",
      onUpdate: () => {
        drawTether();
        const now = scene.time?.now || 0;
        if (now >= nextTrailAt) {
          nextTrailAt = now + Math.max(13, Number(HOOK.trailIntervalMs) || 22);
          spawnTrailDot(scene, hand.x, hand.y, 0.94, "heavy");
        }
      },
      onComplete: () => {
        cleanupHookVisual(ownerPlayer, visual);
      },
    });
    visual.returnTween = returnTween;
  });
}

export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
  specialData = null,
) {
  if (!scene || !player || !player.active) return;

  const angle = resolveAngle(player, specialData);
  player.flipX = Math.cos(angle) < -0.1;
  player._specialAnimLockUntil = Date.now() + 850;
  playSpecialAnimation(scene, player);

  try {
    scene.sound?.play("gloop-special", {
      volume: isOwner ? 0.68 : 0.38,
    });
  } catch (_) {}

  playHookAction(scene, player, specialData, isOwner);
}
