import { spawnExplosion } from "./attack";
import { getResolvedCharacterSpecialConfig } from "../../lib/characterTuning.js";
import { getResolvedCharacterSpecialAimConfig } from "../../lib/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { RENDER_LAYERS } from "../../gameScene/renderLayers";

const INFERNO = getResolvedCharacterSpecialConfig("draven", "inferno");
const INFERNO_AIM = getResolvedCharacterSpecialAimConfig("draven");

const DRAVEN_INFERNO_DURATION_MS = INFERNO.durationMs ?? 3000;
const DRAVEN_INFERNO_RISE_MS = INFERNO.riseMs ?? 320;
const DRAVEN_INFERNO_LIFT_PX = INFERNO.liftPx ?? 125;
const DRAVEN_INFERNO_BOB_PX = INFERNO.bobPx ?? 8;
const DRAVEN_INFERNO_RADIUS =
  INFERNO_AIM.radius ?? INFERNO.fireRingRadius ?? 215;
const DRAVEN_FIRE_PULSE_MS = INFERNO.firePulseMs ?? 120;
const DRAVEN_EXPLOSION_PULSE_MS = INFERNO.explosionPulseMs ?? 260;
const DRAVEN_SPECIAL_FX_TEXTURE_KEY = "draven-special-fx";
const DRAVEN_SPECIAL_FX_ANIM_KEY = "draven-special-fx";

const FIRE_COLORS = [0xff5a2f, 0xff8a00, 0xb13cff, 0xff2f5d];

function syncInfernoOverlay(player, overlay) {
  if (!player || !overlay || !overlay.active) return;
  overlay.x = player.x;
  overlay.y = player.y;
  overlay.flipX = !!player.flipX;
  overlay.setDepth(RENDER_LAYERS.PLAYER - 1);
}

function destroyInfernoOverlay(player) {
  if (!player || !player._dravenInfernoOverlay) return;
  try {
    player._dravenInfernoOverlay.destroy();
  } catch (_) {}
  delete player._dravenInfernoOverlay;
}

function ensureInfernoOverlay(scene, player) {
  if (!scene?.add || !player?.active) return null;
  if (
    !scene.textures?.exists(DRAVEN_SPECIAL_FX_TEXTURE_KEY) ||
    !scene.anims?.exists(DRAVEN_SPECIAL_FX_ANIM_KEY)
  ) {
    return null;
  }

  destroyInfernoOverlay(player);

  const overlay = scene.add.sprite(player.x, player.y, DRAVEN_SPECIAL_FX_TEXTURE_KEY);
  overlay.setBlendMode(Phaser.BlendModes.ADD);
  const scaleBase = player.displayWidth || player.width || 72;
  overlay.setScale(Math.max(0.45, (scaleBase / 92) * 1.7));
  syncInfernoOverlay(player, overlay);
  try {
    overlay.anims.play(DRAVEN_SPECIAL_FX_ANIM_KEY, true);
  } catch (_) {}
  player._dravenInfernoOverlay = overlay;
  return overlay;
}

function spawnFireParticle(scene, x, y) {
  const color = FIRE_COLORS[Phaser.Math.Between(0, FIRE_COLORS.length - 1)];
  const p = scene.add.circle(x, y, Phaser.Math.Between(3, 7), color, 0.8);
  p.setDepth(18);
  p.setBlendMode(Phaser.BlendModes.ADD);

  scene.tweens.add({
    targets: p,
    y: y - Phaser.Math.Between(22, 56),
    x: x + Phaser.Math.Between(-14, 14),
    alpha: 0,
    scaleX: Phaser.Math.FloatBetween(1.1, 1.8),
    scaleY: Phaser.Math.FloatBetween(1.2, 2),
    duration: Phaser.Math.Between(260, 460),
    ease: "Cubic.easeOut",
    onComplete: () => p.destroy(),
  });
}

function spawnInfernoPulse(scene, cx, cy, strength = 1) {
  const ring = scene.add.circle(
    cx,
    cy,
    DRAVEN_INFERNO_RADIUS * 0.75,
    0xff4d2f,
    0.22,
  );
  ring.setDepth(14);
  ring.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: ring,
    scaleX: 1.35,
    scaleY: 1.35,
    alpha: 0,
    duration: 260,
    ease: "Quad.easeOut",
    onComplete: () => ring.destroy(),
  });

  const sparks = Math.floor(10 * strength);
  for (let i = 0; i < sparks; i++) {
    const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
    const radius = Phaser.Math.FloatBetween(20, DRAVEN_INFERNO_RADIUS);
    const px = cx + Math.cos(angle) * radius;
    const py = cy + Math.sin(angle) * radius;
    spawnFireParticle(scene, px, py);
  }
}

function startInfernoVisualLoop(scene, player, token, isOwner) {
  let nextFireAt = scene.time.now;
  let nextExplosionAt = scene.time.now + 80;

  const tick = () => {
    if (!player || !player.active) return;
    if (player._dravenInfernoToken !== token) return;

    const now = scene.time.now;
    const until = Number(player._dravenInfernoUntil || 0);
    if (Date.now() >= until) return;

    const elapsed = Math.max(
      0,
      Date.now() - Number(player._dravenInfernoStartedAt || Date.now()),
    );
    const riseT = Phaser.Math.Clamp(elapsed / DRAVEN_INFERNO_RISE_MS, 0, 1);
    const liftNow =
      DRAVEN_INFERNO_LIFT_PX * Phaser.Math.Easing.Cubic.Out(riseT);
    const bob = Math.sin(elapsed / 120) * DRAVEN_INFERNO_BOB_PX;

    const baseX = Number.isFinite(player._dravenInfernoBaseX)
      ? player._dravenInfernoBaseX
      : player.x;
    const baseY = Number.isFinite(player._dravenInfernoBaseY)
      ? player._dravenInfernoBaseY
      : player.y;
    const centerX = player.x;
    const centerY = player.y;

    if (now >= nextFireAt) {
      nextFireAt = now + DRAVEN_FIRE_PULSE_MS;
      spawnInfernoPulse(scene, centerX, centerY, 1);
    }

    if (now >= nextExplosionAt) {
      nextExplosionAt = now + DRAVEN_EXPLOSION_PULSE_MS;
      const angle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const distance = Phaser.Math.FloatBetween(0, DRAVEN_INFERNO_RADIUS);
      const ex = centerX + Math.cos(angle) * distance;
      const ey = centerY + Math.sin(angle) * distance;
      spawnExplosion(scene, ex, ey);
    }

    if (
      scene.anims?.exists("draven-special") &&
      player.anims?.currentAnim?.key !== "draven-special"
    ) {
      try {
        player.anims.play("draven-special", true);
      } catch (_) {}
    }

    // Keep the owner fully anchored while channeling.
    if (isOwner) {
      player.x = baseX;
      player.y = baseY - liftNow + bob;
      if (player.body) {
        player.body.allowGravity = false;
        player.setVelocity(0, 0);
      }
    }

    syncInfernoOverlay(player, player._dravenInfernoOverlay);

    scene.time.delayedCall(16, tick);
  };

  tick();
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

  const now = Date.now();
  const token = createRuntimeId("draven_inferno");
  const baseX = player.x;
  const baseY = player.y;

  player._dravenInfernoToken = token;
  player._dravenInfernoStartedAt = now;
  player._dravenInfernoUntil = now + DRAVEN_INFERNO_DURATION_MS;
  player._dravenInfernoBaseX = baseX;
  player._dravenInfernoBaseY = baseY;
  player._dravenInfernoLift = DRAVEN_INFERNO_LIFT_PX;
  player._movementLockedUntil = now + DRAVEN_INFERNO_DURATION_MS;

  const unlockFlip = lockPlayerFlip(player);

  if (player.body) {
    player._dravenInfernoPrevGravity = player.body.allowGravity;
    player.body.allowGravity = false;
    player.setVelocity(0, 0);
  }

  if (scene.anims?.exists("draven-special")) {
    try {
      player.anims.play("draven-special", true);
    } catch (_) {}
  } else if (scene.anims?.exists("draven-throw")) {
    try {
      player.anims.play("draven-throw", true);
    } catch (_) {}
  }

  ensureInfernoOverlay(scene, player);

  try {
    scene.sound?.play("draven-special", {
      volume: isOwner ? 0.65 : 0.35,
    });
  } catch (_) {}

  startInfernoVisualLoop(scene, player, token, isOwner);

  scene.time.delayedCall(DRAVEN_INFERNO_DURATION_MS, () => {
    if (!player || !player.active) return;
    if (player._dravenInfernoToken !== token) return;

    player._movementLockedUntil = 0;
    player._dravenInfernoUntil = 0;
    unlockFlip();
    destroyInfernoOverlay(player);

    if (player.body) {
      const prevGravity =
        typeof player._dravenInfernoPrevGravity === "boolean"
          ? player._dravenInfernoPrevGravity
          : true;
      player.body.allowGravity = prevGravity;
      player.setVelocityY(Math.max(player.body.velocity.y, 150));
    }

    delete player._dravenInfernoPrevGravity;
    delete player._dravenInfernoToken;
  });
}
