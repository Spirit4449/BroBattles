const { getCharacterStats, getCharacterTuning } = require("./characterStats.js");

const CHARACTER_BODY_DEFAULTS = Object.freeze({
  widthShrink: 35,
  heightShrink: 10,
  offsetXFromHalf: 0,
  offsetY: 10,
  flipOffset: 0,
});

function cloneValue(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => cloneValue(entry));
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = cloneValue(entry);
    }
    return out;
  }
  return value;
}

function mergeObjects(base, overrides) {
  const out = cloneValue(base);
  if (!overrides || typeof overrides !== "object") return out;
  for (const [key, value] of Object.entries(overrides)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      out[key] &&
      typeof out[key] === "object" &&
      !Array.isArray(out[key])
    ) {
      out[key] = mergeObjects(out[key], value);
    } else {
      out[key] = cloneValue(value);
    }
  }
  return out;
}

function getResolvedCharacterBodyConfig(character) {
  const stats = getCharacterStats(character) || {};
  return mergeObjects(CHARACTER_BODY_DEFAULTS, stats.body || {});
}

function getResolvedCharacterAttackConfig(character, attackKey = null) {
  const attackTuning = getCharacterTuning(character)?.attack || {};
  if (!attackKey) return cloneValue(attackTuning);
  return cloneValue(attackTuning?.[attackKey] || {});
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
    getResolvedCharacterSpecialConfig,
    getResolvedCharacterEffectConfig,
  };
}
