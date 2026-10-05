const { getCharacterStats, getCharacterTuning } = require("./characterStats.js");
const { cloneValue } = require("../deepMerge.js");

const CHARACTER_BODY_DEFAULTS = Object.freeze({
  widthShrink: 35,
  heightShrink: 10,
  offsetXFromHalf: 0,
  offsetY: 10,
  flipOffset: 0,
});

function getResolvedCharacterBodyConfig(character) {
  const stats = getCharacterStats(character) || {};
  // Body fields are scalars. Avoid recursive cloning in every physics probe.
  return { ...CHARACTER_BODY_DEFAULTS, ...(stats.body || {}) };
}

function getResolvedCharacterAttackConfig(character, attackKey = null) {
  const attackTuning = getCharacterTuning(character)?.attack || {};
  if (!attackKey) return cloneValue(attackTuning);
  return cloneValue(attackTuning?.[attackKey] || {});
}

function getResolvedCharacterAimConfig(character) {
  const attackTuning = getCharacterTuning(character)?.attack || {};
  return cloneValue(attackTuning?.aim || {});
}

function getResolvedCharacterSpecialAimConfig(character) {
  const specialTuning = getCharacterTuning(character)?.special || {};
  return cloneValue(specialTuning?.aim || {});
}

function getResolvedCharacterSpecialConfig(character, specialKey = null) {
  const specialTuning = getCharacterTuning(character)?.special || {};
  if (!specialKey) return cloneValue(specialTuning);
  return cloneValue(specialTuning?.[specialKey] || {});
}

function getResolvedCharacterEffectConfig(character, effectKey = null) {
  const effectTuning = getCharacterTuning(character)?.effects || {};
  if (!effectKey) return cloneValue(effectTuning);
  return cloneValue(effectTuning?.[effectKey] || {});
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    CHARACTER_BODY_DEFAULTS,
    getResolvedCharacterBodyConfig,
    getResolvedCharacterAttackConfig,
    getResolvedCharacterAimConfig,
    getResolvedCharacterSpecialAimConfig,
    getResolvedCharacterSpecialConfig,
    getResolvedCharacterEffectConfig,
  };
}
