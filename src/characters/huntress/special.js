import { playSpriteAnimation } from "../shared/animationState.js";

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
  player._specialAnimLockUntil = Date.now() + 900;

  playSpriteAnimation({
    scene,
    sprite: player,
    character: "huntress",
    logical: "special",
    fallback: "throw",
  });

  try {
    scene.sound?.play?.("huntress-special", {
      volume: isOwner ? 0.65 : 0.38,
    });
  } catch (_) {}

  if (!scene.add) return;
  const color = 0xff8a2f;
  const aura = scene.add.circle(player.x, player.y - 12, 38, color, 0.18);
  aura.setDepth((player.depth || 10) + 4);
  aura.setBlendMode(Phaser.BlendModes.ADD);
  scene.tweens.add({
    targets: aura,
    alpha: 0,
    scaleX: 2.1,
    scaleY: 1.35,
    duration: 560,
    ease: "Cubic.easeOut",
    onUpdate: () => {
      if (!player.active) return;
      aura.x = player.x;
      aura.y = player.y - 12;
    },
    onComplete: () => aura.destroy(),
  });
}
