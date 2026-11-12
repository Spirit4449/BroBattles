// Sparrow's aimed shot poses. The art script (scripts/art/sparrow-pixel/
// attack.cjs) draws one six-frame set per direction under `frame`; anim.js
// registers each as `sparrow-throw-<key>` and `sparrow-special-<key>`, played
// as a variant of the level shot (see playSpriteAnimation's `variant`).
const { aimVariant } = require('../shared/aimPose');

const DIRECTIONS = [
  { key: 'high', elevation: 60, frame: 'attackHigh' },
  { key: 'up', elevation: 30, frame: 'attackUp' },
  { key: null, elevation: 0, frame: 'attack' },
  { key: 'down', elevation: -30, frame: 'attackDown' },
  { key: 'low', elevation: -60, frame: 'attackLow' },
];

// The animation variant for a shot at `angle`; null for the level shot or no aim.
function sparrowAimVariant(angle) {
  return aimVariant(angle, DIRECTIONS);
}

module.exports = { DIRECTIONS, sparrowAimVariant };
