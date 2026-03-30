import gameModesCatalog from "../shared/gameModes.catalog.json";
import mapsCatalog from "../shared/maps.catalog.json";

const MODES = Array.isArray(gameModesCatalog?.modes)
  ? gameModesCatalog.modes
  : [];
const MAPS = Array.isArray(mapsCatalog?.maps) ? mapsCatalog.maps : [];

const MODE_BY_ID = new Map(MODES.map((mode) => [String(mode?.id || ""), mode]));
const MAP_BY_ID = new Map(MAPS.map((map) => [Number(map?.id), map]));
const VARIANT_BY_ID = new Map();

for (const mode of MODES) {
  for (const variant of Array.isArray(mode?.variants) ? mode.variants : []) {
    VARIANT_BY_ID.set(String(variant?.id || ""), { mode, variant });
  }
}

export const DEFAULT_MODE_ID = String(
  gameModesCatalog?.defaultModeId || "duels",
);
export const DEFAULT_VARIANT_ID = String(
  gameModesCatalog?.defaultVariantId || "duels-1v1",
);
export const DEFAULT_MAP_ID = Number(mapsCatalog?.defaultMapId) || 1;

export function getAllGameModes() {
  return MODES.slice();
}

export function getAllMaps() {
  return MAPS.slice();
}

export function getModeById(modeId) {
  return (
    MODE_BY_ID.get(String(modeId || "")) ||
    MODE_BY_ID.get(DEFAULT_MODE_ID) ||
    MODES[0] ||
    null
  );
}

export function getMapById(mapId) {
  const numeric = Number(mapId);
  return (
    MAP_BY_ID.get(numeric) || MAP_BY_ID.get(DEFAULT_MAP_ID) || MAPS[0] || null
  );
}

export function getMapObjectiveLayout(mapId, objectiveKey = null) {
  const map = getMapById(mapId);
  if (!map) return null;
  const layouts =
    map?.objectiveLayout && typeof map.objectiveLayout === "object"
      ? map.objectiveLayout
      : null;
  if (!layouts) return null;
  if (!objectiveKey) return layouts;
  return layouts?.[objectiveKey] || null;
}

export function getVariantDescriptor(modeId, variantId = null) {
  const mode = getModeById(modeId);
  if (!mode) return { mode: null, variant: null };

  const variants = Array.isArray(mode.variants) ? mode.variants : [];
  if (!variants.length) return { mode, variant: null };

  const wanted = String(
    variantId || mode.defaultVariantId || variants[0]?.id || "",
  );
  const variant =
    variants.find((entry) => String(entry?.id || "") === wanted) ||
    variants[0] ||
    null;
  return { mode, variant };
}

export function getSelectionDisplayLabel(selection) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  if (!mode) return "Unknown Mode";
  if (variant) return `${mode.label} • ${variant.label}`;
  return mode.label;
}

export function getModeArtAsset(modeId) {
  const mode = getModeById(modeId);
  return mode?.artAsset || mode?.fallbackArtAsset || "/assets/fightImage.webp";
}

export function getModeFallbackArtAsset(modeId) {
  const mode = getModeById(modeId);
  return mode?.fallbackArtAsset || "/assets/fightImage.webp";
}

export function getCompatibleMapsForSelection(selection) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
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

export function isMapCompatibleWithSelection(mapId, selection) {
  const numeric = Number(mapId);
  return getCompatibleMapsForSelection(selection).some(
    (map) => Number(map?.id) === numeric,
  );
}

export function normalizeGameSelection(selection = {}) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  const compatibleMaps = getCompatibleMapsForSelection({
    modeId: mode?.id,
    modeVariantId: variant?.id || null,
  });

  const selectedMapId = Number(selection?.mapId);
  const mapId = compatibleMaps.some(
    (entry) => Number(entry?.id) === selectedMapId,
  )
    ? selectedMapId
    : (compatibleMaps[0]?.id ?? null);

  return {
    modeId: String(mode?.id || DEFAULT_MODE_ID),
    modeVariantId: variant ? String(variant.id) : null,
    mapId: Number.isFinite(Number(mapId)) ? Number(mapId) : null,
  };
}

export function getPlayersPerTeamForSelection(selection) {
  const { variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  return Math.max(1, Number(variant?.playersPerTeam) || 1);
}

export function selectionToLegacyMode(selection) {
  const { mode, variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  if (!mode || String(mode.id) !== "duels") return 1;
  return Math.max(1, Math.min(3, Number(variant?.playersPerTeam) || 1));
}

export function getTotalPlayersForSelection(selection) {
  const { variant } = getVariantDescriptor(
    selection?.modeId,
    selection?.modeVariantId,
  );
  if (variant?.teamCount && variant?.playersPerTeam) {
    return (
      Math.max(1, Number(variant.teamCount)) *
      Math.max(1, Number(variant.playersPerTeam))
    );
  }
  return Math.max(1, Number(variant?.maxPlayers) || 1);
}

export function isSelectionQueueable(selection) {
  const normalized = normalizeGameSelection(selection);
  const { mode } = getVariantDescriptor(
    normalized.modeId,
    normalized.modeVariantId,
  );
  if (!mode?.queueable || !mode?.implemented) return false;
  return normalized.mapId != null;
}

export function getSelectionBlockReason(selection) {
  const normalized = normalizeGameSelection(selection);
  const { mode } = getVariantDescriptor(
    normalized.modeId,
    normalized.modeVariantId,
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

export function getModeSelectionStyle(modeId) {
  const mode = getModeById(modeId);
  return String(mode?.lobbyPresentation?.selectionStyle || "direct");
}

export function getModeSubtitle(modeId) {
  const mode = getModeById(modeId);
  return String(mode?.lobbyPresentation?.subtitle || "");
}

export function getMapLabel(mapId) {
  return String(getMapById(mapId)?.label || `Map ${String(mapId || "")}`);
}

export function getModeLabel(modeId) {
  return String(getModeById(modeId)?.label || "Unknown Mode");
}
