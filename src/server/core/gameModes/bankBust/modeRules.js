const { resolveBankBustSettings } = require("../../../../shared/bankBustSettings");

const DEFAULT_SETTINGS = resolveBankBustSettings();

const VAULT_BUST_FINISH_DELAY_MS = 1800;

const TURRET_PROJECTILE_RADIUS = 10;

const TURRET_PROJECTILE_MAX_LIFETIME_MS = 2200;

function distance(aX, aY, bX, bY) {
  return Math.hypot(
    (Number(aX) || 0) - (Number(bX) || 0),
    (Number(aY) || 0) - (Number(bY) || 0),
  );
}

module.exports = { DEFAULT_SETTINGS, TURRET_PROJECTILE_RADIUS, TURRET_PROJECTILE_MAX_LIFETIME_MS, distance, VAULT_BUST_FINISH_DELAY_MS };
