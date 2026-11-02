// Unique cache keys keep Bank Bust audio from leaking into later matches.
const bankBustMovementSounds = {
  'sfx-step-1': 'metal-step',
  'sfx-step-2': 'metal-step',
  'sfx-step-3': 'metal-step',
};
function movementSoundKey(scene, key) {
  return scene?._bankBustMovementAudio && bankBustMovementSounds[key]
    ? `bank-bust-${key}` : key;
}
module.exports = { bankBustMovementSounds, movementSoundKey };
