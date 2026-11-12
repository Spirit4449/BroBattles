const definitions = require('.');
// Character stats without dependencies on Phaser or character classes
// Single source of truth for all character stats and constants

// Default character for new users
const DEFAULT_CHARACTER = "ninja";
// Highest level a character can be upgraded to.
const LEVEL_CAP = 10;

// Levels 1–5 retain the original progression. Mastery levels (6–10) are
// deliberately gentler so reaching the new cap is rewarding without
// invalidating the balance players already know.
// Last level that uses the standard gains; levels above it use mastery gains.
const STANDARD_LEVEL_CAP = 5;
// Fraction of the level-1 stat added per level up, for levels
// 2..STANDARD_LEVEL_CAP. Percentages keep each character's role intact as it
// levels (a flat bonus would favour fragile characters over tanks).
const STANDARD_LEVEL_GAIN_FRACTION = 0.15;
// Fraction of the level-1 stat added per level above STANDARD_LEVEL_CAP.
const MASTERY_LEVEL_GAIN_FRACTION = 0.075;

// Coin cost to upgrade, indexed by the character's current level; each value
// buys the next level. Needs LEVEL_CAP - 1 priced entries (about x1.5 a step).
const UPGRADE_PRICES = [
  null,
  150,
  300,
  550,
  900,
  1400,
  2100,
  3000,
  4200,
  5800,
];

const characterStats = definitions.characterStats;

// Misspellings that older clients/rows may still send.
const CHARACTER_KEY_ALIASES = { wizard: "ozzy", huntress: "sparrow", hunteress: "sparrow" };

// Lowercased, trimmed key with legacy aliases applied ("" when empty).
function canonicalCharacterKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return CHARACTER_KEY_ALIASES[key] || key;
}

function getCharacterDisplayName(value) {
  const key = canonicalCharacterKey(value);
  return definitions.characterDefinitions[key]?.displayName || key.replace(/[_-]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

// Normalizes a stored/received character key, falling back to the default.
// Use this instead of repeating `|| "ninja"` at call sites.
function resolveCharacterKey(value) {
  return canonicalCharacterKey(value) || DEFAULT_CHARACTER;
}

// users.char_levels arrives as a JSON string (MySQL) or an object. Always
// returns an object; malformed data reads as no levels instead of throwing.
function parseCharacterLevels(raw) {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

// Owned level for one character (0 when locked or unknown).
function getCharacterLevel(user, character) {
  return Math.max(0, Number(parseCharacterLevels(user?.char_levels)[character]) || 0);
}

function getCharacterStats(character) {
  return characterStats[character] || undefined;
}

function getCharacterTuning(character) {
  const stats = getCharacterStats(character);
  return (stats && stats.tuning) || {};
}

function getAllCharacters() {
  return Object.keys(characterStats);
}

function defaultCharacterList() {
  return Object.fromEntries(
    Object.keys(characterStats).map((char) => [
      char,
      characterStats[char].free ? 1 : 0,
    ]),
  );
}

// Each level adds the same fixed amount: a percentage of the level-1 stat,
// rounded to a multiple of 10. Rounding the gain (not the total) keeps every
// upgrade within a band identical, and a multiple of 10 keeps the last digit
// of a stat constant across levels (Thorg damage 250, 290, 330... never
// flipping between 0s and 5s).
const LEVEL_GAIN_STEP = 10;

function levelGain(baseValue, fraction) {
  if (!(baseValue > 0)) return 0;
  return Math.max(
    LEVEL_GAIN_STEP,
    Math.round((baseValue * fraction) / LEVEL_GAIN_STEP) * LEVEL_GAIN_STEP,
  );
}

function scaleForLevel(baseValue, level) {
  const base = Number(baseValue) || 0;
  const safeLevel = Math.min(LEVEL_CAP, Math.max(1, Math.floor(Number(level)) || 1));
  const standardLevels = Math.min(safeLevel, STANDARD_LEVEL_CAP) - 1;
  const masteryLevels = Math.max(0, safeLevel - STANDARD_LEVEL_CAP);
  return (
    base +
    standardLevels * levelGain(base, STANDARD_LEVEL_GAIN_FRACTION) +
    masteryLevels * levelGain(base, MASTERY_LEVEL_GAIN_FRACTION)
  );
}

function getHealth(character, level) {
  return scaleForLevel(characterStats[character].baseHealth, level);
}

function getDamage(character, level) {
  return scaleForLevel(characterStats[character].baseDamage, level);
}

// Charge is measured in landed hits, independent of level and damage modifiers.
function getSuperChargeHits(character) {
  return Math.max(1, Number(characterStats[character]?.specialChargeHits) || 1);
}

// Each accepted projectile contact counts separately. Supers can contribute a
// fraction of a normal hit; unconfigured attack types never grant charge.
function getSuperChargePerHit(character, attackType = "basic") {
  const stats = characterStats[character];
  if (!stats) return 0;
  if (definitions.characterDefinitions[character].basicHitTypes.includes(attackType)) return 1;
  if (definitions.characterDefinitions[character].specialHitTypes.includes(attackType)) {
    return Math.max(0, Number(stats.specialChargePerHit) || 0);
  }
  return 0;
}

function getSpecialDamage(character, level) {
  return scaleForLevel(characterStats[character].specialBaseDamage, level);
}

// The level upgrade price reflects the current level the character is at
// e.g. UPGRADE_PRICES[1] buys level 2
function upgradePrice(level) {
  return UPGRADE_PRICES[Math.floor(Number(level))] ?? undefined;
}

function unlockPrice(character) {
  return characterStats[character].unlockPrice || undefined;
}

// CommonJS for server-side compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CHARACTER,
    LEVEL_CAP,
    STANDARD_LEVEL_CAP,
    canonicalCharacterKey,
    resolveCharacterKey,
    getCharacterDisplayName,
    parseCharacterLevels,
    getCharacterLevel,
    characterStats,
    getCharacterStats,
    getCharacterTuning,
    getAllCharacters,
    defaultCharacterList,
    getHealth,
    getDamage,
    getSuperChargeHits,
    getSuperChargePerHit,
    getSpecialDamage,
    upgradePrice,
    unlockPrice,
  };
}
