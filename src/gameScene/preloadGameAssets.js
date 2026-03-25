// gameScene/preloadGameAssets.js

export function preloadGameAssets({
  scene,
  staticPath,
  powerupTypes,
  powerupAssetDir,
  preloadAllCharacters,
}) {
  // Character assets (preload all registered characters)
  preloadAllCharacters(scene, staticPath);

  scene.load.image("tiles-image", `${staticPath}/map.webp`);
  scene.load.tilemapTiledJSON("tiles", `${staticPath}/tilesheet.json`);
  scene.load.image("lushy-base", `${staticPath}/lushy/base.webp`);
  scene.load.image("lushy-platform", `${staticPath}/lushy/largePlatform.webp`);
  scene.load.image(
    "lushy-side-platform",
    `${staticPath}/lushy/sidePlatform.webp`,
  );
  scene.load.image(
    "mangrove-tiny-platform",
    `${staticPath}/mangrove/tinyPlatform.webp`,
  );
  scene.load.image(
    "mangrove-base-left",
    `${staticPath}/mangrove/baseLeft.webp`,
  );
  scene.load.image(
    "mangrove-base-middle",
    `${staticPath}/mangrove/baseMiddle.webp`,
  );
  scene.load.image(
    "mangrove-base-right",
    `${staticPath}/mangrove/baseRight.webp`,
  );
  scene.load.image("mangrove-base-top", `${staticPath}/mangrove/baseTop.webp`);
  scene.load.image(
    "serenity-large-platform",
    `${staticPath}/serenity/largePlatform.webp`,
  );
  scene.load.image(
    "serenity-side-platform",
    `${staticPath}/serenity/sidePlatform.webp`,
  );
  scene.load.image(
    "serenity-log-platform",
    `${staticPath}/serenity/logPlatform.webp`,
  );
  scene.load.image(
    "serenity-small-rock",
    `${staticPath}/serenity/smallRock.webp`,
  );
  scene.load.image("deathdrop-coin", `${staticPath}/coin.webp`);
  scene.load.image("deathdrop-gem", `${staticPath}/gem.webp`);

  // Movement SFX (place files under /assets/audio)
  scene.load.audio("sfx-step", `${staticPath}/step.mp3`);
  scene.load.audio("sfx-jump", `${staticPath}/jump.mp3`);
  scene.load.audio("sfx-land", `${staticPath}/land.mp3`);
  scene.load.audio("sfx-walljump", `${staticPath}/walljump.mp3`);
  scene.load.audio("sfx-sliding", `${staticPath}/sliding.mp3`);
  scene.load.audio("sfx-sudden-death", `${staticPath}/suddendeath.mp3`);
  scene.load.audio("sfx-death", `${staticPath}/death.mp3`);
  scene.load.audio("sfx-coin-pickup", `${staticPath}/coin.mp3`);
  scene.load.audio("sfx-gem-pickup", `${staticPath}/gem.mp3`);
  scene.load.audio("sfx-noammo", [
    `${staticPath}/noammo.mp3`,
    `${staticPath}/land.mp3`,
  ]);

  // Combat/health SFX
  scene.load.audio("sfx-damage", `${staticPath}/damage.mp3`);
  scene.load.audio("sfx-heal", `${staticPath}/heal.mp3`);

  // Music (non-blocking BGM: handled via HTMLAudio at runtime)
  scene.load.audio("win", `${staticPath}/win.mp3`);
  scene.load.audio("lose", `${staticPath}/lose.mp3`);

  // Powerup assets (support common icon/audio extensions)
  for (const type of powerupTypes) {
    const dir = powerupAssetDir[type] || type;
    scene.load.image(
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
  scene.load.font(
    "PressStart2P",
    `${staticPath}/LilitaOne-Regular.ttf`,
    "truetype",
  );
}
