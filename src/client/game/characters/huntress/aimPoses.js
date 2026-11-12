// Huntress's aimed shot poses. The art script (scripts/art/huntress-pixel/
// attack.cjs) draws one six-frame set per direction under `frame`; anim.js
// registers each as `huntress-throw-<key>` and `huntress-special-<key>`, played
// as a variant of the level shot (see playSpriteAnimation's `variant`).
const { nearestAimPose } = require('../shared/aimPose');

const DIRECTIONS = [
  { key: 'high', elevation: 60, frame: 'attackHigh' },
  { key: 'up', elevation: 30, frame: 'attackUp' },
  { key: null, elevation: 0, frame: 'attack' },
  { key: 'down', elevation: -30, frame: 'attackDown' },
  { key: 'low', elevation: -60, frame: 'attackLow' },
];

// The animation variant for a shot at `angle`; null for the level shot or no aim.
function huntressAimVariant(angle) {
  return nearestAimPose(angle, DIRECTIONS)?.key ?? null;
}

module.exports = { DIRECTIONS, huntressAimVariant };
