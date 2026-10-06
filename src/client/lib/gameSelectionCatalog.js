// Client view of the shared selection rules (src/shared/gameSelection.js) plus
// lobby-only presentation helpers and trophy-progression gating.
import { getModeUnlockReason } from "../../shared/trophyProgression";
import { mapsCatalog } from "../../shared/maps";
import {
  MODES,
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  legacyModeToVariantId,
  getModeById,
  getVariantDescriptor,
  getPlayersPerTeamForSelection,
  createSelectionCatalog,
} from "../../shared/gameSelection";

export {
  DEFAULT_MODE_ID,
  DEFAULT_VARIANT_ID,
  DEFAULT_MAP_ID,
  legacyModeToVariantId,
  getModeById,
  getVariantDescriptor,
  getPlayersPerTeamForSelection,
};

let getProgressionUser = () => null;
export function setSelectionProgressionUser(getUser) { getProgressionUser = getUser; }
export function getModeProgressionBlockReason(modeId) { return getModeUnlockReason(modeId, getProgressionUser()); }

// Built-in maps until the lobby registers the backend catalog.
const MAPS = Array.isArray(mapsCatalog?.maps) ? mapsCatalog.maps : [];

const catalog = createSelectionCatalog(() => MAPS);
export const {
  getMapById,
  getCompatibleMapsForSelection,
  isSelectionQueueable,
} = catalog;
export const normalizeGameSelection = catalog.normalizeSelection;

export function registerMapCatalog(entries) {
  if (!Array.isArray(entries)) return;
  MAPS.splice(0, MAPS.length, ...entries);
}

export function getAllGameModes() {
  return MODES.slice();
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

export function getSelectionBlockReason(selection, { usePartyHostAccess = false } = {}) {
  const unlockReason = usePartyHostAccess ? "" : getModeProgressionBlockReason(selection?.modeId);
  return unlockReason || catalog.getSelectionBlockReason(selection);
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
