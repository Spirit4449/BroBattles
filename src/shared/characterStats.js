const definitions = require('./characters');
// Character stats without dependencies on Phaser or character classes
// Single source of truth for all character stats and constants

// Default character for new users
const DEFAULT_CHARACTER = "ninja";
const LEVEL_CAP = 10;

// Levels 1–5 retain the original progression. Mastery levels (6–10) are
// deliberately gentler so reaching the new cap is rewarding without
// invalidating the balance players already know.
const STANDARD_LEVEL_STAT_GAINS = {
  health: 500,
  damage: 100,
  specialDamage: 200,
};
const MASTERY_LEVEL_STAT_GAINS = {
  health: 400,
  damage: 80,
  specialDamage: 100,
};

// Indexed by the character's current level; each value buys the next level.
// The first four entries preserve the existing economy exactly.
const UPGRADE_PRICES = [
  null,
  200,
  400,
  800,
  1600,
  2400,
  3300,
  4500,
  6100,
  8200,
];

const characterStats = definitions.characterStats;

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

function getFreeCharacters() {
  return Object.keys(characterStats).filter(
    (char) => characterStats[char].free,
  );
}

function defaultCharacterList() {
  return Object.fromEntries(
    Object.keys(characterStats).map((char) => [
      char,
      characterStats[char].free ? 1 : 0,
    ]),
  );
}

function getHealth(character, level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const standardLevels = Math.min(safeLevel, 5) - 1;
  const masteryLevels = Math.max(0, safeLevel - 5);
  return (
    characterStats[character].baseHealth +
    standardLevels * STANDARD_LEVEL_STAT_GAINS.health +
    masteryLevels * MASTERY_LEVEL_STAT_GAINS.health
  );
}

function getDamage(character, level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  const standardLevels = Math.min(safeLevel, 5) - 1;
  const masteryLevels = Math.max(0, safeLevel - 5);
  return (
    characterStats[character].baseDamage +
    standardLevels * STANDARD_LEVEL_STAT_GAINS.damage +
    masteryLevels * MASTERY_LEVEL_STAT_GAINS.damage
  );
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
  const safeLevel = Math.max(1, Number(level) || 1);
  const standardLevels = Math.min(safeLevel, 5) - 1;
  const masteryLevels = Math.max(0, safeLevel - 5);
  return (
    characterStats[character].specialBaseDamage +
    standardLevels * STANDARD_LEVEL_STAT_GAINS.specialDamage +
    masteryLevels * MASTERY_LEVEL_STAT_GAINS.specialDamage
  );
}

// The level upgrade price reflects the current level the character is at
// If the character was at level 1 it would cost 200 to go to level 2
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
    characterStats,
    getCharacterStats,
    getCharacterTuning,
    getAllCharacters,
    getFreeCharacters,
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
