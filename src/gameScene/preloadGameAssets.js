// gameScene/preloadGameAssets.js
import { preloadTerrainAudio } from './movementAudio';

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

  loadImage("tiles-image", `${staticPath}/map.webp`);
  scene.load.tilemapTiledJSON("tiles", `${staticPath}/tilesheet.json`);
  loadImage("lushy-base", `${staticPath}/lushy/base.webp`);
  loadImage("lushy-platform", `${staticPath}/lushy/largePlatform.webp`);
  loadImage(
    "lushy-side-platform",
    `${staticPath}/lushy/sidePlatform.webp`,
  );
  loadImage(
    "mangrove-tiny-platform",
    `${staticPath}/mangrove/lobbyPlatform.webp`,
  );
  loadImage(
    "mangrove-lobby-platform",
    `${staticPath}/mangrove/lobbyPlatform.webp`,
  );
  loadImage(
    "mangrove-base-left",
    `${staticPath}/mangrove/baseLeft.webp`,
  );
  loadImage(
    "mangrove-base-middle",
    `${staticPath}/mangrove/baseMiddle.webp`,
  );
  loadImage(
    "mangrove-base-right",
    `${staticPath}/mangrove/baseRight.webp`,
  );
  loadImage("mangrove-base-top", `${staticPath}/mangrove/baseTop.webp`);
  loadImage(
    "serenity-large-platform",
    `${staticPath}/serenity/largePlatform.webp`,
  );
  loadImage(
    "serenity-side-platform",
    `${staticPath}/serenity/sidePlatform.webp`,
  );
  loadImage(
    "serenity-log-platform",
    `${staticPath}/serenity/logPlatform.webp`,
  );
  loadImage(
    "serenity-small-rock",
    `${staticPath}/serenity/smallRock.webp`,
  );
  loadImage("deathdrop-coin", `${staticPath}/coin.webp`);
  loadImage("deathdrop-gem", `${staticPath}/gem.webp`);
  loadImage("spectate-icon", `${staticPath}/spectate.webp`);
  for (let i = 1; i <= 3; i++) {
    loadImage(`tombstone-${i}`, `${staticPath}/tombstone-${i}.webp`);
  }
  loadImage("bank-bust-vault", `${staticPath}/bank-bust/vault.webp`);
  loadImage("bank-bust-base", `${staticPath}/bank-bust/base.webp`);
  loadImage("bank-bust-topcase", `${staticPath}/bank-bust/topcase.webp`);
  loadImage(
    "bank-bust-staircase",
    `${staticPath}/bank-bust/staircase.webp`,
  );
  loadImage("bank-bust-middle", `${staticPath}/bank-bust/middle.webp`);
  loadImage(
    "bank-bust-middlebottom",
    `${staticPath}/bank-bust/middlebottom.webp`,
  );
  loadImage(
    "bank-bust-middledetail",
    `${staticPath}/bank-bust/middledetail.webp`,
  );
  loadImage(
    "bank-bust-longplatform",
    `${staticPath}/bank-bust/longplatform.webp`,
  );
  loadImage(
    "bank-bust-tallplatform",
    `${staticPath}/bank-bust/tallplatform.webp`,
  );
  loadImage(
    "bank-bust-bigblock",
    `${staticPath}/bank-bust/bigblock.webp`,
  );
  loadImage("bank-bust-2x2", `${staticPath}/bank-bust/2x2square.webp`);
  loadImage("bank-bust-3x3", `${staticPath}/bank-bust/3x3square.webp`);
  loadImage("bank-bust-abyss", `${staticPath}/bank-bust/abyss.webp`);
  loadImage("bank-bust-pipe", `${staticPath}/bank-bust/pipe.webp`);
  loadImage(
    "bank-bust-turret-base",
    `${staticPath}/bank-bust/mount.webp`,
  );
  loadImage(
    "bank-bust-turret-head",
    `${staticPath}/bank-bust/barrel.webp`,
  );
  loadImage("bank-bust-bullet", `${staticPath}/bank-bust/bullet.webp`);
  loadImage(
    "bank-bust-wall-slot",
    `${staticPath}/bank-bust/not-built.png`,
  );
  loadImage("bank-bust-wall-built", `${staticPath}/bank-bust/built.png`);
  loadImage(
    "bank-bust-mine-neutral",
    `${staticPath}/bank-bust/mine.webp`,
  );
  loadImage(
    "bank-bust-mine-claimed",
    `${staticPath}/bank-bust/mine-claimed.webp`,
  );

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
  scene.load.audio("sfx-noammo", [
    `${staticPath}/noammo.mp3`,
    `${staticPath}/land.mp3`,
  ]);

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
  // Allow a map-specific turret shoot sound to be used if present (preferred),
  // otherwise fall back to the shared damage sound.
  scene.load.audio("sfx-bankbust-turret-shoot", [
    `${staticPath}/bank-bust/turret-shoot.mp3`,
    `${staticPath}/damage.mp3`,
  ]);
  scene.load.audio(
    "sfx-bankbust-turret-claim",
    `${staticPath}/bank-bust/turret-claim.mp3`,
  );
  scene.load.audio(
    "sfx-bankbust-mine-collect",
    `${staticPath}/bank-bust/collect.mp3`,
  );
  scene.load.audio(
    "sfx-bankbust-mine-claim",
    `${staticPath}/ui-sound/ready.mp3`,
  );
  scene.load.audio(
    "sfx-bankbust-wall-claim",
    `${staticPath}/bank-bust/wall-claim.mp3`,
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
