import terrainAudio from '../shared/terrainAudio.json';

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

// Consume the initial spawn's landing silently, even if the first gameplay
// frame is still slightly airborne. A deliberate jump re-arms normal audio.
export function shouldPlayLandingSound(sprite, onGround) {
  if (!sprite._suppressSpawnLandingSound) return true;
  if ((sprite.body?.velocity?.y || 0) < -1) {
    sprite._suppressSpawnLandingSound = false;
    return true;
  }
  if (onGround) sprite._suppressSpawnLandingSound = false;
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
