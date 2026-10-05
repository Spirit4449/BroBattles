const {
  legacyModeToVariantId,
  normalizeSelection,
  getPlayersPerTeamForSelection,
  getCapacityForSelection,
} = require("../match/gameSelectionCatalog");

const PARTY_STATUS = Object.freeze({
  IDLE: "idle",
  QUEUED: "queued",
  READY_CHECK: "ready_check",
  LIVE: "live",
});

// Legacy numeric party "mode" (pre-catalog rows) -> players per team.
// Current selections use playersPerTeam from gameModes.catalog.json.
const TEAM_SIZE_BY_MODE = Object.freeze({
  1: 1,
  2: 2,
  3: 3,
});

// A disconnected party member keeps their slot this long before removal.
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
