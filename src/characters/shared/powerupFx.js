// Rage tint and trail for characters whose sprite must keep its base scale
// while enraged (scaling would desync the physics body from platforms).
export function applyScaleLockedRageFx(
  { sprite, effects, nowSec, colors, spawnTrailParticle } = {},
  { particleSize = 3.5 } = {},
) {
  if (!sprite || !effects) return { handled: false, rageLike: false };
  if ((effects.rage || 0) <= 0) return { handled: false, rageLike: false };

  const pulse = 0.5 + 0.5 * Math.sin(nowSec * 8 + (sprite.x || 0) * 0.01);
  sprite.setTint(pulse > 0.52 ? 0xc084fc : 0x9333ea);

  sprite.setScale(sprite._puBaseScaleX || 1, sprite._puBaseScaleY || 1);
  sprite.setOrigin(sprite._puBaseOriginX ?? 0.5, sprite._puBaseOriginY ?? 0.5);

  if (typeof spawnTrailParticle === "function" && Math.random() < 0.34) {
    spawnTrailParticle(
      (sprite.x || 0) + (Math.random() * 28 - 14),
      (sprite.y || 0) + (Math.random() * 44 - 26),
      colors?.rage || 0xa855f7,
      particleSize,
      300,
    );
  }
  return { handled: true, rageLike: true };
}
