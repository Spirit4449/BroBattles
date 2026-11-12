import { playSpriteAnimation } from "../shared/animationState.js";
import rigData from "../../../../shared/characters/characterRig.js";
import { playPlayerSound } from "../../audio/playerAudio";
import { aimAngle, aimFacesLeft, faceAttack } from "../shared/flipLock.js";
import { sparrowAimVariant } from "./aimPoses";

const SPECIAL_HOLD_MS = 450;

const { launchPoint } = rigData;

export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
  specialData = null,
) {
  if (!scene || !player || !player.active) return;
  player._specialCastLockUntil = Date.now() + SPECIAL_HOLD_MS;
  const angle = aimAngle(specialData?.angle, player);
  // Face the aim for the whole draw, as the basic shot does.
  faceAttack(scene, player, aimFacesLeft({ direction: specialData?.direction, angle }, player.flipX), SPECIAL_HOLD_MS);
  playSpriteAnimation({
    scene,
    sprite: player,
    character: "sparrow",
    logical: "special",
    fallback: "throw",
    holdMs: SPECIAL_HOLD_MS,
    remote: !isOwner,
    variant: sparrowAimVariant(specialData?.angle),
  });

  try {
    playPlayerSound(scene, player, "sparrow-special", { volume: isOwner ? 0.56 : 0.33 });
  } catch (_) {}

  if (!scene.add) return;
  // A quick bow-side ignition: separated square embers leave the silhouette clear.
  const direction = player.flipX ? -1 : 1;
  // Where her arrows leave the bow (sparrow.json rig.points.bow).
  const bow = launchPoint("sparrow", "bow", { x: player.x, y: player.y, flip: player.flipX }, angle)
    || { x: player.x + direction * 18, y: player.y + 12 };
  const sparks = scene.add.graphics().setPosition(bow.x, bow.y);
  sparks.setDepth((player.depth || 10) + 4);
  for (let i = 0; i < 7; i++) {
    sparks.fillStyle(i % 2 ? 0xffbf42 : 0xff8526, 1);
    sparks.fillRect(direction * (i % 3) * 6, (i - 3) * 5, 3, 3);
  }
  const cleanup = () => {
    scene.tweens.killTweensOf(sparks);
    scene.events.off('shutdown', cleanup);
    sparks.destroy();
  };
  scene.events.once('shutdown', cleanup);
  scene.tweens.add({
    targets: sparks, x: sparks.x + direction * 16, y: sparks.y - 8,
    alpha: 0, duration: 220, onComplete: cleanup,
  });
}
