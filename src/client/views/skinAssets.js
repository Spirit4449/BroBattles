import SKINS_CATALOG from "../../shared/catalogs/skinsCatalog.json";
import { DEFAULT_CHARACTER, canonicalCharacterKey } from "../../shared/characters/characterStats.js";

export function normalizeSkinId(skinId) {
  const value = String(skinId || "").trim();
  if (!value || value === "default" || value.endsWith("-default")) return "";
  return value;
}

function resolveCatalogSkin(character, skinId) {
  const char = canonicalCharacterKey(character);
  const entry = SKINS_CATALOG?.characters?.[char] || null;
  const skins = Array.isArray(entry?.skins) ? entry.skins : [];
  const defaultSkinId =
    String(entry?.defaultSkinId || "").trim() ||
    String(skins[0]?.id || "").trim();
  const requestedRaw = String(skinId || "").trim();
  const requestedSkinId = normalizeSkinId(requestedRaw)
    ? requestedRaw
    : defaultSkinId;
  const requested = skins.find(
    (skin) => String(skin?.id || "").trim() === requestedSkinId,
  );
  const defaultSkin = skins.find(
    (skin) => String(skin?.id || "").trim() === defaultSkinId,
  );
  return {
    char,
    skin: requested || defaultSkin || null,
    skinId: String((requested || defaultSkin)?.id || "").trim(),
    defaultSkinId,
  };
}

export function resolveCharacterAssetFolder(character) {
  return canonicalCharacterKey(character) || DEFAULT_CHARACTER;
}

export function buildCharacterSkinTextureKey(character, skinId) {
  const char = String(character || "")
    .trim()
    .toLowerCase();
  const skin = normalizeSkinId(skinId);
  if (!char) return "sprite";
  return skin ? `${char}__${skin}` : char;
}

export function buildCharacterSkinBodyUrl(character, skinId) {
  const char = resolveCharacterAssetFolder(character);
  if (!char) return "/assets/ninja/body.webp";
  const resolved = resolveCatalogSkin(character, skinId);
  const catalogUrl = String(resolved.skin?.assetUrl || "").trim();
  if (catalogUrl) return catalogUrl;
  const skin = normalizeSkinId(resolved.skinId || skinId);
  return skin
    ? `/assets/${char}/skins/${skin}/body.webp`
    : `/assets/${char}/body.webp`;
}

export function buildCharacterSkinAtlasUrls(character, skinId) {
  const char = resolveCharacterAssetFolder(character);
  if (!char) {
    return {
      spritesheetUrl: "/assets/ninja/spritesheet.webp",
      animationsUrl: "/assets/ninja/animations.json",
    };
  }
  const resolved = resolveCatalogSkin(character, skinId);
  const skin = normalizeSkinId(resolved.skinId || skinId);
  const assets =
    resolved.skin?.gameAssets && typeof resolved.skin.gameAssets === "object"
      ? resolved.skin.gameAssets
      : {};
  return {
    spritesheetUrl: skin
      ? String(assets.spritesheetUrl || "").trim() ||
        `/assets/${char}/skins/${skin}/spritesheet.webp`
      : String(assets.spritesheetUrl || "").trim() ||
        `/assets/${char}/spritesheet.webp`,
    animationsUrl: skin
      ? String(assets.animationsUrl || "").trim() ||
        `/assets/${char}/skins/${skin}/animations.json`
      : String(assets.animationsUrl || "").trim() ||
        `/assets/${char}/animations.json`,
  };
}

// Runtime asset metadata for a non-default skin (empty for base art).
export function getSkinGameAssets(character, skinId) {
  if (!normalizeSkinId(skinId)) return {};
  const assets = resolveCatalogSkin(character, skinId).skin?.gameAssets;
  return assets && typeof assets === "object" ? assets : {};
}

export function buildCharacterSkinWeaponUrl(character, skinId) {
  const resolved = resolveCatalogSkin(character, skinId);
  return String(resolved.skin?.gameAssets?.weaponUrl || "").trim() || null;
}
