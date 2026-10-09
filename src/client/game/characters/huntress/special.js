import { playSpriteAnimation, markOneShotAnimation } from "../shared/animationState.js";
import { playPlayerSound } from "../../audio/playerAudio";

export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
) {
  if (!scene || !player || !player.active) return;
  player._specialAnimLockUntil = Date.now() + 450;
  markOneShotAnimation(player, 'special', 450, { remote: !isOwner });

  playSpriteAnimation({
    scene,
    sprite: player,
    character: "huntress",
    logical: "special",
    fallback: "throw",
  });

  try {
    playPlayerSound(scene, player, "huntress-special", { volume: isOwner ? 0.56 : 0.33 });
  } catch (_) {}

  if (!scene.add) return;
  // A quick bow-side ignition: separated square embers leave the silhouette clear.
  const direction = player.flipX ? -1 : 1;
  const sparks = scene.add.graphics().setPosition(player.x + direction * 18, player.y + 12);
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
