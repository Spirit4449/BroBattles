// Mode/variant/map selection rules shared by the lobby client and the server.
// Each side supplies its own map list: the client registers the catalog it
// fetched, the server reads the map repository.
const gameModesCatalog = require("./catalogs/gameModes.catalog.json");
const { mapsCatalog } = require("./maps");

const MODES = Array.isArray(gameModesCatalog?.modes) ? gameModesCatalog.modes : [];
const MODE_BY_ID = new Map(MODES.map((mode) => [String(mode?.id || ""), mode]));

const DEFAULT_MODE_ID = String(gameModesCatalog?.defaultModeId || "duels");
const DEFAULT_VARIANT_ID = String(
  gameModesCatalog?.defaultVariantId || "duels-1v1",
);
const DEFAULT_MAP_ID = Number(mapsCatalog?.defaultMapId) || 1;

// Pre-catalog clients and party rows stored the team size (1-3) instead of a
// variant id.
function legacyModeToVariantId(mode) {
  const numeric = Number(mode);
  if (numeric === 2) return "duels-2v2";
  if (numeric === 3) return "duels-3v3";
  return DEFAULT_VARIANT_ID;
}

function getModeById(modeId) {
  return MODE_BY_ID.get(String(modeId || "")) || MODE_BY_ID.get(DEFAULT_MODE_ID) || MODES[0] || null;
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

function describeSelection(selection) {
  return getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
    selection?.legacyMode,
  );
}

function getPlayersPerTeamForSelection(selection) {
  const { variant } = describeSelection(selection);
  return Math.max(1, Number(variant?.playersPerTeam) || 1);
}

function createSelectionCatalog(getMaps) {
  function getMapById(mapId) {
    const numeric = Number(mapId);
    const maps = getMaps();
    return (
      maps.find((map) => Number(map?.id) === numeric) ||
      maps.find((map) => Number(map?.id) === DEFAULT_MAP_ID) ||
      maps[0] ||
      null
    );
  }

  // Every map is built for one mode variant (its arena), so a selection's
  // maps are exactly the maps made for that variant.
  function getCompatibleMapsForSelection(selection) {
    const { mode, variant } = describeSelection(selection);
    if (!mode) return [];
    const variantId = String(variant?.id || "");
    return getMaps().filter((map) => variantId
      ? map?.modeVariantId === variantId
      : map?.modeId === String(mode.id));
  }

  function normalizeSelection(selection = {}) {
    const { mode, variant } = describeSelection(selection);
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

  function isSelectionQueueable(selection) {
    const normalized = normalizeSelection(selection);
    const { mode } = getVariantDescriptor(normalized.modeId, normalized.modeVariantId);
    if (!mode?.queueable || !mode?.implemented) return false;
    return normalized.mapId != null;
  }

  function getSelectionBlockReason(selection) {
    const normalized = normalizeSelection(selection);
    const { mode } = getVariantDescriptor(normalized.modeId, normalized.modeVariantId);
    if (!mode) return "Unknown mode.";
    if (!mode.queueable || !mode.implemented) {
      return mode.queueDisabledReason || `${mode.label} is not playable yet.`;
    }
    if (normalized.mapId == null) {
      return "No compatible maps are available for this mode yet.";
    }
    return "";
  }

  return {
    getMapById,
    getCompatibleMapsForSelection,
    normalizeSelection,
    isSelectionQueueable,
    getSelectionBlockReason,
  };
}

module.exports = {
  MODES,
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  legacyModeToVariantId,
  getModeById,
  getVariantDescriptor,
  getPlayersPerTeamForSelection,
  createSelectionCatalog,
};
