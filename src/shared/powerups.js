const POWERUP_CATALOG = require('./powerups.catalog.json');
// Applies to powerups, death drops, and Bank Bust gold after they become active.
const PICKUP_DELAY_MS = 500;
const POWERUP_TYPES = Object.keys(POWERUP_CATALOG);
const POWERUP_DURATIONS_MS = Object.fromEntries(
  POWERUP_TYPES.map(key => [key, POWERUP_CATALOG[key].durationMs]),
);

module.exports = { POWERUP_CATALOG, POWERUP_TYPES, POWERUP_DURATIONS_MS, PICKUP_DELAY_MS };
