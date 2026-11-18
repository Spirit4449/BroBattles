import { getUser, updateUser } from "../session.mjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { SOLO_MAP_STORAGE_KEY, SOLO_MODE_ID_STORAGE_KEY, SOLO_MODE_STORAGE_KEY, SOLO_MODE_VARIANT_STORAGE_KEY } from "../../../shared/storageKeys.js";
export { SOLO_MAP_STORAGE_KEY, SOLO_MODE_ID_STORAGE_KEY, SOLO_MODE_STORAGE_KEY, SOLO_MODE_VARIANT_STORAGE_KEY };
// Solo (no party) lobby selection, remembered in localStorage for guests and
// saved to the account for signed-in players.
import { normalizeGameSelection, selectionToLegacyMode } from "../../lib/gameSelectionCatalog.js";
import { postJson } from "../../lib/http.js";

function canPersistSoloSelections() {
  try {
    const probeKey = "__bb_selection_probe__";
    localStorage.setItem(probeKey, "1");
    localStorage.removeItem(probeKey);
    return true;
  } catch (_) {
    return false;
  }
}

function setSoloSelection(key, value) {
  if (!canPersistSoloSelections()) return;
  try {
    localStorage.setItem(key, String(value));
  } catch (_) {}
}

export function getSoloSelection(key) {
  if (!canPersistSoloSelections()) return null;
  try {
    return localStorage.getItem(key);
  } catch (_) {
    return null;
  }
}

export function getSavedSelectionFromUserData() {
  const selection = getUser()?.preferred_selection;
  if (!selection || typeof selection !== "object") return null;
  return normalizeGameSelection(selection);
}

export function rememberSoloSelection(selection, legacyMode = selectionToLegacyMode(selection)) {
  setSoloSelection(SOLO_MODE_ID_STORAGE_KEY, selection.modeId);
  setSoloSelection(
    SOLO_MODE_VARIANT_STORAGE_KEY,
    selection.modeVariantId || "",
  );
  setSoloSelection(SOLO_MODE_STORAGE_KEY, legacyMode);
  if (selection.mapId != null) {
    setSoloSelection(SOLO_MAP_STORAGE_KEY, selection.mapId);
  }
}

export async function persistSoloSelection(selection) {
  const normalized = normalizeGameSelection(selection);
  rememberSoloSelection(normalized);
  try {
    const data = await postJson(API_PATHS.SELECTION_PREFERENCES, { selection: normalized }, {
      fallbackMessage: "Failed to save selection",
    });
    updateUser({ preferred_selection: normalizeGameSelection(data?.selection || normalized) });
  } catch (error) {
    console.warn("[party] failed to persist solo selection", {
      selection: normalized,
      message: error?.message || String(error),
    });
  }
}
