// gameScene/cameraDynamics.js

export function updateDynamicCamera(scene, player, Phaser) {
  if (!scene || !player) return;

  const cam = scene.cameras.main;

  // Smoothly zoom out as player climbs to maintain vertical context.
  const t = Phaser.Math.Clamp((player.y - 80) / (520 - 80), 0, 1);
  const targetZoom = 1.3 + (1.7 - 1.3) * t;
  cam.setZoom(cam.zoom + (targetZoom - cam.zoom) * 0.05);

  // Bias the camera down when higher up to reduce empty sky framing.
  const highFactor = 1 - t;
  const targetFollowOffsetY = 120 + 80 * highFactor;
  cam.setFollowOffset(
    0,
    cam.followOffset.y + (targetFollowOffsetY - cam.followOffset.y) * 0.08,
  );
}
