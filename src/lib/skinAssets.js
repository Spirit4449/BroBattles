export function normalizeSkinId(skinId) {
  const value = String(skinId || "").trim();
  if (!value || value === "default" || value.endsWith("-default")) return "";
  return value;
}

export function resolveCharacterAssetFolder(character) {
  const key = String(character || "")
    .trim()
    .toLowerCase();
  if (!key) return "ninja";
  if (key === "huntress") return "huntress";
  return key;
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
  const skin = normalizeSkinId(skinId);
  if (!char) return "/assets/ninja/body.webp";
  return skin
    ? `/assets/${char}/skins/${skin}/body.webp`
    : `/assets/${char}/body.webp`;
}

export function buildCharacterSkinAtlasUrls(character, skinId) {
  const char = resolveCharacterAssetFolder(character);
  const skin = normalizeSkinId(skinId);
  if (!char) {
    return {
      spritesheetUrl: "/assets/ninja/spritesheet.webp",
      animationsUrl: "/assets/ninja/animations.json",
    };
  }
  return {
    spritesheetUrl: skin
      ? `/assets/${char}/skins/${skin}/spritesheet.webp`
      : `/assets/${char}/spritesheet.webp`,
    animationsUrl: `/assets/${char}/animations.json`,
  };
}
