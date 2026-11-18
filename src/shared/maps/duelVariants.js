const catalog = require('../catalogs/gameModes.catalog.cjs');
const DUEL_MODE_ID = 'duels';
const mode = catalog.modes.find(entry => entry.id === DUEL_MODE_ID);
const DUEL_DEFAULT_VARIANT = mode.defaultVariantId;
const DUEL_VARIANTS = new Map(mode.variants.map(variant => [variant.id, variant]));

function isDuelFormation(id) {
  return DUEL_VARIANTS.has(id);
}

function normalizeDuelVariant(id) {
  return isDuelFormation(id) ? DUEL_MODE_ID : id;
}

function duelPlayersPerTeam(id) {
  return DUEL_VARIANTS.get(id)?.playersPerTeam;
}

function duelVariantForTeamSize(size) {
  return mode.variants.find(variant => variant.playersPerTeam === Number(size))?.id ?? DUEL_DEFAULT_VARIANT;
}

module.exports = {
  DUEL_MODE_ID, DUEL_DEFAULT_VARIANT, isDuelFormation, normalizeDuelVariant,
  duelPlayersPerTeam, duelVariantForTeamSize,
};
