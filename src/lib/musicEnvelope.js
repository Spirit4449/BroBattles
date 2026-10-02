import { getSettings, subscribeSettings } from '../site/preferences';

// Keep the settings multiplier separate from the scene's musical intensity.
export function bindMusicEnvelope(audio, baseVolume, initial = 1) {
  let intensity = 0, frame, disposed = false;
  const apply = () => { audio.volume = Math.max(0, Math.min(1, baseVolume * intensity * getSettings().music)); };
  const unsubscribe = subscribeSettings(apply);
  function fade(target, duration = 1000) {
    if (disposed) return;
    cancelAnimationFrame(frame);
    const from = intensity, start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / duration);
      intensity = from + (target - from) * t * t * (3 - 2 * t);
      apply();
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
  }
  apply();
  fade(initial, 1200);
  return { fade, dispose() { disposed = true; cancelAnimationFrame(frame); unsubscribe(); } };
}
