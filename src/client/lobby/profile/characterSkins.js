import { updateUser } from "../session.mjs";
import { API_PATHS } from "../../../shared/net/apiPaths.js";
import { getJson } from "../../lib/http.js";
import { getCharacterStats } from "../../../shared/characters/characterStats.js";
import { playSound } from "../../ui/uiSounds.js";
import { buildCharacterSkinBodyUrl } from "../../views/skinAssets.js";
import { resolveBodyPortrait } from "../../views/bodyPortraitAssets.js";
import SKINS_CATALOG from "../../../shared/catalogs/skinsCatalog.cjs";

export function normalizeCharacterId(character) {
  return String(character || "")
    .trim()
    .toLowerCase();
}

async function fetchJsonSafe(path) {
  try {
    return await getJson(path);
  } catch (_) {
    return null;
  }
}

export function createCharacterSkins(state, { selectCharacter, blockCharacterChangeWhileReady, updateSkinDetails }) {
  let ownedSkinIds = new Set();
  let skinBootstrapPromise = null;

  function resetSkinOwnership(userData) {
    ownedSkinIds = new Set(
      (Array.isArray(userData?.owned_skin_ids) ? userData.owned_skin_ids : [])
        .map((skinId) => String(skinId || "").trim())
        .filter(Boolean),
    );
    state.confirmedSkinSelections = Object.create(null);
  }

  async function bootstrapSkinState() {
    if (skinBootstrapPromise) return skinBootstrapPromise;
    skinBootstrapPromise = fetchJsonSafe(API_PATHS.SKINS_OWNED)
      .then((ownedRes) => {
        const ownedIds = Array.isArray(ownedRes?.ownedSkinIds)
          ? ownedRes.ownedSkinIds
          : Array.isArray(state.userData?.owned_skin_ids)
            ? state.userData.owned_skin_ids
            : [];
        ownedSkinIds = new Set(
          ownedIds.map((skinId) => String(skinId || "").trim()).filter(Boolean),
        );

        const selectedMap =
          ownedRes?.selectedSkinIdByCharacter &&
          typeof ownedRes.selectedSkinIdByCharacter === "object"
            ? ownedRes.selectedSkinIdByCharacter
            : state.userData?.selected_skin_id_by_char || {};
        const currentSelectedMap = {
          ...selectedMap,
          // A selection POST may finish while this earlier GET is still in
          // flight. Confirmed local writes must win over that stale response.
          ...state.confirmedSkinSelections,
        };

        if (state.detailsUi) {
          state.detailsUi.selectedSkinByCharacter = {
            ...currentSelectedMap,
            // Never replace a skin the user is actively previewing with a late
            // bootstrap response from before the picker was opened.
            ...state.detailsUi.selectedSkinByCharacter,
          };
        }
        if (state.userData) {
          updateUser({ selected_skin_id_by_char: {
            ...(state.userData.selected_skin_id_by_char || {}),
            ...currentSelectedMap,
          }, owned_skin_ids: Array.from(ownedSkinIds) });
        }
      })
      .finally(() => {
        skinBootstrapPromise = null;
      });
    return skinBootstrapPromise;
  }

  function getCatalogCharacterSkins(character) {
    const chars = SKINS_CATALOG?.characters;
    if (!chars || typeof chars !== "object") return [];
    const entry = chars[String(character || "").toLowerCase()] || {};
    return Array.isArray(entry.skins) ? entry.skins : [];
  }

  function getCharacterSkinList(character) {
    const characterId = normalizeCharacterId(character);
    const catalogSkins = getCatalogCharacterSkins(characterId);
    const characterUnlocked =
      Number(state.userData?.char_levels?.[characterId] ??
        state.userData?.char_levels?.[character] ??
        0) >= 1;
    let normalized = catalogSkins
      .map((skin, index) => {
        const id =
          String(skin?.id || skin?.skinId || skin?.key || "").trim() ||
          (index === 0 ? "default" : `skin-${index + 1}`);
        const available = skin?.available !== false;
        // Always allow the base/default skin once the character is unlocked,
        // even if the skins service hasn't refreshed ownership yet.
        const owned = (index === 0 && characterUnlocked) || ownedSkinIds.has(id);
        if (!owned && !available) return null;
        return {
          id,
          label:
            String(skin?.label || skin?.name || skin?.title || "").trim() ||
            (index === 0 ? "Default" : `Skin ${index + 1}`),
          previewSrc:
            String(
              skin?.assetUrl ||
                skin?.previewSrc ||
                skin?.bodySrc ||
                skin?.src ||
                "",
          ).trim() || buildCharacterSkinBodyUrl(characterId, id),
          owned,
          locked: !owned,
          rarity: String(skin?.rarity || "common").trim().toLowerCase(),
        };
      })
      .filter(Boolean);

    if (normalized.length === 0) {
      const stats = getCharacterStats(character) || {};
      const skins = Array.isArray(stats.skins) ? stats.skins : [];
      normalized = skins
        .map((skin, index) => ({
          id:
            String(skin?.id || skin?.skinId || skin?.key || "").trim() ||
            (index === 0 ? "default" : `skin-${index + 1}`),
          label:
            String(skin?.label || skin?.name || skin?.title || "").trim() ||
            (index === 0 ? "Default" : `Skin ${index + 1}`),
          previewSrc:
            String(skin?.previewSrc || skin?.bodySrc || skin?.src || "").trim() ||
            buildCharacterSkinBodyUrl(characterId, ""),
          owned: true,
          locked: false,
          rarity: String(skin?.rarity || "common").trim().toLowerCase(),
        }))
        .filter((skin) => skin.id);
    }

    if (normalized.length === 0) {
      normalized.push({
        id: "default",
        label: "Default",
        previewSrc: buildCharacterSkinBodyUrl(characterId, ""),
        owned: true,
        locked: false,
        rarity: "common",
      });
    }

    return normalized;
  }

  function getSelectedSkin(character) {
    const characterId = normalizeCharacterId(character);
    const selectedByUserData = String(
      state.userData?.selected_skin_id_by_char?.[characterId] || "",
    ).trim();
    const skinId = String(
      state.detailsUi?.selectedSkinByCharacter?.[characterId] ||
        selectedByUserData,
    ).trim();
    const skins = getCharacterSkinList(characterId);
    return skins.find((skin) => skin.id === skinId) || skins[0];
  }

  async function setSelectedSkin(character, skinId, direction = 1) {
    if (!state.detailsUi) return;
    if (state.selectionPromise || blockCharacterChangeWhileReady()) return;
    const characterId = normalizeCharacterId(character);
    const skins = getCharacterSkinList(characterId);
    const nextSkin =
      skins.find((skin) => skin.id === String(skinId || "")) || skins[0];
    const previousSkinId = getSelectedSkin(characterId)?.id;
    if (previousSkinId !== nextSkin.id) playSound("skinSwitch", 0.75);
    state.detailsUi.selectedSkinByCharacter[characterId] = nextSkin.id;
    // Locked skins remain previewable, but only owned skins are equipped.
    const saving = nextSkin.locked ? null : selectCharacter(characterId, { closeAfterSelection: false });
    if (state.detailsUi.currentCharacter === characterId) {
      updateSkinDetails(characterId, direction);
    }
    if (saving) {
      const saved = await saving;
      if (!saved) state.detailsUi.selectedSkinByCharacter[characterId] = previousSkinId;
      if (state.detailsUi.currentCharacter === characterId) updateSkinDetails(characterId, saved ? direction : -direction);
    }
  }

  function cycleSkin(character, direction) {
    const skins = getCharacterSkinList(character);
    const index = Math.max(0, skins.findIndex(skin => skin.id === getSelectedSkin(character)?.id));
    return setSelectedSkin(character, skins[(index + direction + skins.length) % skins.length].id, direction);
  }

  function resolveCharacterPreviewAsset(character, skinId) {
    const skins = getCharacterSkinList(character);
    const skin =
      skins.find((entry) => entry.id === String(skinId || "")) || skins[0];
    return resolveBodyPortrait(skin?.previewSrc || buildCharacterSkinBodyUrl(character, skin?.id));
  }

  return { resetSkinOwnership, bootstrapSkinState, getCharacterSkinList, getSelectedSkin, cycleSkin, resolveCharacterPreviewAsset };
}
