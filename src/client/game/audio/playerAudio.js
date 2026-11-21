import { smoothstep } from "../../../shared/math.js";
// One listener for every player-created sound. The watched fighter becomes the
// listener while spectating, so their own actions keep the local mix level.
const NEARBY_REMOTE_GAIN = 0.9;
const DISTANCE_SCALE_PX = 850;
const OFFSCREEN_FADE_PX = 360;

const COMBAT_SOUND_GAIN = 10 ** (0.5 / 20);
export const SUPER_SOUND_GAIN = 10 ** (1 / 20);
const SERAPH_SOUND_GAIN = SUPER_SOUND_GAIN * 10 ** (8 / 20);
// Calibrated to -27 dB K-weighted loudness over each sample's loudest 200 ms.
// The shared damage cue sits below the character impact it often plays with.
const combatSoundVolumes = new Map([
  ["draven-fireball", 0.122],
  ["draven-hit", 0.225],
  ["draven-special", 0.064 * SUPER_SOUND_GAIN],
  ["draven-inferno-ignite", 0.120],
  ["draven-inferno-crackle", 0.160],
  ["draven-inferno-pulse", 0.172],
  ["draven-inferno-hit", 0.182],
  ["draven-inferno-end", 0.111],
  // Inferno layers (scripts/art/draven-pixel/inferno-sfx.cjs prints these).
  ["draven-inferno-ignite", 0.119 * SUPER_SOUND_GAIN],
  ["draven-inferno-crackle", 0.227 * SUPER_SOUND_GAIN],
  ["draven-inferno-pulse", 0.172 * SUPER_SOUND_GAIN],
  ["draven-inferno-end", 0.132 * SUPER_SOUND_GAIN],
  ["draven-inferno-hit", 0.182],
  ["gloop-attack", 0.138],
  ["gloop-hit", 0.198],
  ["gloop-special", 0.140 * SUPER_SOUND_GAIN],
  ["gloop-pull", 0.132 * SUPER_SOUND_GAIN],
  ["shurikenThrow", 1.17],
  ["shurikenHit", 2.55],
  ["shurikenHitWood", 0.349],
  // Shuriken Swarm layers (scripts/art/ninja-pixel/swarm-sfx.cjs prints these).
  ["ninja-swarm-cast", 0.237 * SUPER_SOUND_GAIN],
  ["ninja-swarm-throw", 0.936],
  // Fifteen pockets land close together; each sits under the throws.
  ["ninja-swarm-pocket", 0.453 * 0.7],
  ["ninja-swarm-pocket-crown", 0.208 * 0.7],
  // Under a flying shuriken: present, never louder than its throw.
  ["ninja-shuriken-flight", 0.258 * 0.55],
  ["ninja-shuriken-hit", 0.437],
  ["ozzy-fireball", 0.244],
  ["ozzy-impact", 0.095],
  ["ozzy-special", 0.076 * SUPER_SOUND_GAIN],
  ["sparrow-attack", 0.163],
  ["sparrow-hit", 0.122],
  ["sparrow-special", 0.157 * SUPER_SOUND_GAIN],
  // The measured charge peak sits below the release (seraph-sfx.cjs).
  ["sparrow-seraph-aim", 0.100 * SERAPH_SOUND_GAIN],
  ["sparrow-seraph-release", 0.160 * SERAPH_SOUND_GAIN],
  ["thorg-throw", 0.256],
  ["thorg-sweep", 0.246],
  ["thorg-hit", 0.087],
  ["sfx-damage", 3.1],
  ["sfx-stomp", 0.265],
]);

export function combatSoundVolume(key) {
  const volume = combatSoundVolumes.get(key);
  return volume === undefined ? 1 : volume * COMBAT_SOUND_GAIN;
}

const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);

export function playerAudioListener(scene) {
  if (scene?._spectatorModeActive) {
    const watched = scene._spectatedPlayerAudioSprite;
    if (watched?.active !== false && finitePoint(watched)) return watched;
    return scene.cameras?.main?.midPoint || null;
  }
  const local = scene?._localPlayerAudioSprite;
  if (local?.active !== false && finitePoint(local)) return local;
  return scene?.cameras?.main?.midPoint || null;
}

function offscreenDistance(scene, source) {
  const view = scene?.cameras?.main?.worldView;
  if (![view?.x, view?.y, view?.width, view?.height].every(Number.isFinite)) return 0;
  const dx = Math.max(view.x - source.x, 0, source.x - (view.x + view.width));
  const dy = Math.max(view.y - source.y, 0, source.y - (view.y + view.height));
  return Math.hypot(dx, dy);
}

export function playerSoundVolume(scene, source, baseVolume = 1) {
  const requestedVolume = Number(baseVolume);
  const base = Number.isFinite(requestedVolume) ? Math.max(0, requestedVolume) : 0;
  if (!base) return 0;
  const listener = playerAudioListener(scene);
  if (source === listener && source) return base;
  if (!finitePoint(source) || !finitePoint(listener) ||
      source?.active === false) return 0;
  const distance = Math.hypot(source.x - listener.x, source.y - listener.y);
  const proximity = 1 / (1 + (distance / DISTANCE_SCALE_PX) ** 2);
  const screenFade = 1 - smoothstep(offscreenDistance(scene, source) / OFFSCREEN_FADE_PX);
  return base * NEARBY_REMOTE_GAIN * proximity * screenFade;
}

export function playPlayerSound(scene, source, key, options = {}) {
  const volume = playerSoundVolume(scene, source, options.volume ?? combatSoundVolume(key));
  if (volume < 0.005) return false;
  return scene?.sound?.play?.(key, { ...options, volume }) || false;
}
