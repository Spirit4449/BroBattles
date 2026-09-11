import { POWERUP_CATALOG, POWERUP_TYPES } from '../shared/powerups';

export { POWERUP_TYPES };
export const POWERUP_ASSET_DIR = Object.fromEntries(
  POWERUP_TYPES.map(key => [key, POWERUP_CATALOG[key].assetDir]),
);
export const POWERUP_COLORS = {
  ...Object.fromEntries(POWERUP_TYPES.map(key => [key, POWERUP_CATALOG[key].color])),
  huntressBurn: 0xff7a1f,
};

export function createPowerupTickSounds(characterTickSounds = {}) {
  return {
    ...Object.fromEntries(POWERUP_TYPES
      .filter(key => POWERUP_CATALOG[key].tickVolume != null)
      .map(key => [key, { key: `pu-tick-${key}`, options: { volume: POWERUP_CATALOG[key].tickVolume } }])),
    ...characterTickSounds,
  };
}
