const THORG_RAGE_DURATION_MS = 8000;

function setLocalRageState(player, enabled) {
  if (!player) return;
  player._thorgRageActive = !!enabled;
  if (enabled) {
    player._thorgRageUntil = Date.now() + THORG_RAGE_DURATION_MS;
  } else {
    delete player._thorgRageUntil;
  }
}

export function perform(
  scene,
  player,
  playersInTeam,
  opponentPlayers,
  username,
  gameId,
  isOwner = false,
) {
  if (!scene || !player) return;
  setLocalRageState(player, true);

  const aura = scene.add.circle(player.x, player.y - 10, 42, 0x9333ea, 0.22);
  aura.setDepth(14);
  aura.setBlendMode(Phaser.BlendModes.ADD);

  const shock = scene.add.circle(player.x, player.y - 10, 26, 0xffffff, 0.18);
  shock.setDepth(15);
  shock.setBlendMode(Phaser.BlendModes.ADD);

  scene.tweens.add({
    targets: aura,
    scaleX: 2.25,
    scaleY: 2.25,
    alpha: 0,
    duration: 420,
    ease: "Cubic.easeOut",
    onComplete: () => aura.destroy(),
  });
  scene.tweens.add({
    targets: shock,
    scaleX: 1.75,
    scaleY: 1.75,
    alpha: 0,
    duration: 280,
    ease: "Quad.easeOut",
    onComplete: () => shock.destroy(),
  });

  for (let i = 0; i < 18; i++) {
    const spark = scene.add.circle(
      player.x + Phaser.Math.Between(-18, 18),
      player.y + Phaser.Math.Between(-44, 12),
      Phaser.Math.Between(3, 6),
      i % 3 === 0 ? 0xffffff : 0xa855f7,
      i % 3 === 0 ? 0.75 : 0.62,
    );
    spark.setDepth(16);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    scene.tweens.add({
      targets: spark,
      x: spark.x + Phaser.Math.Between(-34, 34),
      y: spark.y - Phaser.Math.Between(22, 58),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.2, 1.8),
      scaleY: Phaser.Math.FloatBetween(1.2, 1.8),
      duration: Phaser.Math.Between(320, 520),
      ease: "Cubic.easeOut",
      onComplete: () => spark.destroy(),
    });
  }

  try {
    scene.sound?.play("thorg-throw", {
      volume: isOwner ? 0.6 : 0.28,
      rate: 0.88,
    });
  } catch (_) {}

  scene.time.delayedCall(THORG_RAGE_DURATION_MS, () => {
    if (!player || !player.active) return;
    if ((player._thorgRageUntil || 0) <= Date.now()) {
      setLocalRageState(player, false);
    }
  });
}
