// Sparrow's super, Seraph: the aim phase timings and the light bolt's flight.
// No renderer or room dependencies: the server, bots and every client use this
// model. Tuning lives in sparrow.json (stats.tuning.special.seraph / lightBolt).
const { getResolvedCharacterSpecialConfig } = require('./characterTuning.js');
const { rigPointArt, rigWorldPoint } = require('./characterRig.js');
const { seraphAimPose } = require('./sparrowSeraphAim.js');

const SERAPH = getResolvedCharacterSpecialConfig('sparrow', 'seraph');
const BOLT = getResolvedCharacterSpecialConfig('sparrow', 'lightBolt');

// The angle she shoots when no aim is given: straight ahead.
function facingAngle(flip) {
  return flip ? Math.PI : 0;
}

function validAngle(angle) {
  const value = Number(angle);
  return Number.isFinite(value) ? Math.atan2(Math.sin(value), Math.cos(value)) : null;
}

// Each drawn pose has its own bow position in the sprite atlas. The bolt
// starts there and flies at the original, unrounded aim angle.
function boltOrigin(pose, angle) {
  const { direction, flipX } = seraphAimPose(angle, pose.flip);
  const point = rigPointArt('sparrow', BOLT.muzzle, direction.frame);
  return rigWorldPoint('sparrow', { ...pose, flip: flipX }, point) || { x: Number(pose.x) || 0, y: Number(pose.y) || 0 };
}

function createBolt(pose, angle, id, launchMono) {
  const start = boltOrigin(pose, angle);
  return {
    id, launchMono, angle, x: start.x, y: start.y,
    vx: Math.cos(angle) * BOLT.speed, vy: Math.sin(angle) * BOLT.speed,
    speed: BOLT.speed, range: BOLT.range, radius: BOLT.collisionRadius,
    durationMs: (BOLT.range / BOLT.speed) * 1000,
  };
}

// Straight, constant speed, stopping at its range: nothing blocks it.
function sampleBolt(bolt, ageMs) {
  const t = Math.max(0, Math.min(bolt.durationMs, Number(ageMs) || 0)) / 1000;
  return { x: bolt.x + bolt.vx * t, y: bolt.y + bolt.vy * t };
}

module.exports = { SERAPH, BOLT, facingAngle, validAngle, boltOrigin, createBolt, sampleBolt };
