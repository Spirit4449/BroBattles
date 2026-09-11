export function preloadBankBustAssets(scene, staticPath) {
  const loadImage = (key, ...args) => { if (!scene._mapAssetKeys?.has(key)) scene.load.image(key, ...args); };
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

}
