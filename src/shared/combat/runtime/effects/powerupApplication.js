const effectManager = require("./effectManager");
const { effectDefs } = require("./effectDefs");
function applyPowerupToPlayer(room, playerData, type, nowTs, params = null) {
  if (!playerData) return;
  const durationScale = Number(params?.durationScale);
  const nextParams = params && typeof params === "object" ? { ...params } : {};
  if (Number.isFinite(durationScale) && durationScale > 0) {
    const baseDuration = Number(effectDefs?.[type]?.durationMs);
    if (Number.isFinite(baseDuration) && baseDuration > 0) {
      nextParams.durationMs = Math.round(baseDuration * durationScale);
    }
  }
  effectManager.apply(playerData, type, nowTs, nextParams, room);
}

module.exports = { applyPowerupToPlayer };
