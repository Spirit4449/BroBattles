import { spawnExplosion } from "./attack";
import { getCharacterTuning } from "../../lib/characterStats.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";

const DRAVEN_TUNING = getCharacterTuning("draven");
const INFERNO = DRAVEN_TUNING.special?.inferno || {};

const DRAVEN_INFERNO_DURATION_MS = INFERNO.durationMs ?? 3000;
const DRAVEN_INFERNO_RISE_MS = INFERNO.riseMs ?? 320;
const DRAVEN_INFERNO_LIFT_PX = INFERNO.liftPx ?? 125;
const DRAVEN_INFERNO_BOB_PX = INFERNO.bobPx ?? 8;
const DRAVEN_FIRE_RING_RADIUS = INFERNO.fireRingRadius ?? 185;
const DRAVEN_FIRE_PULSE_MS = INFERNO.firePulseMs ?? 120;
const DRAVEN_EXPLOSION_PULSE_MS = INFERNO.explosionPulseMs ?? 260;

const FIRE_COLORS = [0xff5a2f, 0xff8a00, 0xb13cff, 0xff2f5d];

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

function spawnInfernoPulse(scene, cx, groundY, strength = 1) {
  const ring = scene.add.circle(
    cx,
    groundY,
    DRAVEN_FIRE_RING_RADIUS * 0.75,
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
    const angle = Phaser.Math.FloatBetween(-Math.PI * 0.95, -0.05);
    const radius = Phaser.Math.FloatBetween(20, DRAVEN_FIRE_RING_RADIUS);
    const px = cx + Math.cos(angle) * radius;
    const py = groundY + Math.sin(angle) * Phaser.Math.FloatBetween(0.3, 0.9);
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
    const groundY = baseY + (player.body ? player.body.height * 0.42 : 24);

    if (now >= nextFireAt) {
      nextFireAt = now + DRAVEN_FIRE_PULSE_MS;
      spawnInfernoPulse(scene, baseX, groundY, 1);
    }

    if (now >= nextExplosionAt) {
      nextExplosionAt = now + DRAVEN_EXPLOSION_PULSE_MS;
      const ex =
        baseX +
        Phaser.Math.Between(-DRAVEN_FIRE_RING_RADIUS, DRAVEN_FIRE_RING_RADIUS);
      const ey = groundY + Phaser.Math.Between(-34, 12);
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
