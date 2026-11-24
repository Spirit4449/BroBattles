// Cue-tip coordinates in the installed 231 x 190 atlas frames, facing right.
const tips = require('./pocketAceCueTips.json');
const STRIKE_FRAME = 6;

function cueTip(frame) {
  const match = /^(attack|aimup|aimhigh|aimdown|aimlow)(\d+)$/.exec(frame);
  return match ? tips[match[1]][Number(match[2])] || null : null;
}

module.exports = { cueTip, STRIKE_FRAME };
