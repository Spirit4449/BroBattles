import terrainAudio from '../shared/terrainAudio.json';
import { playPlayerSound } from './playerAudio';

export function getTerrainSteps(terrain) {
  const config = terrainAudio.terrains[terrain];
  return config?.steps?.length ? config.steps : terrainAudio.terrains[terrainAudio.defaultTerrain].steps;
}

export function getTerrainConfig(terrain) {
  return terrainAudio.terrains[terrain] || terrainAudio.terrains[terrainAudio.defaultTerrain];
}

export function footstepVolume(speedRatio, directionChange, terrain) {
  const speed = Math.max(0, Math.min(1, Number(speedRatio) || 0));
  const terrainGain = Math.max(0, Number(getTerrainConfig(terrain).volumeScale) || 1);
  return Math.min(1, terrainGain * terrainAudio.footstepVolumeScale * ((directionChange ? 0.52 : 0.4) + speed * (directionChange ? 0.13 : 0.15)));
}

export function terrainLandingSound(terrain, baseVolume) {
  const landing = getTerrainConfig(terrain).landing;
  return {
    key: landing.key,
    volume: Math.min(1, Math.max(0, Number(baseVolume) || 0) * (Number(landing.volumeScale) || 1)),
  };
}

// Keep startup settling and delayed landing events silent until the fighter
// jumps or actually falls away from the first grounded position.
export function shouldPlayLandingSound(sprite, onGround, velocityY = sprite.body?.velocity?.y) {
  if (!sprite._suppressSpawnLandingSound) return true;
  if (sprite._spawnIntroPending) return false;
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
      volume: 1.75,
      rate: ducking ? 0.92 : 1.08,
    };
    if (source) playPlayerSound(scene, source, "sfx-duck-transition", options);
    else scene?.sound?.play?.("sfx-duck-transition", options);
  } catch (_) {}
}

export function playDuckBlockSound(scene) {
  try {
    scene?.sound?.play?.("sfx-duck-block", { volume: 0.5 });
  } catch (_) {}
}
