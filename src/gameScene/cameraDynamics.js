// gameScene/cameraDynamics.js

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
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

export function triggerDamageCameraShake(scene, damage, maxHealth) {
  const cam = scene?.cameras?.main;
  const damageAmount = Math.max(0, Number(damage) || 0);
  if (!cam || damageAmount <= 0) return;

  const healthReference = Math.max(1, Number(maxHealth) || damageAmount);
  const damageRatio = clamp(damageAmount / healthReference, 0, 1);
  const duration = Math.round(clamp(55 + damageRatio * 70, 55, 115));
  const intensity = clamp(0.0005 + damageRatio * 0.0035, 0.0007, 0.004);

  cam.shake(duration, intensity, false);
}
