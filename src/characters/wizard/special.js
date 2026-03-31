function pulseAura(scene, sprite, tint = 0x7dd3fc, scale = 1.6, alpha = 0.34) {
  if (!scene?.add || !sprite?.active) return;
  const aura = scene.add.circle(sprite.x, sprite.y, 34, tint, alpha);
  aura.setDepth((sprite.depth || 10) + 2);
  scene.tweens.add({
    targets: aura,
    alpha: 0,
    scaleX: scale,
    scaleY: scale,
    duration: 520,
    ease: "Cubic.easeOut",
    onUpdate: () => {
      aura.x = sprite.x;
      aura.y = sprite.y - ((sprite.displayHeight || sprite.height || 0) * 0.08);
    },
    onComplete: () => aura.destroy(),
  });
}

function pulseRing(scene, sprite, radius = 48, color = 0x60a5fa, width = 5) {
  if (!scene?.add || !sprite?.active) return;
  const ring = scene.add.circle(sprite.x, sprite.y, radius);
  ring.setStrokeStyle(width, color, 0.95);
  ring.setDepth((sprite.depth || 10) + 3);
  scene.tweens.add({
    targets: ring,
    alpha: 0,
    scaleX: 3.25,
    scaleY: 3.25,
    duration: 720,
    ease: "Cubic.easeOut",
    onUpdate: () => {
      ring.x = sprite.x;
      ring.y = sprite.y - ((sprite.displayHeight || sprite.height || 0) * 0.08);
    },
    onComplete: () => ring.destroy(),
  });

  const core = scene.add.circle(sprite.x, sprite.y, Math.max(18, radius * 0.34), 0xa5f3fc, 0.18);
  core.setDepth((sprite.depth || 10) + 1);
  scene.tweens.add({
    targets: core,
    alpha: 0,
    scaleX: 2.2,
    scaleY: 2.2,
    duration: 640,
    ease: "Quad.easeOut",
    onUpdate: () => {
      core.x = sprite.x;
      core.y = sprite.y - ((sprite.displayHeight || sprite.height || 0) * 0.08);
    },
    onComplete: () => core.destroy(),
  });
}

export function perform(scene, player) {
  if (!scene || !player) return;
  player._specialAnimLockUntil = Date.now() + 2100;
  try {
    if (scene.anims?.exists("wizard-special")) {
      player.anims?.play?.("wizard-special", true);
    } else if (scene.anims?.exists("wizard-throw")) {
      player.anims?.play?.("wizard-throw", true);
    }
  } catch (_) {}
  try {
    scene.sound?.play?.("wizard-fireball", {
      volume: 0.35,
      rate: 0.68,
    });
  } catch (_) {}
  pulseAura(scene, player, 0x93c5fd, 1.85, 0.28);
  pulseRing(scene, player, 54, 0x60a5fa, 5);
  pulseRing(scene, player, 34, 0xbfdbfe, 3);
}
