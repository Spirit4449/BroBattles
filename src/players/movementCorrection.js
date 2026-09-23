// A positional contact correction must not erase motion tangent to the face.
// Phaser Body.reset() also stops velocity AND acceleration, unlike a teleport.
function applyMovementCorrection(player, correction) {
  const body = player?.body;
  if (!body || !Number.isFinite(correction?.x) || !Number.isFinite(correction?.y)) return;
  if (correction.reason !== 'collision') {
    body.reset(correction.x, correction.y);
    return;
  }
  const vx = body.velocity.x, vy = body.velocity.y;
  const ax = body.acceleration.x, ay = body.acceleration.y;
  const hits = correction.contacts || {};
  const blocksX = value => (value < 0 && hits.left) || (value > 0 && hits.right);
  const blocksY = value => (value < 0 && hits.up) || (value > 0 && hits.down);
  body.reset(correction.x, correction.y);
  body.setVelocity(blocksX(vx) ? 0 : vx, blocksY(vy) ? 0 : vy);
  body.setAcceleration(blocksX(ax) ? 0 : ax, blocksY(ay) ? 0 : ay);
}
module.exports = { applyMovementCorrection };
