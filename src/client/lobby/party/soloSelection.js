// Solo (no party) lobby selection, remembered in localStorage for guests and
// saved to the account for signed-in players.
import { normalizeGameSelection, selectionToLegacyMode } from "../../lib/gameSelectionCatalog.js";

export const SOLO_MODE_STORAGE_KEY = "bb_solo_mode";
export const SOLO_MODE_ID_STORAGE_KEY = "bb_solo_mode_id";
export const SOLO_MODE_VARIANT_STORAGE_KEY = "bb_solo_mode_variant_id";
export const SOLO_MAP_STORAGE_KEY = "bb_solo_map";

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

export function setSoloSelection(key, value) {
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
  const selection = window.__BRO_BATTLES_USERDATA__?.preferred_selection;
  if (!selection || typeof selection !== "object") return null;
  return normalizeGameSelection(selection);
}

export async function persistSoloSelection(selection) {
  const normalized = normalizeGameSelection(selection);
  setSoloSelection(SOLO_MODE_ID_STORAGE_KEY, normalized.modeId);
  setSoloSelection(
    SOLO_MODE_VARIANT_STORAGE_KEY,
    normalized.modeVariantId || "",
  );
  setSoloSelection(SOLO_MODE_STORAGE_KEY, selectionToLegacyMode(normalized));
  if (normalized.mapId != null) {
    setSoloSelection(SOLO_MAP_STORAGE_KEY, normalized.mapId);
  }

  try {
    const response = await fetch("/selection-preferences", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "same-origin",
      body: JSON.stringify({ selection: normalized }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || "Failed to save selection");
    }
    if (window.__BRO_BATTLES_USERDATA__) {
      window.__BRO_BATTLES_USERDATA__.preferred_selection =
        normalizeGameSelection(data?.selection || normalized);
    }
  } catch (error) {
    console.warn("[party] failed to persist solo selection", {
      selection: normalized,
      message: error?.message || String(error),
    });
  }
}
