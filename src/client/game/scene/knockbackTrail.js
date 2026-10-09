// Follow rendered positions so local physics and interpolated fighters share
// the same trail, including redirected blasts and vertical knockback.
export function spawnKnockbackTrail(scene, sprite) {
  sprite?._knockbackTrailStop?.();
  if (!scene?.add?.graphics || !scene?.time || !sprite?.active ||
      !sprite.visible || sprite.alpha < 0.1 || sprite._powerupInvisible) return;
  let previous = { x: sprite.x, y: sprite.y };
  let stopped = false;
  let elapsed = 0;
  const particles = new Set();
  const fade = (particle) => {
    particles.add(particle);
    scene.tweens.add({ targets: particle, alpha: 0, duration: 210,
      onComplete: () => { particles.delete(particle); particle.destroy(); } });
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    timer.remove();
    for (const particle of particles) {
      scene.tweens.killTweensOf?.(particle);
      particle.destroy();
    }
    particles.clear();
    sprite.off?.('destroy', stop);
    scene.events?.off('shutdown', stop);
    if (sprite._knockbackTrailStop === stop) delete sprite._knockbackTrailStop;
  };
  const timer = scene.time.addEvent({ delay: 24, loop: true, callback: () => {
    elapsed += 24;
    if (elapsed > 650 || !sprite.active || !sprite.visible || sprite.alpha < 0.1 ||
        sprite._powerupInvisible || sprite._deathPresentationActive) { stop(); return; }
    const dx = sprite.x - previous.x, dy = sprite.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 3) return;
    // Respawns, corrections and teleports must never draw across the arena.
    if (distance > 180) { stop(); return; }
    const tx = dx / distance, ty = dy / distance;
    const trail = scene.add.graphics().setDepth(sprite.depth - 0.1);
    for (const offset of [-12, 0, 12]) {
      const rear = offset ? 16 : 6;
      trail.lineStyle(offset ? 2 : 5, offset ? 0xffffff : 0xd6e7ef, offset ? 0.7 : 0.38);
      trail.lineBetween(previous.x - tx * rear - ty * offset, previous.y - ty * rear + tx * offset,
        sprite.x - tx * rear - ty * offset, sprite.y - ty * rear + tx * offset);
    }
    fade(trail);
    if (scene.add.image && sprite.texture?.key) {
      fade(scene.add.image(previous.x, previous.y, sprite.texture.key, sprite.frame?.name)
        .setOrigin(sprite.originX, sprite.originY).setScale(sprite.scaleX, sprite.scaleY)
        .setFlipX(sprite.flipX).setTint(0xe8f4ff).setAlpha(0.22).setDepth(sprite.depth - 1));
    }
    previous = { x: sprite.x, y: sprite.y };
  } });
  sprite._knockbackTrailStop = stop;
  sprite.once?.('destroy', stop);
  scene.events?.once('shutdown', stop);
}

export function presentRemoteKnockback(scene, sprite, state, tracker, hidden = false) {
  const seq = state?.knockbackSeq;
  if (!Number.isSafeInteger(seq) || seq < 0) return;
  const previous = tracker._lastKnockbackSeq;
  if (previous !== undefined && seq <= previous) return;
  tracker._lastKnockbackSeq = seq;
  // Establish a baseline when joining; do not replay an old hit.
  if (previous === undefined || hidden) return;
  spawnKnockbackTrail(scene, sprite);
}
