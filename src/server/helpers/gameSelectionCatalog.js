const gameModesCatalog = require("../../shared/gameModes.catalog.json");
const mapsCatalog = require("../../shared/maps.catalog.json");

const MODES = Array.isArray(gameModesCatalog?.modes) ? gameModesCatalog.modes : [];
const MAPS = Array.isArray(mapsCatalog?.maps) ? mapsCatalog.maps : [];

const DEFAULT_MODE_ID = String(gameModesCatalog?.defaultModeId || "duels");
const DEFAULT_VARIANT_ID = String(
  gameModesCatalog?.defaultVariantId || "duels-1v1",
);
const DEFAULT_MAP_ID = Number(mapsCatalog?.defaultMapId) || 1;

const MODE_BY_ID = new Map(MODES.map((mode) => [String(mode?.id || ""), mode]));
const MAP_BY_ID = new Map(MAPS.map((map) => [Number(map?.id), map]));

function legacyModeToVariantId(mode) {
  const numeric = Number(mode);
  if (numeric === 2) return "duels-2v2";
  if (numeric === 3) return "duels-3v3";
  return DEFAULT_VARIANT_ID;
}

function selectionToLegacyMode(modeId, modeVariantId = null) {
  const { mode, variant } = getVariantDescriptor(modeId, modeVariantId);
  if (!mode || String(mode.id) !== "duels") return 1;
  const playersPerTeam = Math.max(1, Number(variant?.playersPerTeam) || 1);
  return Math.max(1, Math.min(3, playersPerTeam));
}

function getModeById(modeId) {
  return MODE_BY_ID.get(String(modeId || "")) || MODE_BY_ID.get(DEFAULT_MODE_ID) || MODES[0] || null;
}

function getMapById(mapId) {
  const numeric = Number(mapId);
  return MAP_BY_ID.get(numeric) || MAP_BY_ID.get(DEFAULT_MAP_ID) || MAPS[0] || null;
}

function getMapObjectiveLayout(mapId, objectiveKey = null) {
  const map = getMapById(mapId);
  if (!map) return null;
  const layouts = map?.objectiveLayout && typeof map.objectiveLayout === "object"
    ? map.objectiveLayout
    : null;
  if (!layouts) return null;
  if (!objectiveKey) return layouts;
  return layouts?.[objectiveKey] || null;
}

function getVariantDescriptor(modeId, modeVariantId = null, legacyMode = null) {
  const mode = getModeById(modeId);
  if (!mode) return { mode: null, variant: null };

  const variants = Array.isArray(mode?.variants) ? mode.variants : [];
  if (!variants.length) return { mode, variant: null };

  const fallbackVariantId =
    modeVariantId || mode?.defaultVariantId || legacyModeToVariantId(legacyMode);
  const wanted = String(fallbackVariantId || variants[0]?.id || "");
  const variant =
    variants.find((entry) => String(entry?.id || "") === wanted) || variants[0] || null;
  return { mode, variant };
}

function getCompatibleMapsForSelection(selection) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
    selection?.legacyMode,
  );
  if (!mode) return [];

  const modeId = String(mode.id);
  const variantId = String(variant?.id || "");
  return MAPS.filter((map) => {
    const compatibleModeIds = Array.isArray(map?.compatibleModeIds)
      ? map.compatibleModeIds.map(String)
      : [];
    if (!compatibleModeIds.includes(modeId)) return false;
    const compatibleVariantIds = Array.isArray(map?.compatibleVariantIds)
      ? map.compatibleVariantIds.map(String)
      : [];
    if (!compatibleVariantIds.length || !variantId) return true;
    return compatibleVariantIds.includes(variantId);
  });
}

function normalizeSelection(selection = {}) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
    selection?.legacyMode,
  );
  const compatibleMaps = getCompatibleMapsForSelection({
    modeId: mode?.id,
    modeVariantId: variant?.id || null,
    legacyMode: selection?.legacyMode,
  });
  const selectedMapId = Number(selection?.mapId);
  const mapId = compatibleMaps.some((entry) => Number(entry?.id) === selectedMapId)
    ? selectedMapId
    : compatibleMaps[0]?.id ?? null;

  return {
    modeId: String(mode?.id || DEFAULT_MODE_ID),
    modeVariantId: variant ? String(variant.id) : null,
    mapId: Number.isFinite(Number(mapId)) ? Number(mapId) : null,
  };
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

function getPlayersPerTeamForSelection(selection) {
  const { variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
    selection?.legacyMode,
  );
  return Math.max(1, Number(variant?.playersPerTeam) || 1);
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

function isSelectionQueueable(selection) {
  const normalized = normalizeSelection(selection);
  const { mode } = getVariantDescriptor(
    normalized.modeId,
    normalized.modeVariantId,
    selection?.legacyMode,
  );
  if (!mode?.queueable || !mode?.implemented) return false;
  return normalized.mapId != null;
}

function getSelectionBlockReason(selection) {
  const normalized = normalizeSelection(selection);
  const { mode } = getVariantDescriptor(
    normalized.modeId,
    normalized.modeVariantId,
    selection?.legacyMode,
  );
  if (!mode) return "Unknown mode.";
  if (!mode.queueable || !mode.implemented) {
    return mode.queueDisabledReason || `${mode.label} is not playable yet.`;
  }
  if (normalized.mapId == null) {
    return "No compatible maps are available for this mode yet.";
  }
  return "";
}

module.exports = {
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  legacyModeToVariantId,
  selectionToLegacyMode,
  getModeById,
  getMapById,
  getMapObjectiveLayout,
  getVariantDescriptor,
  getCompatibleMapsForSelection,
  normalizeSelection,
  normalizeSelectionFromRow,
  getPlayersPerTeamForSelection,
  getCapacityForSelection,
  isSelectionQueueable,
  getSelectionBlockReason,
};
