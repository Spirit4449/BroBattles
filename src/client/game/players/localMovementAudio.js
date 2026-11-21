import { clamp01, lerp } from "../../../shared/math.js";
import { movementSoundKey } from "../../../shared/physics/movementSounds";
// Movement sounds for the local fighter: terrain footsteps plus the looping
// wall-slide scrape and falling-air rush. One instance per player module; the
// loops are (re)created per scene through attach().
import { MOVEMENT_VFX_CONFIG } from "../scene/effects";
import {
  canPlayTerrainCue, getTerrainSteps, footstepVolume, fallingAirVolume, movementTerrainAt,
  terrainSampleVolume, wallSlideVolume, movementPlaybackTime, fallingAirRamp,
} from "../audio/movementAudio";


export function createLocalMovementAudio() {
  let wallSlideLoop = null;
  let wallSlidePlaying = false;
  let fallAirLoop = null;
  let fallAirPlaying = false;
  let fallAirStartedAt = 0;
  let fallAirGain = 0;
  let footstepCursor = 0;
  let detachCacheListener = null;

  function stopFallAir() {
    if (fallAirPlaying) {
      try { fallAirLoop?.stop?.(); } catch (_) {}
      fallAirPlaying = false;
    }
    fallAirStartedAt = 0;
    fallAirGain = 0;
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
    detachCacheListener?.();
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
    footstepCursor = 0;
    const detach = () => {
      scene.cache.audio.events.off("add", ensureLoops);
      scene.events.off("shutdown", detach);
      if (detachCacheListener === detach) detachCacheListener = null;
    };
    const ensureLoops = () => {
      if (detachCacheListener !== detach) return;
      if (!scene.sound || scene.game?.config?.audio?.noAudio) return;
      if (!wallSlideLoop && scene.cache.audio.exists("sfx-sliding")) {
        wallSlideLoop = scene.sound.add("sfx-sliding", { loop: true, volume: 0 });
      }
      if (!fallAirLoop && scene.cache.audio.exists("sfx-fall-air")) {
        fallAirLoop = scene.sound.add("sfx-fall-air", { loop: true, volume: 0, rate: 0.72 });
      }
      if (wallSlideLoop && fallAirLoop) detach();
    };
    detachCacheListener = detach;
    scene.cache.audio.events.on("add", ensureLoops);
    scene.events.once("shutdown", detach);
    ensureLoops();
  }

  function playStep(scene, fighter, speedRatio, isDirectionChange) {
    const speed = clamp01(Number(speedRatio) || 0);
    const terrain = movementTerrainAt(scene, fighter);
    const steps = getTerrainSteps(terrain);
    const nextStep =
      (footstepCursor + (steps.length > 1 ? Phaser.Math.Between(1, steps.length - 1) : 1)) % steps.length;
    const key = steps[nextStep].key;
    const volume = terrainSampleVolume(scene, key, footstepVolume(speed, isDirectionChange, terrain));
    if (!canPlayTerrainCue(scene, terrain, { volume })) return;
    footstepCursor = nextStep;
    try {
      scene.sound.play(movementSoundKey(scene, key), {
        volume,
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
    const speed = clamp01(Number(speedRatio) || 0);
    wallSlideLoop.setVolume?.(wallSlideVolume(speed));
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
    const playbackTime = movementPlaybackTime(scene);
    if (playbackTime === null) {
      stopFallAir();
      return;
    }
    if (!shouldPlay) {
      if (fallAirPlaying) {
        fallAirGain = lerp(fallAirGain, 0, 0.12);
        fallAirLoop.setVolume?.(fallAirGain);
        if (fallAirGain <= 0.006) stopFallAir();
      }
      return;
    }

    if (!fallAirPlaying || fallAirLoop.isPlaying === false) {
      try {
        // Web Audio can report the previous gain until its next render quantum.
        fallAirGain = 0;
        fallAirLoop.setVolume?.(0);
        if (fallAirLoop.play?.({ volume: 0 }) === false) return;
        fallAirPlaying = true;
        fallAirStartedAt = playbackTime;
      } catch (_) { return; }
    }
    const speedRatio = clamp01((Number(velocityY) - 85) / (MOVEMENT_VFX_CONFIG.fastFallMaxVelocity - 85));
    const elapsed = playbackTime - fallAirStartedAt;
    const timeRatio = clamp01(elapsed / 950);
    const targetVolume = fallingAirVolume(speedRatio, timeRatio) * fallingAirRamp(elapsed);
    fallAirGain = lerp(fallAirGain, targetVolume, 0.075);
    fallAirLoop.setVolume?.(fallAirGain);
    fallAirLoop.setRate?.(0.72 + speedRatio * 0.24 + timeRatio * 0.04);
  }

  return { attach, dispose, stopLoops, stopFallAir, stopWallSlide, playStep, updateWallSlide, updateFallingAir };
}
