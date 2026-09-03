// gameScene/cameraDynamics.js

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const LIGHT_HIT_DAMAGE_LIMIT = 2000;
const MAX_SHAKE_DAMAGE = 6000;

function smoothstep(value) {
  const t = clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

export function updateDynamicCamera(scene, player, Phaser) {
  if (!scene || !player) return;

  const cam = scene.cameras.main;

  // Smoothly zoom out as player climbs to maintain vertical context.
  const t = Phaser.Math.Clamp((player.y - 80) / (520 - 80), 0, 1);
  const targetZoom = 1.3 + (1.8 - 1.3) * t;
  cam.setZoom(cam.zoom + (targetZoom - cam.zoom) * 0.05);

  // Bias the camera down when higher up to reduce empty sky framing.
  const highFactor = 1 - t;
  const targetFollowOffsetY = 120 + 80 * highFactor;
  cam.setFollowOffset(
    0,
    cam.followOffset.y + (targetFollowOffsetY - cam.followOffset.y) * 0.08,
  );
}

export function triggerDamageCameraShake(scene, damage) {
  const cam = scene?.cameras?.main;
  const damageAmount = Math.max(0, Number(damage) || 0);
  if (!cam || damageAmount <= 0) return;

  let duration;
  let intensity;

  if (damageAmount < LIGHT_HIT_DAMAGE_LIMIT) {
    // Keep chip and damage-over-time hits just visible without making them noisy.
    const lightHitRatio = damageAmount / LIGHT_HIT_DAMAGE_LIMIT;
    duration = Math.round(38 + lightHitRatio * 17);
    intensity = 0.0002 + lightHitRatio * 0.0003;
  } else {
    // Past 2,000 damage, ease into the full shake so heavy hits feel distinct.
    const heavyHitRatio = smoothstep(
      (damageAmount - LIGHT_HIT_DAMAGE_LIMIT) /
        (MAX_SHAKE_DAMAGE - LIGHT_HIT_DAMAGE_LIMIT),
    );
    duration = Math.round(55 + heavyHitRatio * 60);
    intensity = 0.0005 + heavyHitRatio * 0.0035;
  }

  cam.shake(duration, intensity, false);
}
