const SeparateY = require('phaser/src/physics/arcade/SeparateY');

// Match Arcade's gravity-first separation, but consume a completed vertical
// collision before World.separate can interpret floating-point residue as a
// second, horizontal collision. Fractional hitbox heights can leave bottom
// greater than platform.top by ~1e-13 even after a successful landing.
function processPlayerPlatformCollision(player, platform) {
  const body = player.body;
  const surface = platform.body;
  if (!body || !surface || body.isCircle || surface.isCircle ||
      !surface.immovable || body.customSeparateY || surface.customSeparateY) return true;
  const world = body.world;
  if (world.forceX || Math.abs(world.gravity.y + body.gravity.y) <
      Math.abs(world.gravity.x + body.gravity.x)) return true;

  if (SeparateY(body, surface, false, world.OVERLAP_BIAS)) {
    // A microscopic clearance prevents residual intersection this frame;
    // ordinary gravity restores ground contact on the following physics step.
    const epsilon = 1e-7;
    if (body.touching.down && Math.abs(body.bottom - surface.top) < epsilon) {
      body.y = surface.top - body.height - epsilon;
    } else if (body.touching.up && Math.abs(body.top - surface.bottom) < epsilon) {
      body.y = surface.bottom + epsilon;
    }
    body.updateCenter();
    return false;
  }
  return true;
}

module.exports = { processPlayerPlatformCollision };
