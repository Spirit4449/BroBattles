// src/characters/index.js
import CHARACTER_MANIFEST from "./manifest";
import { characterStats } from "../lib/characterStats.js";

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

export function createFor(character, deps) {
  const Cls = getCharacterClass(character);
  if (!Cls) return null;
  return new Cls(deps);
}

// Returns the Phaser texture key for a given character's main sprite/atlas
export function getTextureKey(character) {
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
export function handleRemoteAttack(scene, character, data, ownerWrapper) {
  const Cls = getCharacterClass(character);
  if (Cls && typeof Cls.handleRemoteAttack === "function") {
    Cls.handleRemoteAttack(scene, data, ownerWrapper);
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
) {
  const char = (character || "").toLowerCase();
  const anims = scene && scene.anims;
  if (!anims) return genericKey;

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
