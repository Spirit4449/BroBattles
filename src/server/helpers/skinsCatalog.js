const path = require("path");
const { DEFAULT_CHARACTER } = require("../../shared/characterStats.js");
const { createCatalogLoader } = require("./catalogLoader");

const CATALOG_PATH = path.resolve(__dirname, "../../shared/skinsCatalog.json");

function normalizeCharacterKey(character) {
  return String(character || "")
    .trim()
    .toLowerCase();
}

// One pass per catalog load: per-character skin lists (tagged with their
// character) plus an id index, so lookups never rescan the catalog.
function buildSkinIndexes(catalog) {
  const skinsByCharacter = new Map();
  const skinById = new Map();
  const defaultSkinIdByCharacter = new Map();
  const characters =
    catalog?.characters && typeof catalog.characters === "object"
      ? catalog.characters
      : {};
  for (const [key, entry] of Object.entries(characters)) {
    const skins = (Array.isArray(entry?.skins) ? entry.skins : []).map((skin) =>
      Object.freeze({ ...skin, character: key }),
    );
    skinsByCharacter.set(key, Object.freeze(skins));
    for (const skin of skins) {
      const id = String(skin?.id || "");
      if (!skinById.has(id)) skinById.set(id, skin);
    }
    const defaultSkinId =
      String(entry?.defaultSkinId || "").trim() ||
      String(skins[0]?.id || "").trim() ||
      null;
    defaultSkinIdByCharacter.set(key, defaultSkinId);
  }
  return { skinsByCharacter, skinById, defaultSkinIdByCharacter };
}

const loader = createCatalogLoader({
  name: "skins",
  filePath: CATALOG_PATH,
  fallback: () => ({ version: 1, characters: {} }),
  build: buildSkinIndexes,
});

function resolveCharacterAssetFolder(character) {
  const key = String(character || "")
    .trim()
    .toLowerCase();
  if (!key) return DEFAULT_CHARACTER;
  if (key === "huntress") return "huntress";
  return key;
}

function getSkinsCatalog() {
  return loader.get();
}

function invalidateSkinsCatalog() {
  loader.invalidate();
}

function getCatalogVersion() {
  return loader.version();
}

function getCharacterSkins(character) {
  const key = normalizeCharacterKey(character);
  if (!key) return [];
  return [...(loader.indexes().skinsByCharacter.get(key) || [])];
}

function getDefaultSkinId(character) {
  const key = normalizeCharacterKey(character);
  if (!key) return null;
  return loader.indexes().defaultSkinIdByCharacter.get(key) || null;
}

function getSkinById(skinId) {
  const id = String(skinId || "").trim();
  if (!id) return null;
  return loader.indexes().skinById.get(id) || null;
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
  getCatalogVersion,
  getSkinsCatalog,
  invalidateSkinsCatalog,
  getCharacterSkins,
  getDefaultSkinId,
  getSkinById,
  buildSkinAssetUrl,
  getSkinGameAssets,
  normalizeSelectedSkinMap,
  resolveSelectedSkinId,
};
