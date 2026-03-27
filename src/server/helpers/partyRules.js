const {
  legacyModeToVariantId,
  normalizeSelection,
  getPlayersPerTeamForSelection,
  getCapacityForSelection,
} = require("./gameSelectionCatalog");

const PARTY_STATUS = Object.freeze({
  IDLE: "idle",
  QUEUED: "queued",
  READY_CHECK: "ready_check",
  LIVE: "live",
});

const TEAM_SIZE_BY_MODE = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
});

const DISCONNECT_GRACE_MS = 3000;

function teamSizeForMode(mode) {
  return teamSizeForSelection({
    modeId: "duels",
    modeVariantId: legacyModeToVariantId(mode),
    legacyMode: mode,
  });
}

function capacityFromMode(mode) {
  return capacityFromSelection({
    modeId: "duels",
    modeVariantId: legacyModeToVariantId(mode),
    legacyMode: mode,
  });
}

function teamSizeForSelection(selection = {}) {
  const normalized = normalizeSelection(selection);
  return getPlayersPerTeamForSelection({
    ...selection,
    ...normalized,
  });
}

function capacityFromSelection(selection = {}) {
  const normalized = normalizeSelection(selection);
  return getCapacityForSelection({
    ...selection,
    ...normalized,
  });
}

module.exports = {
  PARTY_STATUS,
  TEAM_SIZE_BY_MODE,
  DISCONNECT_GRACE_MS,
  teamSizeForMode,
  capacityFromMode,
  teamSizeForSelection,
  capacityFromSelection,
};
