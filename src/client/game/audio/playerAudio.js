// One listener for every player-created sound. The watched fighter becomes the
// listener while spectating, so their own actions keep the local mix level.
const NEARBY_REMOTE_GAIN = 0.9;
const DISTANCE_SCALE_PX = 850;
const OFFSCREEN_FADE_PX = 360;

const finitePoint = point => Number.isFinite(point?.x) && Number.isFinite(point?.y);
const clamp01 = value => Math.max(0, Math.min(1, value));
const smoothstep = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};

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
  const volume = playerSoundVolume(scene, source, options.volume ?? 1);
  if (volume < 0.005) return false;
  return scene?.sound?.play?.(key, { ...options, volume }) || false;
}
