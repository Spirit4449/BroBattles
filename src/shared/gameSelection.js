const { DUEL_MODE_ID, normalizeDuelVariant, duelVariantForTeamSize } = require("./maps/duelVariants.js");
// Mode/variant/map selection rules shared by the lobby client and the server.
// Each side supplies its own map list: the client registers the catalog it
// fetched, the server reads the map repository.
const gameModesCatalog = require("./catalogs/gameModes.catalog.cjs");
const { mapsCatalog } = require("./maps");

const MODES = gameModesCatalog.modes;
const MODE_BY_ID = new Map(MODES.map((mode) => [String(mode?.id || ""), mode]));

const DEFAULT_MODE_ID = gameModesCatalog.defaultModeId;
const DEFAULT_VARIANT_ID = gameModesCatalog.defaultVariantId;
const DEFAULT_MAP_ID = mapsCatalog.defaultMapId;

// Pre-catalog clients and party rows stored the team size instead of a
// variant id.
function legacyModeToVariantId(mode) {
  return duelVariantForTeamSize(mode);
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

  // Duel formations share the same maps; other modes keep variant compatibility.
  function getCompatibleMapsForSelection(selection) {
    const { mode, variant } = describeSelection(selection);
    if (!mode) return [];
    const variantId = String(variant?.id || "");
    return getMaps().filter((map) => mode.id === DUEL_MODE_ID
      ? map?.modeId === DUEL_MODE_ID || normalizeDuelVariant(map?.modeVariantId) === DUEL_MODE_ID
      : variantId ? map?.modeVariantId === variantId : map?.modeId === String(mode.id));
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
