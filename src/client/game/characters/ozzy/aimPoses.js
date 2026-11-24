// CommonJS keeps these mechanics directly loadable by the Node test suite.
// Ozzy's aimed throw poses (scripts/art/ozzy-pixel/actions-video.cjs): one
// eight-frame throw per direction under `frame`. anim.js registers each as
// `ozzy-throw-<key>`, played as a variant of the level throw (see
// playSpriteAnimation's `variant`). Each has its own staff-tip track in
// ozzy.json (`rig.points.staffTip.<frame>`), where the fireball charges.
const { aimVariant } = require('../shared/aimPose');

const DIRECTIONS = [
  { key: 'high', elevation: 60, frame: 'aimhigh' },
  { key: 'up', elevation: 30, frame: 'aimup' },
  { key: null, elevation: 0, frame: 'attack' },
  { key: 'down', elevation: -30, frame: 'aimdown' },
  { key: 'low', elevation: -60, frame: 'aimlow' },
];

// The animation variant for a throw at `angle`; null for the level throw or no aim.
function ozzyAimVariant(angle) {
  return aimVariant(angle, DIRECTIONS);
}

module.exports = { DIRECTIONS, ozzyAimVariant };
