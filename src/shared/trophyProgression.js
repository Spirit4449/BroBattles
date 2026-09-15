const modes = require("./gameModes.catalog.json").modes;
function trophyPeak(user) {
  return Math.max(0, Number(user?.trophies) || 0, Number(user?.trophy_peak ?? user?.trophyPeak) || 0);
}
function getModeUnlockRequirement(modeId) {
  return Number(modes.find(mode => mode.id === modeId)?.unlockTrophies) || 0;
}
function getModeUnlockReason(modeId, user) {
  const required = getModeUnlockRequirement(modeId);
  return trophyPeak(user) >= required ? "" : `Unlock at ${required.toLocaleString()} trophies`;
}
module.exports = { trophyPeak, getModeUnlockRequirement, getModeUnlockReason };
