const catalog = require('./gameModes.catalog.json');
const byId = Object.fromEntries(catalog.modes.map(mode => [mode.id, mode]));
function supportsSuddenDeath(modeId) {
  return byId[modeId]?.capabilities?.suddenDeath !== false;
}
module.exports = { supportsSuddenDeath };
