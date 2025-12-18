// Character stats without dependencies on Phaser or character classes
// Single source of truth for all character stats and constants

// Default character for new users
export const DEFAULT_CHARACTER = "ninja";
export const LEVEL_CAP = 5;

export const characterStats = {
  ninja: {
    baseHealth: 7000,
    attackDescription: "Unleashes a shuriken that boomerangs back.",
    baseDamage: 1500,
    ammoCooldownMs: 200,
    ammoReloadMs: 1000,
    ammoCapacity: 1,
    specialDescription: "Dashes forward, releasing a flurry of shurikens.",
    specialBaseDamage: 2000,
    specialChargeHits: 3,
    specialChargeDamage: 4500,
    spriteScale: 0.9,
    body: {
      widthShrink: 35,
      heightShrink: 10,
      offsetXFromHalf: 0,
      offsetY: 10,
    },
    description: "A swift and agile fighter.",
    free: true,
  },

  thorg: {
    baseHealth: 13000,
    attackDescription:
      "Swings a heavy axe in a short arc, pushing back nearby enemies.",
    baseDamage: 1500,
    ammoCooldownMs: 150,
    ammoReloadMs: 800,
    ammoCapacity: 3,
    specialDescription: "Slams the ground to send a shockwave forward.",
    specialBaseDamage: 2800,
    specialChargeHits: 4,
    specialChargeDamage: 4500,
    spriteScale: 0.7,
    body: {
      widthShrink: 30,
      heightShrink: 8,
      offsetXFromHalf: -18,
      offsetY: 8,
      flipOffset: 14,
    },
    description: "A sturdy frontline bruiser with crushing blows.",
    free: true,
  },

  draven: {
    baseHealth: 6500,
    attackDescription:
      "Puffs out a magical smoke that deals splash baseDamage to everyone in the path.",
    baseDamage: 2500,
    ammoCooldownMs: 450,
    ammoReloadMs: 1600,
    ammoCapacity: 3,
    specialDescription: "Unleashes a staff nova that expands outward.",
    specialBaseDamage: 2400,
    specialChargeHits: 3,
    specialChargeDamage: 5000,
    spriteScale: 1.2,
    body: {
      widthShrink: 220,
      heightShrink: 195,
      offsetXFromHalf: 0,
      offsetY: 111,
      // Shift body to the right when facing left to cover staff
      flipOffset: 5,
    },
    description: "A dark sorcerer who manipulates shadows.",
    unlockPrice: 280,
  },

  wizard: {
    baseHealth: 5000,
    attackDescription:
      "Puffs out a magical smoke that deals splash baseDamage to everyone in the path.",
    baseDamage: 3000,
    ammoCooldownMs: 450,
    ammoReloadMs: 3000,
    ammoCapacity: 3,
    specialDescription: "Unleashes a staff nova that expands outward.",
    specialBaseDamage: 8000,
    specialChargeHits: 30,
    specialChargeDamage: 6000,
    spriteScale: 0.92,
    body: {
      widthShrink: 190,
      heightShrink: 110,
      offsetXFromHalf: 0,
      offsetY: 60,
      // Shift body to the right when facing left to cover staff
      flipOffset: 0,
    },
    description: "A dark sorcerer who manipulates shadows.",
    unlockPrice: 200,
  },
};

export function getCharacterStats(character) {
  return characterStats[character] || undefined;
}

export function getAllCharacters() {
  return Object.keys(characterStats);
}

export function getFreeCharacters() {
  return Object.keys(characterStats).filter(
    (char) => characterStats[char].free
  );
}

export function defaultCharacterList() {
  return Object.fromEntries(
    Object.keys(characterStats).map((char) => [
      char,
      characterStats[char].free ? 1 : 0,
    ])
  );
}

export function getHealth(character, level) {
  return characterStats[character].baseHealth + (level - 1) * 500;
}

export function getDamage(character, level) {
  return characterStats[character].baseDamage + (level - 1) * 100;
}

export function getSpecialDamage(character, level) {
  return characterStats[character].specialBaseDamage + (level - 1) * 200;
}

// The level upgrade price reflects the current level the character is at
// If the character was at level 1 it would cost 200 to go to level 2
export function upgradePrice(level) {
  return 200 * 2 ** (level - 1); // Doubles every level
}

export function unlockPrice(character) {
  return characterStats[character].unlockPrice || undefined;
}

// CommonJS export for server-side compatibility
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    DEFAULT_CHARACTER,
    LEVEL_CAP,
    characterStats,
    getCharacterStats,
    getAllCharacters,
    getFreeCharacters,
    defaultCharacterList,
    getHealth,
    getDamage,
    getSpecialDamage,
    upgradePrice,
    unlockPrice,
  };
}
