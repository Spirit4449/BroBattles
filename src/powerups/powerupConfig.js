// powerups/powerupConfig.js

export const POWERUP_TYPES = [
  "rage",
  "health",
  "shield",
  "poison",
  "gravityBoots",
];

// Asset folder naming under /assets/powerups/[name]/
export const POWERUP_ASSET_DIR = {
  rage: "rage",
  health: "health",
  shield: "shield",
  poison: "poison",
  gravityBoots: "gravity-boots",
};

export const POWERUP_COLORS = {
  rage: 0xa855f7,
  health: 0x34d399,
  shield: 0xf97316,
  poison: 0xfacc15,
  gravityBoots: 0xef4444,
  huntressBurn: 0xff7a1f,
};

export function createPowerupTickSounds(characterTickSounds = {}) {
  return {
    poison: { key: "pu-tick-poison", options: { volume: 0.28 } },
    health: { key: "pu-tick-health", options: { volume: 0.2 } },
    rage: { key: "pu-tick-rage", options: { volume: 0.18 } },
    gravityBoots: { key: "pu-tick-gravityBoots", options: { volume: 0.2 } },
    ...characterTickSounds,
  };
}
