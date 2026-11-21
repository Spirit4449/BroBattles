import { characterDefinitions } from "../../../../shared/characters/index.js";
import { setThorgRageVisual } from "./rageVisual";
import { playerAnchor } from "../shared/rig";
import { PLAYER_LAYERS } from "../shared/attachToPlayer";
import { playSpriteAnimation } from "../shared/animationState";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { combatSoundVolume, playPlayerSound, SUPER_SOUND_GAIN } from "../../audio/playerAudio";

const { key: NAME } = characterDefinitions.thorg;

const THORG_SPECIAL = getResolvedCharacterSpecialConfig(NAME);
const THORG_RAGE_DURATION_MS = THORG_SPECIAL.rageDurationMs;

function setLocalRageState(player, enabled) {
  if (!player) return;
  player._thorgRageActive = !!enabled;
  if (enabled) {
    const startedAt = Date.now();
    player._thorgRageStartedAt = startedAt;
    player._thorgRageUntil = startedAt + THORG_RAGE_DURATION_MS;
  } else {
    delete player._thorgRageStartedAt;
    delete player._thorgRageUntil;
  }
}

export function perform({ scene, player, isOwner = false }) {
  if (!scene || !player) return;
  setLocalRageState(player, true);
  player._thorgAttackCleanup?.();
  setThorgRageVisual(scene, player, true);
  playSpriteAnimation({ scene, sprite: player, character: NAME, logical: "special", fallback: "idle",
    holdMs: 600, remote: !isOwner });

  // Bursts from the middle of his hitbox, just behind him.
  const centre = playerAnchor(player, "centre");
  const behind = (player.depth || 30) + PLAYER_LAYERS.behind;
  const aura = scene.add.circle(centre.x, centre.y, 42, 0x9333ea, 0.22);
  aura.setDepth(behind);
  aura.setBlendMode(Phaser.BlendModes.ADD);

  const shock = scene.add.circle(centre.x, centre.y, 26, 0xffffff, 0.18);
  shock.setDepth(behind);
  shock.setBlendMode(Phaser.BlendModes.ADD);
  const particles = new Set([aura, shock]);
  const destroyParticle = (particle) => {
    particles.delete(particle);
    particle.destroy();
  };

  scene.tweens.add({
    targets: aura,
    scaleX: 2.25,
    scaleY: 2.25,
    alpha: 0,
    duration: 420,
    ease: "Cubic.easeOut",
    onComplete: () => destroyParticle(aura),
  });
  scene.tweens.add({
    targets: shock,
    scaleX: 1.75,
    scaleY: 1.75,
    alpha: 0,
    duration: 280,
    ease: "Quad.easeOut",
    onComplete: () => destroyParticle(shock),
  });

  for (let i = 0; i < 18; i++) {
    const spark = scene.add.circle(
      centre.x + Phaser.Math.Between(-18, 18),
      centre.y + Phaser.Math.Between(-34, 22),
      Phaser.Math.Between(3, 6),
      i % 3 === 0 ? 0xffffff : 0xa855f7,
      i % 3 === 0 ? 0.75 : 0.62,
    );
    spark.setDepth(behind);
    spark.setBlendMode(Phaser.BlendModes.ADD);
    particles.add(spark);
    scene.tweens.add({
      targets: spark,
      x: spark.x + Phaser.Math.Between(-34, 34),
      y: spark.y - Phaser.Math.Between(22, 58),
      alpha: 0,
      scaleX: Phaser.Math.FloatBetween(1.2, 1.8),
      scaleY: Phaser.Math.FloatBetween(1.2, 1.8),
      duration: Phaser.Math.Between(320, 520),
      ease: "Cubic.easeOut",
      onComplete: () => destroyParticle(spark),
    });
  }

  try {
    playPlayerSound(scene, player, "thorg-throw", {
      volume: combatSoundVolume("thorg-throw") * SUPER_SOUND_GAIN,
      rate: 0.88,
    });
  } catch (_) {}
  try {
    playPlayerSound(scene, player, "pu-touch-rage", {
      volume: 0.07,
      rate: 0.8,
    });
  } catch (_) {}
  try {
    playPlayerSound(scene, player, "pu-tick-rage", {
      volume: 0.06,
      rate: 0.78,
    });
  } catch (_) {}

  const cancel = () => {
    timer.remove(false);
    for (const particle of particles) {
      scene.tweens.killTweensOf(particle);
      destroyParticle(particle);
    }
    finish();
  };
  const finish = () => {
    player.off?.("combat:reset", cancel);
    if (player.active && player._thorgRageUntil === rageUntil) {
      setLocalRageState(player, false);
      setThorgRageVisual(scene, player, false);
    }
  };
  const rageUntil = player._thorgRageUntil;
  const timer = scene.time.delayedCall(THORG_RAGE_DURATION_MS, finish);
  player.once?.("combat:reset", cancel);
}
