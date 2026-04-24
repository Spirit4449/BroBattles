import { getResolvedCharacterSpecialConfig } from "../../lib/characterTuning.js";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const NAME = "gloop";
const HOOK = getResolvedCharacterSpecialConfig(NAME, "hook");

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

function createHand(scene, x, y, angle, scale) {
  const key = scene?.textures?.exists(`${NAME}-hand`) ? `${NAME}-hand` : null;
  const hand = key
    ? scene.add.sprite(x, y, key)
    : scene.add.ellipse(x, y, 44, 26, 0x72f0ff, 0.9);
  hand.setDepth(RENDER_LAYERS.ATTACKS + 9);
  if (hand.setScale) hand.setScale(Math.max(0.05, Number(scale) || 0.28));
  if (hand.setRotation) hand.setRotation(angle);
  if (hand.setTint) hand.setTint(0x98f5ff);
  return hand;
}

function spawnTrailDot(scene, x, y, alpha = 0.72) {
  const dot = scene.add.circle(
    x + Phaser.Math.Between(-4, 4),
    y + Phaser.Math.Between(-4, 4),
    Phaser.Math.FloatBetween(3.2, 6.2),
    Phaser.Math.RND.pick([0x55c7ff, 0x87f6ff, 0x2d9cff]),
    alpha,
  );
  dot.setDepth(RENDER_LAYERS.ATTACKS + 3);
  dot.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: dot,
    alpha: 0,
    scaleX: 0.35,
    scaleY: 0.35,
    duration: Phaser.Math.Between(220, 340),
    ease: "Quad.easeOut",
    onComplete: () => dot.destroy(),
  });
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
  );
  const tether = scene.add.graphics();
  tether.setDepth(RENDER_LAYERS.ATTACKS + 4);
  tether.setBlendMode(Phaser.BlendModes.ADD);

  const drawTether = () => {
    if (!hand?.active || !tether?.active) return;
    tether.clear();
    tether.lineStyle(8, 0x55c7ff, isOwner ? 0.45 : 0.32);
    tether.beginPath();
    tether.moveTo(start.x, start.y);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
    tether.lineStyle(2, 0xd8fbff, isOwner ? 0.9 : 0.62);
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
        nextTrailAt = now + Math.max(18, Number(HOOK.trailIntervalMs) || 28);
        spawnTrailDot(scene, hand.x, hand.y);
      }
    },
    onComplete: () => {
      scene.tweens.add({
        targets: hand,
        x: start.x,
        y: start.y,
        alpha: 0.35,
        duration: retractMs,
        ease: "Sine.easeIn",
        onUpdate: drawTether,
        onComplete: () => {
          try {
            hand.destroy();
            tether.destroy();
          } catch (_) {}
        },
      });
    },
  });

  hand.once("destroy", () => {
    try {
      travel?.remove?.();
      tether?.destroy?.();
    } catch (_) {}
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
  const hand = createHand(
    scene,
    startX,
    startY,
    angle,
    Number(HOOK.visualScale) || 0.28,
  );
  const tether = scene.add.graphics();
  tether.setDepth(RENDER_LAYERS.ATTACKS + 4);
  tether.setBlendMode(Phaser.BlendModes.ADD);

  const drawTether = () => {
    if (!hand?.active || !tether?.active) return;
    tether.clear();
    tether.lineStyle(8, 0x55c7ff, isOwner ? 0.45 : 0.32);
    tether.beginPath();
    tether.moveTo(startX, startY);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
    tether.lineStyle(2, 0xd8fbff, isOwner ? 0.92 : 0.66);
    tether.beginPath();
    tether.moveTo(startX, startY);
    tether.lineTo(hand.x, hand.y);
    tether.strokePath();
  };

  let nextTrailAt = 0;
  scene.tweens.add({
    targets: hand,
    x: endX,
    y: endY,
    duration: pullDurationMs,
    ease: "Cubic.easeOut",
    onUpdate: () => {
      drawTether();
      const now = scene.time?.now || 0;
      if (now >= nextTrailAt) {
        nextTrailAt = now + Math.max(16, Number(HOOK.trailIntervalMs) || 28);
        spawnTrailDot(scene, hand.x, hand.y, 0.9);
      }
    },
    onComplete: () => {
      try {
        hand.destroy();
        tether.destroy();
      } catch (_) {}
    },
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
