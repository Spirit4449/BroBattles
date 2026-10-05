// Physics contacts use fractional coordinates. Half-pixel packet rounding can
// put a grounded player inside the floor on every single network update.
const POSITION_SCALE = 10000;
const COLLISION_PACKET_TOLERANCE = 0.26; // Also accommodates older half-pixel clients.
function quantizeMovementPosition(value) {
  return Math.round((Number(value) || 0) * POSITION_SCALE) / POSITION_SCALE;
}
module.exports = { quantizeMovementPosition, COLLISION_PACKET_TOLERANCE };
