export function between(min, max) {
  return min + Math.random() * (max - min);
}

// Both vault hits and crate payouts use the same pop, hold and rise.
export function animateCoinLabel(scene, label, { y, scale = 1, rise = 54, onComplete }) {
  scene.tweens.add({ targets: label, scale, duration: 170, ease: "Back.easeOut" });
  scene.tweens.add({
    targets: label,
    y: y - rise,
    alpha: 0,
    duration: 620,
    delay: 340,
    ease: "Quad.easeIn",
    onComplete,
  });
}

export function expandRing(
  scene,
  x,
  y,
  { radius, width, color, opacity, depth, duration, delay = 0 },
  active,
) {
  const shape = scene.add.circle(x, y, 8, 0x000000, 0);
  shape.setStrokeStyle(width, color, opacity);
  shape.setDepth(depth);
  active.add(shape);
  scene.tweens.add({
    targets: shape,
    radius,
    alpha: 0,
    duration,
    delay,
    ease: "Cubic.easeOut",
    onComplete() {
      if (active.delete(shape)) shape.destroy();
    },
  });
}
