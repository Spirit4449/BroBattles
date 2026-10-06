// Advances moving platforms to the simulation clock once per fixed tick.
// Projectiles, ground checks and bot physics read room.geometry, so they see
// current positions. Human riders are carried by their own client; bots are
// carried and pushed here, before their physics step.
const { advanceGeometry } = require('../../../shared/maps/platformMotion');
const { carryOnPlatforms } = require('../bots/physics');

function tickMovingPlatforms(room, timeMs) {
  const geometry = room.geometry;
  if (!geometry?.movingColliders?.length) return;
  const previous = geometry.motionTime;
  const moved = advanceGeometry(geometry, timeMs);
  if (!(timeMs > previous)) return;
  for (const player of room.players.values()) {
    if (player.isBot && player.isAlive) carryOnPlatforms(player, moved, geometry.colliders);
  }
}

module.exports = { tickMovingPlatforms };
