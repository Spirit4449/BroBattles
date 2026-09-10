// Small stepped chips stay crisp at game scale, unlike miniature fireball sprites.
function getPixelTexture(scene) {
  const key = "wizard-fire-pixels";
  if (scene.textures.exists(key)) return key;
  const texture = scene.textures.createCanvas(key, 24, 8);
  const ctx = texture.getContext();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(2, 2, 4, 4);
  ctx.fillRect(10, 0, 4, 8);
  ctx.fillRect(8, 2, 8, 4);
  ctx.fillRect(16, 2, 6, 4);
  ctx.fillRect(18, 0, 4, 4);
  for (let i = 0; i < 3; i++) texture.add(`chip${i}`, 0, i * 8, 0, 8, 8);
  texture.refresh();
  texture.setFilter(0);
  return key;
}
export function createFireballParticles(scene, sprite, angle) {
  const fx = Math.cos(angle), fy = Math.sin(angle);
  const texture = getPixelTexture(scene);
  const emitters = [-2, -1].map(layer => scene.add.particles(0, 0, texture, {
    frame: ["chip0", "chip1", "chip2"],
    emitting: false,
    lifespan: { min: 220, max: 360 },
    speedX: { min: -fx * 80 - 28, max: -fx * 80 + 28 },
    speedY: { min: -fy * 80 - 28, max: -fy * 80 + 28 },
    scale: { start: layer === -2 ? 1.7 : 1.15, end: 0.4 },
    alpha: { start: layer === -2 ? 0.85 : 0.7, end: 0 },
    tint: layer === -2 ? [0x43caff, 0x75dcff] : [0xd4f8ff, 0xffffff],
    maxParticles: 180,
    blendMode: "NORMAL",
  }).setDepth(sprite.depth + layer));
  let sequence = 0;
  let previous = { x: sprite.x, y: sprite.y };
  let carry = 0;
  let draining = false;
  let drainMs = 0;
  let disposed = false;
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    scene.events.off("postupdate", update);
    scene.events.off("shutdown", destroy);
    scene.events.off("presentation:reset", destroy);
    emitters.forEach(emitter => emitter.destroy());
  };
  const update = (_time, delta = 16.67) => {
    const dt = Math.max(0, Math.min(64, delta));
    if (draining || !sprite.active) {
      drainMs += Math.max(0, delta);
      if (drainMs > 380) destroy();
      return;
    }
    // Both layers sit behind the ball. Uneven, curling ribbons merge and
    // split instead of leaving three straight parallel rails.
    const size = Math.abs(sprite.scaleX || 0.5) / 0.5;
    for (let ms = 8 - carry; ms <= dt; ms += 8) {
      const t = dt ? ms / dt : 1;
      const x = previous.x + (sprite.x - previous.x) * t;
      const y = previous.y + (sprite.y - previous.y) * t;
      sequence++;
      for (const emitter of emitters) {
        for (const lane of [-1, 0, 1]) {
          const curl = Math.sin(sequence * 0.17 + lane * 2.1);
          const ripple = Math.sin(sequence * 0.39 + lane * 0.8);
          const rear = (42 + lane * 5 + curl * 10) * size;
          const side = (lane * (14 + ripple * 6) + curl * 11) * size;
          emitter.emitParticleAt(Math.round(x - fx * rear - fy * side),
            Math.round(y - fy * rear + fx * side), 1);
        }
      }
    }
    carry = (carry + dt) % 8;
    previous = { x: sprite.x, y: sprite.y };
  };
  scene.events.on("postupdate", update);
  scene.events.once("shutdown", destroy);
  scene.events.once("presentation:reset", destroy);
  return { destroy, stop() { draining = true; } };
}
