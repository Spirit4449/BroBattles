const BANK_BUST_VAULT_DEFAULT_WIDTH = 150;
const BANK_BUST_VAULT_DEFAULT_HEIGHT = 180;
const BANK_BUST_VAULT_DEFAULT_RADIUS = 90;
const BANK_BUST_GOLD_ARRIVAL_MS = 1300;

const catalog = require('./catalogs/gameModes.catalog.cjs');
const defaults = catalog.modes.find(mode => mode.id === 'bank-bust').settings;

function setting(value, fallback, minimum) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, number) : fallback;
}

function resolveBankBustSettings(settings = {}) {
  return {
    vaultStartingCoins: setting(settings.vaultStartingCoins, defaults.vaultStartingCoins, 1),
    deathDropVaultCoins: setting(settings.deathDropVaultCoins, defaults.deathDropVaultCoins, 1),
    purchaseFloorCoins: setting(settings.purchaseFloorCoins, defaults.purchaseFloorCoins, 0),
    lowCoinsRatio: setting(settings.lowCoinsRatio, defaults.lowCoinsRatio, 0),
    matchDurationMs: setting(settings.matchDurationMs, defaults.matchDurationMs, 1),
    respawnDelayMs: setting(settings.respawnDelayMs, defaults.respawnDelayMs, 0),
    respawnShieldMs: setting(settings.respawnShieldMs, defaults.respawnShieldMs, 0),
  };
}

// Map documents may predate these fields. Once a room has started, its
// replicated object state contains the settings actually used for purchases.
function resolvePurchaseSettings(type, config = {}, state = {}) {
  if (type === 'claimableTurret') return {
    claimRadius: setting(state.claimRadius ?? config.claimRadius, 110, 40),
    claimCost: setting(state.claimCost ?? config.claimCost, 3000, 0),
  };
  return {
    buildRadius: setting(state.buildRadius ?? config.buildRadius, 100, 30),
    cost: setting(state.cost ?? config.cost, 1100, 0),
    width: setting(state.width ?? config.width, 48, 10),
    height: setting(state.height ?? config.height, 96, 10),
  };
}

module.exports = {
  BANK_BUST_VAULT_DEFAULT_WIDTH,
  BANK_BUST_VAULT_DEFAULT_HEIGHT,
  BANK_BUST_VAULT_DEFAULT_RADIUS,
  BANK_BUST_GOLD_ARRIVAL_MS,
  resolveBankBustSettings,
  resolvePurchaseSettings,
};
