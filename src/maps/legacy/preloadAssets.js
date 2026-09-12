export function preloadLegacyMapAssets(scene, staticPath, mapId) {
  const loadImage = (key, ...args) => { if (!scene._mapAssetKeys?.has(key)) scene.load.image(key, ...args); };

  switch (Number(mapId) || 1) {
    case 2:
      loadImage("mangrove-tiny-platform", `${staticPath}/mangrove/lobbyPlatform.webp`);
      loadImage("mangrove-lobby-platform", `${staticPath}/mangrove/lobbyPlatform.webp`);
      loadImage("mangrove-base-left", `${staticPath}/mangrove/baseLeft.webp`);
      loadImage("mangrove-base-middle", `${staticPath}/mangrove/baseMiddle.webp`);
      loadImage("mangrove-base-right", `${staticPath}/mangrove/baseRight.webp`);
      loadImage("mangrove-base-top", `${staticPath}/mangrove/baseTop.webp`);
      break;
    case 3:
      loadImage("serenity-large-platform", `${staticPath}/serenity/largePlatform.webp`);
      loadImage("serenity-side-platform", `${staticPath}/serenity/sidePlatform.webp`);
      loadImage("serenity-log-platform", `${staticPath}/serenity/logPlatform.webp`);
      loadImage("serenity-small-rock", `${staticPath}/serenity/smallRock.webp`);
      break;
    case 4:
      // Iron Junction assets are loaded by the Bank Bust mode chunk.
      break;
    case 1:
    default:
      loadImage("tiles-image", `${staticPath}/map.webp`);
      scene.load.tilemapTiledJSON("tiles", `${staticPath}/tilesheet.json`);
      loadImage("lushy-base", `${staticPath}/lushy/base.webp`);
      loadImage("lushy-platform", `${staticPath}/lushy/largePlatform.webp`);
      loadImage("lushy-side-platform", `${staticPath}/lushy/sidePlatform.webp`);
      break;
  }
}
