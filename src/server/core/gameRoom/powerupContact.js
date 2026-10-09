const { characterBody } = require("../../../shared/physics/duelGeometry");
const { POWERUP_PICKUP_RADIUS } = require("../gameRoomConfig");

// Hurtbox of `player` placed at `at` (bot stance and hop previews reuse the body).
function hurtbox(player, at) {
  const body = characterBody(player.char_class, player.flip);
  return {
    x: (Number(at.x) || 0) + (player._bodyCenterOffsetX ?? body.offsetX),
    y: (Number(at.y) || 0) + (player._bodyCenterOffsetY ?? body.offsetY),
    halfWidth: player._bodyHalfWidth ?? body.halfWidth,
    halfHeight: player._bodyHalfHeight ?? body.halfHeight,
  };
}

// Distance from a fighter's hurtbox to the edge of a powerup orb; <= 0 means they overlap.
function powerupGap(player, pickup, at = player, radius = POWERUP_PICKUP_RADIUS) {
  const box = hurtbox(player, at);
  const dx = Math.max(0, Math.abs(box.x - pickup.x) - box.halfWidth);
  const dy = Math.max(0, Math.abs(box.y - pickup.y) - box.halfHeight);
  return Math.hypot(dx, dy) - radius;
}

// Furthest horizontal offset between hurtbox centre and orb centre that still
// overlaps, at the body's current height (or level with the orb without `pickup`).
function powerupReachX(player, pickup = null, at = player, radius = POWERUP_PICKUP_RADIUS) {
  const box = hurtbox(player, at);
  const dy = pickup ? Math.max(0, Math.abs(box.y - pickup.y) - box.halfHeight) : 0;
  return dy >= radius ? 0 : box.halfWidth + Math.sqrt(radius ** 2 - dy ** 2);
}

module.exports = { powerupGap, powerupReachX };
