import movementPhysics from "../../../shared/physics/movementPhysics.json";

// Fit actual opaque artwork, including its width. A low, wide character must
// not become enormous just to match an upright fighter's height. Character
// kits can identify the body below a tall prop/effect using bodyTop (0..1).
export const SHOWCASE_ART_HEIGHT = 72;
export const SHOWCASE_WORLD_HEIGHT = 360;

export function showcaseSpriteScale(bounds, { height = SHOWCASE_ART_HEIGHT, maxWidth = height, bodyTop = 0 } = {}) {
  const bodyHeight = bounds.height * (1 - bodyTop);
  return Math.min(height / Math.max(1, bodyHeight), maxWidth / Math.max(1, bounds.width));
}

// Source-pixel bounds of the actual frame artwork. Phaser's cut rectangle is
// in atlas coordinates; frame.x/y restore the trim offset in source space.
export function showcaseOpaqueBounds(frame, pixels, imageWidth) {
  let left = frame.cutWidth, top = frame.cutHeight, right = 0, bottom = 0;
  if (pixels && !frame.rotated) {
    for (let y = 0; y < frame.cutHeight; y++) {
      for (let x = 0; x < frame.cutWidth; x++) {
        if (pixels[((frame.cutY + y) * imageWidth + frame.cutX + x) * 4 + 3] <= 24) continue;
        left = Math.min(left, x); right = Math.max(right, x + 1);
        top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
      }
    }
  }
  if (right <= left || bottom <= top) {
    left = 0; top = 0; right = frame.cutWidth; bottom = frame.cutHeight;
  }
  const offsetX = frame.x || 0, offsetY = frame.y || 0;
  return { left: left + offsetX, top: top + offsetY, right: right + offsetX, bottom: bottom + offsetY,
    width: right - left, height: bottom - top };
}

// An untruncated ballistic jump. Reserve camera room for it instead of reducing
// the launch velocity to fit. Falling uses the game's stronger fall gravity.
export function showcaseJumpMotion(physics = movementPhysics) {
  const launch = physics.jumpSpeed * physics.jumpLaunchSpeedMult;
  const gravity = physics.gravity;
  const fallGravity = gravity * physics.fallGravityFactor;
  const apexSeconds = launch / gravity;
  const height = launch * launch / (2 * gravity);
  const fallSeconds = Math.sqrt(2 * height / fallGravity);
  const durationMs = (apexSeconds + fallSeconds) * 1000;
  return {
    launch, height, durationMs,
    sample(elapsedMs) {
      const t = Math.max(0, Math.min(durationMs, elapsedMs)) / 1000;
      const falling = t >= apexSeconds;
      const fallTime = t - apexSeconds;
      return {
        height: Math.max(0, falling ? height - fallGravity * fallTime * fallTime / 2 : launch * t - gravity * t * t / 2),
        velocity: falling ? fallGravity * fallTime : -launch + gravity * t,
        falling,
      };
    },
  };
}

// Continue the same ballistic descent after a knockback or hovering super.
export function stepShowcaseGravity(player, dt) {
  if (player.y < player.groundY || player.vy < 0) {
    player.vy += movementPhysics.gravity * (player.vy > 0 ? movementPhysics.fallGravityFactor : 1) * dt;
    player.y += player.vy * dt;
  }
  player.grounded = player.y >= player.groundY;
  if (player.grounded) {
    player.y = player.groundY;
    player.vy = 0;
  }
}
