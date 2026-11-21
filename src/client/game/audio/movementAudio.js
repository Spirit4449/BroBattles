import { clamp01 } from "../../../shared/math.js";
import terrainAudio from '../../../shared/physics/terrainAudio.json';
import { movementSoundKey } from '../../../shared/physics/movementSounds';
import { playerSoundVolume, playPlayerSound } from './playerAudio';

const terrainCueTimes = new WeakMap();

// Keep repeated steps around -39 dB K-weighted at full pace, with stronger
// landings around -31 dB. Bank Bust substitutes its own metal recordings.
const terrainSampleGain = {
  'sfx-step-1': 0.44, 'sfx-step-2': 0.52, 'sfx-step-3': 0.43,
  'sfx-grass-step-1': 0.48, 'sfx-grass-step-2': 0.49,
  'sfx-grass-step-3': 0.50, 'sfx-grass-step-4': 0.48,
  'sfx-truss-step-1': 0.80, 'sfx-truss-step-2': 0.87, 'sfx-truss-step-3': 1,
  'bank-bust-sfx-step-1': 0.41, 'bank-bust-sfx-step-2': 0.61, 'bank-bust-sfx-step-3': 0.39,
  'sfx-hard-land': 0.13, 'sfx-grass-land': 0.43, 'sfx-truss-land': 0.44,
  'bank-bust-sfx-hard-land': 0.15,
};

export function terrainSampleVolume(scene, key, volume) {
  return volume * (terrainSampleGain[movementSoundKey(scene, key)] ?? 1);
}

export function wallSlideVolume(speedRatio) {
  return 0.08 + clamp01(Number(speedRatio) || 0) * 0.06;
}

export function jumpVolume(speedRatio) {
  return 0.23 + clamp01(Number(speedRatio) || 0) * 0.06;
}

export const WALL_JUMP_VOLUME = 0.17;

// Shared mix for local and remote falling wind; retain the speed/time swell.
export function fallingAirVolume(speedRatio, timeRatio) {
  return (0.06 + clamp01(Number(speedRatio) || 0) * (0.16 + clamp01(Number(timeRatio) || 0) * 0.14)) * 0.5;
}

export function movementPlaybackTime(scene) {
  const manager = scene.sound;
  if (!manager || manager.locked ||
      (typeof document !== 'undefined' && document.hidden)) return null;
  const context = manager.context;
  if (!context) return performance.now();
  // The shared Web Audio context can be suspended while Phaser is unlocked.
  return context.state === 'running' ? context.currentTime * 1000 : null;
}

export function fallingAirRamp(elapsedMs) {
  return clamp01(elapsedMs / 220);
}

export function getTerrainSteps(terrain) {
  const config = terrainAudio.terrains[terrain];
  return config?.steps?.length ? config.steps : terrainAudio.terrains[terrainAudio.defaultTerrain].steps;
}

export function getTerrainConfig(terrain) {
  return terrainAudio.terrains[terrain] || terrainAudio.terrains[terrainAudio.defaultTerrain];
}

export function movementTerrainAt(scene, fighter, position) {
  return scene._movementTerrainAt?.(scene, fighter, position) ?? scene._terrainType;
}

export function footstepVolume(speedRatio, directionChange, terrain) {
  const speed = Math.max(0, Math.min(1, Number(speedRatio) || 0));
  const terrainGain = Math.max(0, Number(getTerrainConfig(terrain).volumeScale) || 1);
  return Math.min(1, terrainGain * terrainAudio.footstepVolumeScale * ((directionChange ? 0.52 : 0.4) + speed * (directionChange ? 0.13 : 0.15)));
}

export function terrainLandingSound(terrain, baseVolume, scene) {
  const landing = getTerrainConfig(terrain).landing;
  const gain = scene?.movementAudioProfile === "bank-bust" ? 1.2 : 1;
  return {
    key: landing.key,
    volume: terrainSampleVolume(scene, landing.key,
      Math.min(1, Math.max(0, Number(baseVolume) || 0) * (Number(landing.volumeScale) || 1) * gain)),
  };
}

// Share resonant surface cooldowns between local and remote fighters. A deck
// landing gets space to decay without footsteps stacking over its tail.
export function canPlayTerrainCue(scene, terrain, { volume, source, landingStrength }) {
  const cadence = getTerrainConfig(terrain).cadence;
  if (!cadence) return true;
  if (scene.sound?.locked || (source && playerSoundVolume(scene, source, volume) < 0.02)) return false;
  let surfaceTimes = terrainCueTimes.get(scene);
  if (!surfaceTimes) terrainCueTimes.set(scene, surfaceTimes = new Map());
  let times = surfaceTimes.get(terrain);
  if (!times) surfaceTimes.set(terrain, times = { stepAt: -Infinity, landAt: -Infinity });
  const now = scene.time.now;
  if (landingStrength !== undefined) {
    if (landingStrength < cadence.minLandingStrength || now < times.landAt) return false;
    times.landAt = now + cadence.landingGapMs;
    times.stepAt = now + cadence.landingTailMs;
  } else {
    if (now < times.stepAt) return false;
    times.stepAt = now + cadence.stepGapMs;
  }
  return true;
}

// Keep startup settling and delayed landing events silent until the fighter
// jumps or actually falls away from the first grounded position.
export function shouldPlayLandingSound(sprite, onGround, velocityY = sprite.body?.velocity?.y) {
  if (!sprite._suppressSpawnLandingSound) return true;
  const bottom = Number(sprite.body?.bottom ?? sprite.y);
  const spawnBottom = sprite._spawnLandingSoundBottom;
  const fallingAway = !onGround && Number.isFinite(spawnBottom) &&
    bottom - spawnBottom > 8 && velocityY > 40;
  if ((velocityY || 0) < -40 || fallingAway) {
    sprite._suppressSpawnLandingSound = false;
    return true;
  }
  if (onGround && Number.isFinite(bottom)) sprite._spawnLandingSoundBottom = bottom;
  return false;
}

export function preloadTerrainAudio(scene, staticPath) {
  const loaded = new Set();
  for (const terrain of Object.values(terrainAudio.terrains)) {
    for (const step of terrain.steps) {
      if (loaded.has(step.key)) continue;
      loaded.add(step.key);
      scene.load.audio(step.key, step.files.map(file => `${staticPath}/${file}`));
    }
    if (terrain.landing && !loaded.has(terrain.landing.key)) {
      loaded.add(terrain.landing.key);
      scene.load.audio(terrain.landing.key, terrain.landing.files.map(file => `${staticPath}/${file}`));
    }
  }
}

export function playDuckTransitionSound(scene, ducking, source = null) {
  try {
    const options = {
      volume: 0.57,
      rate: ducking ? 0.92 : 1.08,
    };
    if (source) playPlayerSound(scene, source, "sfx-duck-transition", options);
    else scene?.sound?.play?.("sfx-duck-transition", options);
  } catch (_) {}
}

export function playDuckBlockSound(scene) {
  try {
    scene?.sound?.play?.("sfx-duck-block", { volume: 0.25 });
  } catch (_) {}
}
