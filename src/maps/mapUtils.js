// src/maps/mapUtils.js
// Shared client utility for placing sprites precisely on top of a platform.
// Imported by every map module — eliminates the copy-paste duplication.

/**
 * Snap a sprite so its feet land exactly on top of a platform.
 * Works for both arcade-physics bodies and plain display objects.
 *
 * @param {Phaser.GameObjects.Sprite} sprite
 * @param {Phaser.GameObjects.Sprite} platform
 * @param {number} targetX  — desired center X
 * @param {number} [epsilon=2] — tiny upward nudge so the physics engine never
 *   considers the sprite "below" the surface and tunnels through it.
 */
export function snapSpriteToPlatform(sprite, platform, targetX, epsilon = 2) {
  if (!sprite || !platform) return;

  const topY = platform.body ? platform.body.top : platform.getTopCenter().y;
  if (sprite.body) {
    const body = sprite.body;
    const halfH = (Number(body.height) || 0) / 2;
    const offsetY = Number(body.offset?.y) || 0;
    const targetY = topY - halfH - offsetY - epsilon;

    if (typeof body.reset === "function") {
      body.reset(targetX, targetY);
    } else {
      sprite.setPosition(targetX, targetY);
    }

    if (body.velocity?.set) body.velocity.set(0, 0);
    if (body.acceleration?.set) body.acceleration.set(0, 0);
    if (typeof body.updateFromGameObject === "function") {
      body.updateFromGameObject();
      const desiredBottom = topY - epsilon;
      const correction = desiredBottom - body.bottom;
      if (Math.abs(correction) > 0.5) {
        sprite.y += correction;
        body.updateFromGameObject();
      }
    }
  } else {
    const h = Number(sprite.height) || 0;
    sprite.setPosition(targetX, topY - h / 2 - epsilon);
  }
}
