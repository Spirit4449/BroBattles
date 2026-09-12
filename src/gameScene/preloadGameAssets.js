import { preloadLegacyMapAssets } from '../maps/legacy/preloadAssets';
// gameScene/preloadGameAssets.js
import { preloadTerrainAudio } from './movementAudio';

export function preloadGameAssets({
  scene,
  staticPath,
  mapId,
  powerupTypes,
  powerupAssetDir,
  preloadAllCharacters,
}) {
  const loadImage = (key, ...args) => { if (!scene._mapAssetKeys?.has(key)) scene.load.image(key,...args); };
  // Character assets (preload all registered characters)
  preloadAllCharacters(scene, staticPath);

  if (!scene._mapAssetKeys?.size) preloadLegacyMapAssets(scene, staticPath, mapId);
  loadImage("deathdrop-coin", `${staticPath}/coin.webp`);
  loadImage("deathdrop-gem", `${staticPath}/gem.webp`);
  loadImage("spectate-icon", `${staticPath}/spectate.webp`);
  for (let i = 1; i <= 3; i++) {
    loadImage(`tombstone-${i}`, `${staticPath}/tombstones/tombstone-${i}.webp`);
  }
  // Level-balanced movement SFX and small randomized footstep set.
  preloadTerrainAudio(scene, staticPath);
  scene.load.audio("sfx-jump", `${staticPath}/movement/jump.mp3`);
  scene.load.audio("sfx-walljump", `${staticPath}/movement/wall-jump.mp3`);
  scene.load.audio("sfx-sliding", `${staticPath}/movement/wall-slide.mp3`);
  scene.load.audio("sfx-fall-air", `${staticPath}/movement/fall-wind.mp3`);
  scene.load.audio(
    "sfx-duck-transition",
    `${staticPath}/movement/duck-transition.mp3`,
  );
  scene.load.audio("sfx-duck-block", `${staticPath}/movement/duck-block.wav`);
  scene.load.audio("sfx-parachute-open", `${staticPath}/movement/parachute-open.mp3`);
  scene.load.audio("sfx-sudden-death", `${staticPath}/suddendeath.mp3`);
  scene.load.audio("sfx-death", `${staticPath}/death.mp3`);
  scene.load.audio("sfx-you-death", `${staticPath}/you-death.mp3`);
  scene.load.audio("sfx-coin-pickup", `${staticPath}/coin.mp3`);
  scene.load.audio("sfx-gem-pickup", `${staticPath}/gem.mp3`);
  scene.load.audio("sfx-noammo", `${staticPath}/noammo.mp3`);

  scene.load.spritesheet(
    "duck-guard-impact",
    `${staticPath}/movement/duck-guard-impact.png`,
    { frameWidth: 64, frameHeight: 64, startFrame: 0, endFrame: 77 },
  );

  // Combat/health SFX
  scene.load.audio("sfx-damage", `${staticPath}/damage.mp3`);
  scene.load.audio("sfx-heal", `${staticPath}/heal.mp3`);
  // Shockwave reuses Draven's animated explosion art under its own key so the
  // effect is available even when no Draven is present in the match roster.
  scene.load.atlas(
    "pu-shockwave-explosion",
    `${staticPath}/draven/explosion.webp`,
    `${staticPath}/draven/explosion.json`,
  );
  // Music (non-blocking BGM: handled via HTMLAudio at runtime)
  scene.load.audio("win", `${staticPath}/win.mp3`);
  scene.load.audio("lose", `${staticPath}/lose.mp3`);

  // Powerup assets (support common icon/audio extensions)
  for (const type of powerupTypes) {
    const dir = powerupAssetDir[type] || type;
    loadImage(
      `pu-icon-${type}-webp`,
      `${staticPath}/powerups/${dir}/icon.webp`,
    );
    scene.load.audio(`pu-touch-${type}`, [
      `${staticPath}/powerups/${dir}/touch.mp3`,
      `${staticPath}/powerups/${dir}/touch.wav`,
    ]);
    scene.load.audio(`pu-tick-${type}`, [
      `${staticPath}/powerups/${dir}/tick.mp3`,
      `${staticPath}/powerups/${dir}/tick.wav`,
    ]);
  }
  // Fonts are declared and preloaded by game.html. Phaser 3.70 has no load.font API.
}
