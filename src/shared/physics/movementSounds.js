// Unique cache keys keep Bank Bust audio from leaking into later matches.
const bankBustMovementSounds = {
  'sfx-hard-land': 'metal-land',
  'sfx-step-1': 'metal-step-1',
  'sfx-step-2': 'metal-step-2',
  'sfx-step-3': 'metal-step-3',
};
function movementSoundKey(scene, key) {
  return scene?._bankBustMovementAudio && bankBustMovementSounds[key]
    ? `bank-bust-${key}` : key;
}
module.exports = { bankBustMovementSounds, movementSoundKey };
