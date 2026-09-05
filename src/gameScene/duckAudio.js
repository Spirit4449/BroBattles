export function playDuckTransitionSound(scene, ducking) {
  try {
    scene?.sound?.play?.("sfx-duck-transition", {
      volume: 0.9,
      rate: ducking ? 0.92 : 1.08,
    });
  } catch (_) {}
}

export function playDuckBlockSound(scene) {
  try {
    scene?.sound?.play?.("sfx-duck-block", { volume: 0.5 });
  } catch (_) {}
}
