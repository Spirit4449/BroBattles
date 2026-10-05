// Movement sounds for the local fighter: terrain footsteps plus the looping
// wall-slide scrape and falling-air rush. One instance per player module; the
// loops are (re)created per scene through attach().
import { MOVEMENT_VFX_CONFIG } from "../scene/effects";
import { getTerrainSteps, footstepVolume } from "../audio/movementAudio";

const clamp = (value) => Math.max(0, Math.min(1, value)); // Phaser.Math.Clamp semantics
const clamp01 = (value) => clamp(Number(value) || 0);
const lerp = (from, to, t) => from + (to - from) * t;

export function createLocalMovementAudio() {
  let wallSlideLoop = null;
  let wallSlidePlaying = false;
  let fallAirLoop = null;
  let fallAirPlaying = false;
  let fallAirStartedAt = 0;
  let footstepCursor = 0;

  function stopFallAir() {
    if (fallAirPlaying) {
      try { fallAirLoop?.stop?.(); } catch (_) {}
      fallAirPlaying = false;
    }
    fallAirStartedAt = 0;
  }

  function stopWallSlide() {
    if (!wallSlidePlaying) return;
    try { wallSlideLoop?.stop?.(); } catch (_) {}
    wallSlidePlaying = false;
  }

  function stopLoops() {
    stopWallSlide();
    stopFallAir();
  }

  function dispose() {
    stopLoops();
    try { wallSlideLoop?.destroy?.(); } catch (_) {}
    try { fallAirLoop?.destroy?.(); } catch (_) {}
    wallSlideLoop = null;
    fallAirLoop = null;
  }

  // Loop sounds may finish loading after the player is created; create each
  // as soon as its audio enters the cache.
  function attach(scene) {
    dispose();
    const ensureLoops = () => {
      if (!scene.sound || scene.game?.config?.audio?.noAudio) return;
      if (!wallSlideLoop && scene.cache.audio.exists("sfx-sliding")) {
        wallSlideLoop = scene.sound.add("sfx-sliding", { loop: true, volume: 0 });
      }
      if (!fallAirLoop && scene.cache.audio.exists("sfx-fall-air")) {
        fallAirLoop = scene.sound.add("sfx-fall-air", { loop: true, volume: 0, rate: 0.72 });
      }
      if (wallSlideLoop && fallAirLoop) scene.cache.audio.events.off("add", ensureLoops);
    };
    scene.cache.audio.events.on("add", ensureLoops);
    ensureLoops();
    scene.events.once("shutdown", () => {
      scene.cache.audio.events.off("add", ensureLoops);
    });
  }

  function playStep(scene, speedRatio, isDirectionChange) {
    const speed = clamp01(speedRatio);
    const steps = getTerrainSteps(scene._terrainType);
    footstepCursor =
      (footstepCursor + (steps.length > 1 ? Phaser.Math.Between(1, steps.length - 1) : 1)) % steps.length;
    try {
      scene.sound.play(steps[footstepCursor].key, {
        volume: footstepVolume(speed, isDirectionChange, scene._terrainType),
        rate: (isDirectionChange ? 0.88 : 0.94) + speed * 0.14,
      });
    } catch (_) {}
  }

  function updateWallSlide(shouldPlay, speedRatio = 0) {
    if (!wallSlideLoop) return;
    if (!shouldPlay) {
      stopWallSlide();
      return;
    }
    const speed = clamp01(speedRatio);
    wallSlideLoop.setVolume?.(0.28 + speed * 0.17);
    wallSlideLoop.setRate?.(0.84 + speed * 0.22);
    if (!wallSlidePlaying) {
      try {
        wallSlideLoop.play();
        wallSlidePlaying = true;
      } catch (_) {}
    }
  }

  function updateFallingAir(scene, shouldPlay, velocityY) {
    if (!fallAirLoop) return;
    if (!shouldPlay) {
      if (fallAirPlaying) {
        const faded = lerp(Number(fallAirLoop.volume) || 0, 0, 0.12);
        fallAirLoop.setVolume?.(faded);
        if (faded <= 0.006) {
          try { fallAirLoop.stop(); } catch (_) {}
          fallAirPlaying = false;
          fallAirStartedAt = 0;
        }
      } else {
        fallAirStartedAt = 0;
      }
      return;
    }

    if (!fallAirPlaying) {
      try {
        // A match can begin before the browser has unlocked audio. Do not
        // start the fade clock until playback can actually begin; otherwise
        // the queued first loop becomes audible at its already-ramped volume.
        if (scene.sound?.locked) {
          fallAirStartedAt = 0;
          return;
        }
        fallAirLoop.setVolume?.(0);
        if (fallAirLoop.play?.({ volume: 0 }) === false) return;
        fallAirPlaying = true;
        fallAirStartedAt = Date.now();
      } catch (_) {}
    }
    const speedRatio = clamp((Number(velocityY) - 85) / (MOVEMENT_VFX_CONFIG.fastFallMaxVelocity - 85));
    const timeRatio = clamp((Date.now() - (fallAirStartedAt || Date.now())) / 950);
    const targetVolume = 0.06 + speedRatio * (0.16 + timeRatio * 0.14);
    fallAirLoop.setVolume?.(lerp(Number(fallAirLoop.volume) || 0, targetVolume, 0.075));
    fallAirLoop.setRate?.(0.72 + speedRatio * 0.24 + timeRatio * 0.04);
  }

  return { attach, dispose, stopLoops, stopFallAir, stopWallSlide, playStep, updateWallSlide, updateFallingAir };
}
