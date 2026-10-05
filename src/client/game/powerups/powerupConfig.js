// Client lookups derived from src/shared/catalogs/powerups.catalog.json.
// Edit the catalog; these tables rebuild themselves.
import { POWERUP_CATALOG, POWERUP_TYPES } from '../../../shared/powerups';

export { POWERUP_TYPES };
// Folder under public/assets/powerups/ holding each powerup's art.
export const POWERUP_ASSET_DIR = Object.fromEntries(
  POWERUP_TYPES.map(key => [key, POWERUP_CATALOG[key].assetDir]),
);
// Main tint per powerup (pickup glow, HUD ring, Wizard surge beam).
export const POWERUP_COLORS = {
  ...Object.fromEntries(POWERUP_TYPES.map(key => [key, POWERUP_CATALOG[key].color])),
  huntressBurn: 0xff7a1f, // Huntress burn status reuses the powerup tint system
};
// Pale variant used for the HUD status-badge fill.
export const POWERUP_LIGHT_COLORS = Object.fromEntries(
  POWERUP_TYPES.map(key => [key, POWERUP_CATALOG[key].lightColor]),
);

export function createPowerupTickSounds(characterTickSounds = {}) {
  return {
    ...Object.fromEntries(POWERUP_TYPES
      .filter(key => POWERUP_CATALOG[key].tickVolume != null)
      .map(key => [key, { key: `pu-tick-${key}`, options: { volume: POWERUP_CATALOG[key].tickVolume } }])),
    ...characterTickSounds,
  };
}
