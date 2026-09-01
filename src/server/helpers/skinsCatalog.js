const path = require("path");

const CATALOG_PATH = path.resolve(__dirname, "../../shared/skinsCatalog.json");

let _cache = null;

function loadCatalog() {
  delete require.cache[CATALOG_PATH];
  const raw = require(CATALOG_PATH);
  return raw && typeof raw === "object" ? raw : {};
}

function resolveCharacterAssetFolder(character) {
  const key = String(character || "")
    .trim()
    .toLowerCase();
  if (!key) return "ninja";
  if (key === "huntress") return "huntress";
  return key;
}

function getSkinsCatalog() {
  try {
    _cache = loadCatalog();
  } catch (error) {
    console.error("[skins] failed to load catalog", error);
    _cache = { version: 1, characters: {} };
  }
  return _cache;
}

function getCharacterSkins(character) {
  const key = String(character || "")
    .trim()
    .toLowerCase();
  if (!key) return [];
  const catalog = getSkinsCatalog();
  const entry = catalog?.characters?.[key];
  const skins = Array.isArray(entry?.skins) ? entry.skins : [];
  return skins.map((skin) => ({ ...skin, character: key }));
}

function getDefaultSkinId(character) {
  const key = String(character || "")
    .trim()
    .toLowerCase();
  if (!key) return null;
  const catalog = getSkinsCatalog();
  const entry = catalog?.characters?.[key] || {};
  const defaultSkinId = String(entry.defaultSkinId || "").trim();
  if (defaultSkinId) return defaultSkinId;
  const skins = Array.isArray(entry.skins) ? entry.skins : [];
  return String(skins[0]?.id || "").trim() || null;
}

function getSkinById(skinId) {
  const id = String(skinId || "").trim();
  if (!id) return null;
  const catalog = getSkinsCatalog();
  const chars =
    catalog?.characters && typeof catalog.characters === "object"
      ? Object.keys(catalog.characters)
      : [];
  for (const character of chars) {
    const skins = getCharacterSkins(character);
    const found = skins.find((skin) => String(skin?.id || "") === id);
    if (found) return found;
  }
  return null;
}

function buildSkinAssetUrl(character, skinId) {
  const char = String(character || "")
    .trim()
    .toLowerCase();
  const assetFolder = resolveCharacterAssetFolder(char);
  if (!char) return null;
  const normalizedSkinId = String(skinId || "").trim();
  const defaultSkinId = getDefaultSkinId(char);
  const skin = normalizedSkinId ? getSkinById(normalizedSkinId) : null;
  if (skin && String(skin.character || "") === char) {
    const declaredUrl = String(skin.assetUrl || "").trim();
    if (declaredUrl) return declaredUrl;
    return normalizedSkinId === defaultSkinId
      ? `/assets/${assetFolder}/body.webp`
      : `/assets/${assetFolder}/skins/${normalizedSkinId}/body.webp`;
  }
  const defaultSkin = defaultSkinId ? getSkinById(defaultSkinId) : null;
  const defaultAssetUrl = String(defaultSkin?.assetUrl || "").trim();
  if (!normalizedSkinId || normalizedSkinId === defaultSkinId) {
    return defaultAssetUrl || `/assets/${assetFolder}/body.webp`;
  }
  // Never manufacture a URL for an unknown or cross-character skin id. A
  // stale selection should render the character's base body, not a broken img.
  return defaultAssetUrl || `/assets/${assetFolder}/body.webp`;
}

function getSkinGameAssets(character, skinId) {
  const char = String(character || "")
    .trim()
    .toLowerCase();
  const assetFolder = resolveCharacterAssetFolder(char);
  if (!char) return null;
  const skin = getSkinById(skinId);
  if (!skin || String(skin.character || "") !== char) return null;
  const assets =
    skin.gameAssets && typeof skin.gameAssets === "object"
      ? skin.gameAssets
      : {};
  const defaultSkinId = getDefaultSkinId(char);
  const normalizedSkinId = String(skinId || "").trim();
  const usesDefaultAtlas =
    !normalizedSkinId || normalizedSkinId === defaultSkinId;
  const skinAssetDir = usesDefaultAtlas
    ? `/assets/${assetFolder}`
    : `/assets/${assetFolder}/skins/${normalizedSkinId}`;
  const result = {
    spritesheetUrl:
      String(assets.spritesheetUrl || "").trim() ||
      `${skinAssetDir}/spritesheet.webp`,
    animationsUrl:
      String(assets.animationsUrl || "").trim() ||
      `${skinAssetDir}/animations.json`,
  };
  const weaponUrl = String(assets.weaponUrl || "").trim();
  if (weaponUrl) result.weaponUrl = weaponUrl;
  return result;
}

function normalizeSelectedSkinMap(raw) {
  if (!raw) return {};
  if (typeof raw === "object") {
    return Object.fromEntries(
      Object.entries(raw)
        .map(([character, skinId]) => [
          String(character || "")
            .trim()
            .toLowerCase(),
          String(skinId || "").trim(),
        ])
        .filter(([character, skinId]) => character && skinId),
    );
  }
  try {
    return normalizeSelectedSkinMap(JSON.parse(String(raw || "{}")));
  } catch (_) {
    return {};
  }
}

function resolveSelectedSkinId({ character, selectedSkinMap, ownedSkinIds }) {
  const char = String(character || "")
    .trim()
    .toLowerCase();
  if (!char) return null;
  const map = normalizeSelectedSkinMap(selectedSkinMap);
  const ownershipProvided = Array.isArray(ownedSkinIds);
  const owned = new Set(
    (ownershipProvided ? ownedSkinIds : []).map(String),
  );
  const desired = String(map[char] || "").trim();
  const defaultSkinId = getDefaultSkinId(char);

  if (desired) {
    const skin = getSkinById(desired);
    if (
      skin &&
      skin.character === char &&
      (!ownershipProvided || owned.has(desired))
    ) {
      return desired;
    }
  }

  if (defaultSkinId && (!ownershipProvided || owned.has(defaultSkinId))) {
    return defaultSkinId;
  }

  const firstOwnedForCharacter = getCharacterSkins(char).find((skin) =>
    owned.has(String(skin.id || "")),
  );
  if (firstOwnedForCharacter) return String(firstOwnedForCharacter.id);

  return defaultSkinId || null;
}

module.exports = {
  getSkinsCatalog,
  getCharacterSkins,
  getDefaultSkinId,
  getSkinById,
  buildSkinAssetUrl,
  getSkinGameAssets,
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
};
