// While the ozzy charges a fireball, the forming ball is already dangerous:
// a capsule over the top of his head and behind his back burns anyone touching
// it, so an enemy standing on him or behind him is hit before the release.
// The ball then bursts there (same damage and splash as a fireball hit) and
// nothing is released. The front is left to the released fireball.
//
// The server tests this shape against targets (attack runtime
// `attached-charge`); the caster's client predicts with the same function.
// Offsets are in pixels from the ozzy's position, `x` toward his facing.
const { getResolvedCharacterAttackConfig } = require('./characterTuning');

function chargeConfig() {
  const fireball = getResolvedCharacterAttackConfig('ozzy', 'fireball') || {};
  const charge = fireball.charge || {};
  return {
    startMs: Math.max(0, Number(charge.startMs) || 0),
    endMs: Math.max(0, Number(fireball.castDelayMs) || 0),
    radius: Math.max(1, Number(charge.radius) || 1),
    behind: Array.isArray(charge.behind) ? charge.behind.map(Number) : [0, 0],
    above: Array.isArray(charge.above) ? charge.above.map(Number) : [0, 0],
  };
}

// pose: { x, y, flip }. Returns [] outside the active part of the cast.
function ozzyChargeShapes(pose, elapsedMs, config = chargeConfig()) {
  if (!(elapsedMs >= config.startMs && elapsedMs < config.endMs)) return [];
  const facing = pose.flip ? -1 : 1;
  const point = ([dx, dy]) => ({ x: Number(pose.x) + facing * dx, y: Number(pose.y) + dy });
  return [{ kind: 'capsule', a: point(config.behind), b: point(config.above), radius: config.radius }];
}

module.exports = { chargeConfig, ozzyChargeShapes };
