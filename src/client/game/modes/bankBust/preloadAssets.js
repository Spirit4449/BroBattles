import { bankBustMovementSounds } from "../../../../shared/physics/movementSounds";
import PROP_FRAMES from "./propFrames.json";

export function preloadBankBustAssets(scene, staticPath) {
  scene._bankBustMovementAudio = true;
  for (const [key, file] of Object.entries(bankBustMovementSounds)) {
    scene.load.audio(`bank-bust-${key}`, `${staticPath}/bank-bust/movement/${file}.wav`);
  }
  const loadImage = (key, ...args) => { if (!scene._mapAssetKeys?.has(key)) scene.load.image(key, ...args); };
  // Each coin level has its own vault frame, and all three share one bounding
  // box so they swap in place. There is no accent mask any more: the team
  // colour is the glow and the hit outline the runtime draws around the door,
  // which also gives the vault the outline it needs to read as a target.
  for (const stateKey of ["intact", "damaged", "breached"]) {
    loadImage(
      `bank-bust-vault-${stateKey}`,
      `${staticPath}/bank-bust/vault-${stateKey}.webp`,
    );
  }
  // The centre crate falls apart in stages, all sharing one bounding box, and
  // what flies off it when it breaks is cut from the same artwork.
  for (const stage of ["intact", "damaged", "broken"]) {
    loadImage(`bank-bust-center-crate-${stage}`, `${staticPath}/bank-bust/center-crate-${stage}.webp`);
  }
  scene.load.spritesheet(
    "bank-bust-center-crate-debris",
    `${staticPath}/bank-bust/center-crate-debris.webp`,
    { frameWidth: 36, frameHeight: 36 },
  );
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
  loadImage("bank-bust-bullet", `${staticPath}/bank-bust/bullet.webp`);
  // Objective props come in one file per owner rather than being tinted: a
  // multiply tint over dark steel washes it out, so the artwork marks the
  // parts that belong to a team and the build bakes a file per team colour.
  // The mine and turret are also animated, so they load as spritesheets.
  for (const [base, { frameWidth, frameHeight }] of Object.entries(PROP_FRAMES)) {
    for (const team of ["neutral", "team1", "team2"]) {
      const key = `bank-bust-${base}-${team}`;
      if (!scene._mapAssetKeys?.has(key)) {
        scene.load.spritesheet(key, `${staticPath}/bank-bust/${base}-${team}.webp`, { frameWidth, frameHeight });
      }
    }
  }
  for (const base of ["wall-built", "wall-tall"]) {
    for (const team of ["neutral", "team1", "team2"]) {
      loadImage(`bank-bust-${base}-${team}`, `${staticPath}/bank-bust/${base}-${team}.webp`);
    }
  }
  loadImage("bank-bust-wall-slot", `${staticPath}/bank-bust/wall-slot.webp`);
  loadImage("bank-bust-wall-tall-slot", `${staticPath}/bank-bust/wall-tall-slot.webp`);
  loadImage("bank-bust-base-backdrop", `${staticPath}/bank-bust/base-backdrop.webp`);

  // Allow a map-specific turret shoot sound to be used if present (preferred),
  // otherwise fall back to the shared damage sound.
  scene.load.audio("sfx-bankbust-turret-shoot", [
    `${staticPath}/bank-bust/turret-shoot.mp3`,
    `${staticPath}/game-sounds/damage.mp3`,
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
