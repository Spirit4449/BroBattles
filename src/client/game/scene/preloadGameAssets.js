import { POWERUP_CATALOG } from '../../../shared/powerups';
// gameScene/preloadGameAssets.js
import { preloadTerrainAudio } from '../audio/movementAudio';

export function preloadGameAssets({
  scene,
  staticPath,
  powerupTypes,
  powerupAssetDir,
  preloadAllCharacters,
}) {
  const loadImage = (key, ...args) => { if (!scene._mapAssetKeys?.has(key)) scene.load.image(key,...args); };
  // Character assets (preload all registered characters)
  preloadAllCharacters(scene, staticPath);

  loadImage("deathdrop-coin", `${staticPath}/icons/coin.webp`);
  loadImage("deathdrop-gem", `${staticPath}/icons/gem.webp`);
  loadImage("spectate-icon", `${staticPath}/icons/spectate.webp`);
  for (let i = 1; i <= 3; i++) {
    loadImage(`tombstone-${i}`, `${staticPath}/tombstones/tombstone-${i}.webp`);
  }
  // Level-balanced movement SFX and small randomized footstep set.
  preloadTerrainAudio(scene, staticPath);
  scene.load.audio("sfx-jump", `${staticPath}/movement/jump.mp3`);
  scene.load.audio("sfx-stomp", `${staticPath}/movement/stomp.mp3`);
  scene.load.audio("sfx-dash", `${staticPath}/movement/dash.mp3`);
  scene.load.audio("sfx-walljump", `${staticPath}/movement/wall-jump.mp3`);
  scene.load.audio("sfx-sliding", `${staticPath}/movement/wall-slide.mp3`);
  scene.load.audio("sfx-fall-air", `${staticPath}/movement/fall-wind.mp3`);
  scene.load.audio(
    "sfx-duck-transition",
    `${staticPath}/movement/duck-transition.mp3`,
  );
  scene.load.audio("sfx-duck-block", `${staticPath}/movement/duck-block.wav`);
  scene.load.audio("sfx-sudden-death", `${staticPath}/game-sounds/suddendeath.mp3`);
  scene.load.audio("sfx-death", `${staticPath}/game-sounds/death.mp3`);
  scene.load.audio("sfx-respawn", `${staticPath}/game-sounds/respawn.mp3`);
  scene.load.audio("sfx-you-death", `${staticPath}/game-sounds/you-death.mp3`);
  scene.load.audio("sfx-coin-pickup", `${staticPath}/game-sounds/coin.mp3`);
  scene.load.audio("sfx-gem-pickup", `${staticPath}/game-sounds/gem.mp3`);
  scene.load.audio("sfx-noammo", `${staticPath}/game-sounds/noammo.mp3`);
  scene.load.audio("sfx-nosuper", `${staticPath}/game-sounds/nosuper.mp3`);

  scene.load.spritesheet(
    "duck-guard-impact",
    `${staticPath}/movement/duck-guard-impact.webp`,
    { frameWidth: 64, frameHeight: 64, startFrame: 0, endFrame: 77 },
  );

  // Combat/health SFX
  scene.load.audio("sfx-damage", `${staticPath}/game-sounds/damage.mp3`);
  // Shockwave reuses Draven's animated explosion art under its own key so the
  // effect is available even when no Draven is present in the match roster.
  scene.load.atlas(
    "pu-shockwave-explosion",
    `${staticPath}/draven/explosion.webp`,
    `${staticPath}/draven/explosion.json`,
  );
  // Music (non-blocking BGM: handled via HTMLAudio at runtime)
  scene.load.audio("win", `${staticPath}/game-sounds/win.mp3`);
  scene.load.audio("lose", `${staticPath}/game-sounds/lose.mp3`);
  scene.load.audio("draw", `${staticPath}/game-sounds/draw.mp3`);

  // Powerup assets use the published WebP icons and MP3 sounds.
  for (const type of powerupTypes) {
    const dir = powerupAssetDir[type] || type;
    loadImage(
      `pu-icon-${type}-webp`,
      `${staticPath}/powerups/${dir}/icon.webp`,
    );
    scene.load.audio(`pu-touch-${type}`, `${staticPath}/powerups/${dir}/touch.mp3`);
    if (POWERUP_CATALOG[type]?.tickVolume != null) {
      scene.load.audio(`pu-tick-${type}`, `${staticPath}/powerups/${dir}/tick.mp3`);
    }
  }
  // Fonts are declared and preloaded by game.html. Phaser 3.70 has no load.font API.
}
