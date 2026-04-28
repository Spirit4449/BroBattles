// src/characters/index.js
import CHARACTER_MANIFEST from "./manifest";
import { characterStats } from "../lib/characterStats.js";
import {
  normalizeSkinId,
  buildCharacterSkinTextureKey,
  buildCharacterSkinAtlasUrls,
} from "../lib/skinAssets.js";

// Build the registry automatically from the manifest.
// Each class must have a static `key` string.
const registry = Object.fromEntries(
  CHARACTER_MANIFEST.map((Cls) => [Cls.key, Cls]),
);

export function getCharacterRegistry() {
  return registry;
}

function normalizeCharacterKey(character) {
  const key = String(character || "").toLowerCase();
  return registry[key] ? key : null;
}

function getCharacterClass(character) {
  const key = normalizeCharacterKey(character);
  return key ? registry[key] : null;
}

export function getCharacterClassByKey(character) {
  return getCharacterClass(character);
}

export function preloadAll(scene, staticPath) {
  // Preload assets for all registered characters (simple now, scalable later)
  for (const key of Object.keys(registry)) {
    const Cls = registry[key];
    if (Cls.preload) Cls.preload(scene, staticPath);
  }
}

function collectRosterVariants(roster = []) {
  const variants = new Map();
  for (const player of Array.isArray(roster) ? roster : []) {
    const character = normalizeCharacterKey(
      player?.char_class || player?.character,
    );
    if (!character) continue;
    const skinId = normalizeSkinId(player?.selected_skin_id);
    const key = `${character}:${skinId || "default"}`;
    if (!variants.has(key)) {
      variants.set(key, {
        character,
        skinId,
        gameAssets: player?.selected_skin_game_assets || null,
      });
    }
  }
  return Array.from(variants.values());
}

export function preloadForRoster(scene, roster = [], staticPath = "/assets") {
  const variants = collectRosterVariants(roster);
  const variantsByCharacter = new Map();
  for (const entry of variants) {
    if (!variantsByCharacter.has(entry.character)) {
      variantsByCharacter.set(entry.character, []);
    }
    variantsByCharacter.get(entry.character).push(entry);
  }

  for (const [character, entries] of variantsByCharacter.entries()) {
    const Cls = getCharacterClass(character);
    if (!Cls || typeof Cls.preload !== "function") continue;
    const needsDefaultAtlas = entries.some((entry) => !entry.skinId);
    Cls.preload(scene, staticPath, { includeBaseAtlas: needsDefaultAtlas });

    for (const entry of entries) {
      if (!entry.skinId) continue;
      const textureKey = buildCharacterSkinTextureKey(character, entry.skinId);
      const atlasUrls = entry.gameAssets?.spritesheetUrl
        ? {
            spritesheetUrl: String(entry.gameAssets.spritesheetUrl),
            animationsUrl:
              String(entry.gameAssets.animationsUrl || "").trim() ||
              `${staticPath}/${character}/animations.json`,
          }
        : buildCharacterSkinAtlasUrls(character, entry.skinId);

      if (!scene.textures.exists(textureKey)) {
        scene.load.atlas(
          textureKey,
          atlasUrls.spritesheetUrl,
          atlasUrls.animationsUrl,
        );
      }
    }
  }
}

export function setupFor(scene, character) {
  const Cls = getCharacterClass(character);
  if (Cls && Cls.setupAnimations) Cls.setupAnimations(scene);
}

export function setupAll(scene) {
  for (const key of Object.keys(registry)) {
    const Cls = registry[key];
    if (Cls && Cls.setupAnimations) Cls.setupAnimations(scene);
  }
}

function cloneBaseAnimationToVariant(scene, character, skinId) {
  const animManager = scene?.anims;
  if (!animManager || !character || !skinId) return;

  const textureKey = buildCharacterSkinTextureKey(character, skinId);
  if (!scene.textures.exists(textureKey)) return;

  const entries = animManager?.anims?.entries;
  if (!entries || typeof entries.forEach !== "function") return;

  entries.forEach((anim, key) => {
    if (!String(key || "").startsWith(`${character}-`)) return;
    const suffix = String(key).slice(character.length + 1);
    const variantKey = `${textureKey}-${suffix}`;
    if (animManager.exists(variantKey)) return;
    const frames = (Array.isArray(anim?.frames) ? anim.frames : [])
      .map((frameRef) => {
        const frameName = frameRef?.frame?.name;
        if (!frameName) return null;
        return { key: textureKey, frame: frameName };
      })
      .filter(Boolean);
    if (!frames.length) return;

    animManager.create({
      key: variantKey,
      frames,
      frameRate: Number(anim?.frameRate) || 12,
      repeat: Number(anim?.repeat) || 0,
      yoyo: !!anim?.yoyo,
      delay: Number(anim?.delay) || 0,
      repeatDelay: Number(anim?.repeatDelay) || 0,
      showOnStart: !!anim?.showOnStart,
      hideOnComplete: !!anim?.hideOnComplete,
    });
  });
}

export function setupVariantAnimationsForRoster(scene, roster = []) {
  const variants = collectRosterVariants(roster);
  for (const entry of variants) {
    if (!entry.skinId) continue;
    cloneBaseAnimationToVariant(scene, entry.character, entry.skinId);
  }
}

export function createFor(character, deps) {
  const Cls = getCharacterClass(character);
  if (!Cls) return null;
  return new Cls(deps);
}

// Returns the Phaser texture key for a given character's main sprite/atlas
export function getTextureKey(character, skinId = "") {
  const normalizedSkinId = normalizeSkinId(skinId);
  if (normalizedSkinId) {
    return buildCharacterSkinTextureKey(character, normalizedSkinId);
  }
  const Cls = getCharacterClass(character);
  // Prefer an explicit textureKey static, fallback to common "sprite"
  return (
    (Cls &&
      (Cls.textureKey ||
        (typeof Cls.getTextureKey === "function" && Cls.getTextureKey()))) ||
    "sprite"
  );
}

// Delegate handling of a remotely received attack to the character module
export function handleRemoteAttack(
  scene,
  character,
  data,
  ownerWrapper,
  remoteContext = {},
) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.handleRemoteAttack === "function") {
    Cls.handleRemoteAttack(scene, data, ownerWrapper, remoteContext);
    return true;
  }
  return false;
}

export function handleLocalAuthoritativeAttack(
  scene,
  character,
  data,
  localContext = {},
) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.handleLocalAuthoritativeAttack === "function") {
    Cls.handleLocalAuthoritativeAttack(scene, data, localContext);
    return true;
  }
  return false;
}

export function chooseRemoteAnimation(character, context = {}) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.chooseRemoteAnimation === "function") {
    return Cls.chooseRemoteAnimation(context);
  }
  return context.animation || "idle";
}

export function setAttackDebugState(enabled) {
  for (const Cls of Object.values(registry)) {
    if (Cls && typeof Cls.setDebugState === "function") {
      Cls.setDebugState(enabled);
    }
  }
}

// Resolve a generic animation key (e.g., 'idle') to a character-specific
// key (e.g., 'ninja-idle' or 'thorg-idle') if present; otherwise, fallback.
export function resolveAnimKey(
  scene,
  character,
  genericKey,
  fallback = "idle",
  skinId = "",
) {
  const char = (character || "").toLowerCase();
  const normalizedSkinId = normalizeSkinId(skinId);
  const skinTextureKey = normalizedSkinId
    ? buildCharacterSkinTextureKey(char, normalizedSkinId)
    : "";
  const anims = scene && scene.anims;
  if (!anims) return genericKey;

  if (skinTextureKey) {
    const variantPreferred = `${skinTextureKey}-${genericKey}`;
    if (anims.exists(variantPreferred)) return variantPreferred;
    const variantFallback = `${skinTextureKey}-${fallback}`;
    if (anims.exists(variantFallback)) return variantFallback;
  }

  // If a fully-qualified key is provided (e.g., "ninja-running"):
  if (genericKey && genericKey.includes("-")) {
    // 1) If it already matches this character and exists, use it as-is
    if (
      genericKey.toLowerCase().startsWith(`${char}-`) &&
      anims.exists(genericKey)
    ) {
      return genericKey;
    }
    // 2) Try remapping to this character's namespace preserving the suffix
    const suffix = genericKey.split("-").slice(1).join("-");
    const remapped = `${char}-${suffix}`;
    if (anims.exists(remapped)) return remapped;
    // 3) As a last resort, if the given key exists (even for other char), return it
    if (anims.exists(genericKey)) return genericKey;
  }

  // Generic (unprefixed) resolution flow
  const preferred = `${char}-${genericKey}`;
  if (anims.exists(preferred)) return preferred;
  if (anims.exists(genericKey)) return genericKey;
  const fbPreferred = `${char}-${fallback}`;
  if (anims.exists(fbPreferred)) return fbPreferred;
  return anims.exists(fallback) ? fallback : genericKey;
}

// Get merged stats for a character from centralized stats
export function getStats(character) {
  const key = normalizeCharacterKey(character);
  return (key && characterStats[key]) || characterStats.ninja;
}

// Optional: returns the Effects class for a character, or null if none
export function getEffectsClass(character) {
  const Cls = getCharacterClass(character);
  return (
    (Cls &&
      (Cls.Effects ||
        (typeof Cls.getEffects === "function" && Cls.getEffects()))) ||
    null
  );
}

export function applyCharacterPowerupFx(character, context = {}) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.applyPowerupFx === "function") {
    return Cls.applyPowerupFx(context);
  }
  return { handled: false, rageLike: false };
}

export function drawCharacterPowerupAura(character, context = {}) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.drawPowerupAura === "function") {
    return !!Cls.drawPowerupAura(context);
  }
  return false;
}

export function getCharacterPowerupMobilityModifier(character, effects = {}) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.getPowerupMobilityModifier === "function") {
    return Cls.getPowerupMobilityModifier(effects);
  }
  return { speedMult: 1, jumpMult: 1 };
}

export function getCharacterEffectTickSounds() {
  const merged = {};
  for (const Cls of Object.values(registry)) {
    if (!Cls || typeof Cls.getEffectTickSounds !== "function") continue;
    Object.assign(merged, Cls.getEffectTickSounds() || {});
  }
  return merged;
}

/**
 * Play a named sound event for a character using that class's sounds table.
 * @param {Phaser.Scene} scene
 * @param {string} character  - e.g. "ninja"
 * @param {string} event      - e.g. "attack", "hit", "special"
 * @param {object} [overrides] - optional { volume, rate } to override defaults
 * @returns {boolean} whether a sound was played
 */
export function playCharacterSound(scene, character, event, overrides = {}) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.playSound === "function") {
    return Cls.playSound(scene, event, overrides);
  }
  return false;
}
