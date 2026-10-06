const {
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  legacyModeToVariantId,
  getModeById,
  getVariantDescriptor,
  getPlayersPerTeamForSelection,
  createSelectionCatalog,
} = require("../../../shared/gameSelection");

function allMaps() { return require("../maps/mapRepository").mapRepository.listMetadata(); }

const {
  getMapById,
  getCompatibleMapsForSelection,
  normalizeSelection,
  isSelectionQueueable,
  getSelectionBlockReason,
} = createSelectionCatalog(allMaps);

function selectionToLegacyMode(modeId, modeVariantId = null) {
  const { mode, variant } = getVariantDescriptor(modeId, modeVariantId);
  if (!mode || String(mode.id) !== "duels") return 1;
  const playersPerTeam = Math.max(1, Number(variant?.playersPerTeam) || 1);
  return Math.max(1, Math.min(3, playersPerTeam));
}

function normalizeSelectionFromRow(row = {}) {
  return normalizeSelection({
    modeId: row?.mode_id || row?.modeId || null,
    modeVariantId:
      row?.mode_variant_id || row?.modeVariantId || row?.mode_variant || null,
    legacyMode: row?.mode,
    mapId: row?.map ?? row?.map_id ?? row?.mapId ?? DEFAULT_MAP_ID,
  });
}

function getCapacityForSelection(selection) {
  const { variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
    selection?.legacyMode,
  );
  const teamCount = Math.max(1, Number(variant?.teamCount) || 2);
  const perTeam = Math.max(1, Number(variant?.playersPerTeam) || 1);
  return { total: teamCount * perTeam, perTeam, teamCount };
}

module.exports = {
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  legacyModeToVariantId,
  selectionToLegacyMode,
  getModeById,
  getMapById,
  getVariantDescriptor,
  getCompatibleMapsForSelection,
  normalizeSelection,
  normalizeSelectionFromRow,
  getPlayersPerTeamForSelection,
  getCapacityForSelection,
  isSelectionQueueable,
  getSelectionBlockReason,
};
