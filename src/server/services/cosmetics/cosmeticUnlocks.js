// Automatic unlock rules shared by cosmetic catalogs (skins, profile icons):
//   { type: "starter" }                     always owned
//   { type: "character", character: key }   owned once that character is unlocked
//   { type: "trophies", min: n }            owned at n trophies
const { parseCharacterLevels } = require("../../../shared/characters/characterStats.js");

function unlockedCharacterSet(userRow) {
  const unlocked = new Set();
  for (const [key, value] of Object.entries(parseCharacterLevels(userRow?.char_levels))) {
    if (Number(value) >= 1) unlocked.add(String(key));
  }
  return unlocked;
}

/**
 * @param {object|null} unlock The catalog entry's unlock rule.
 * @param {object} userRow users row (char_levels, trophies).
 * @param {{ fallbackCharacter?: string, unlockedCharacters?: Set<string> }} [options]
 */
function isAutoUnlocked(unlock, userRow, { fallbackCharacter = "", unlockedCharacters = null } = {}) {
  if (!unlock || typeof unlock !== "object") return false;
  const type = String(unlock.type || "").toLowerCase();
  if (type === "starter") return true;
  if (type === "character") {
    const character = String(unlock.character || fallbackCharacter || "").trim();
    if (!character) return false;
    return (unlockedCharacters || unlockedCharacterSet(userRow)).has(character);
  }
  if (type === "trophies") {
    const min = Math.max(0, Number(unlock.min) || 0);
    return Math.max(0, Number(userRow?.trophies) || 0) >= min;
  }
  return false;
}

module.exports = { isAutoUnlocked, unlockedCharacterSet };
