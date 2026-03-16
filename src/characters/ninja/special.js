import ReturningShuriken from "./attack";
import { getCharacterTuning } from "../../lib/characterStats.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";

const NINJA_TUNING = getCharacterTuning("ninja");
const SWARM = NINJA_TUNING.special?.swarm || {};
const SWARM_COUNT = SWARM.count ?? 15;
const SWARM_RELEASE_MS = SWARM.releaseMs ?? 36;
const SWARM_LOCK_MS =
  SWARM_COUNT * SWARM_RELEASE_MS + (SWARM.lockPaddingMs ?? 180);
const SWARM_DAMAGE = SWARM.damage ?? 300;

function makeSwarmInstanceId(burstIndex) {
  return createRuntimeId("ninja_swarm", burstIndex);
}

function lockFlipDuringRelease(scene, player) {
  if (!player) return;
  const unlockFlip = lockPlayerFlip(player);
  scene.time.delayedCall(SWARM_LOCK_MS, () => {
    if (!player || !player.active) return;
    unlockFlip();
  });
}

function spawnSingleSwarmShuriken(
  scene,
  player,
  opponentPlayers,
  username,
  gameId,
  isOwner,
  burstIndex,
) {
  if (!player || !player.active) return;
  const direction = player.flipX ? -1 : 1;
  const center = (SWARM_COUNT - 1) * 0.5;
  const spread = burstIndex - center;
  const yOffset = spread * (SWARM.yOffsetPerShard ?? 5.5);
  const fanStrength = spread * (SWARM.fanStrengthPerShard ?? 14);
  const spawnX =
    player.x +
    direction *
      ((SWARM.spawnForwardBase ?? 28) +
        Math.abs(spread) * (SWARM.spawnForwardPerShard ?? 1.6));
  const spawnY = player.y + (SWARM.spawnYBase ?? -12) + yOffset;
  const config = {
    direction,
    username,
    gameId,
    isOwner,
    damage: SWARM_DAMAGE,
    attackType: "ninja-special-swarm",
    instanceId: makeSwarmInstanceId(burstIndex),
    scale: SWARM.scale ?? 0.135,
    glowScale: SWARM.glowScale ?? 1.35,
    rotationSpeed:
      (SWARM.rotationSpeedBase ?? 2200) +
      Math.abs(spread) * (SWARM.rotationSpeedPerShard ?? 35),
    forwardDistance:
      (SWARM.forwardDistanceBase ?? 440) +
      Math.abs(spread) * (SWARM.forwardDistancePerShard ?? 6),
    outwardDuration:
      (SWARM.outwardDurationBase ?? 330) +
      Math.abs(spread) * (SWARM.outwardDurationPerShard ?? 8),
    returnSpeed: SWARM.returnSpeed ?? 960,
    hitCooldown: SWARM.hitCooldownMs ?? 320,
    endYOffset: fanStrength,
    ctrl1YOffset:
      (SWARM.ctrl1YOffsetBase ?? 16) +
      yOffset * (SWARM.ctrl1YOffsetScale ?? 0.25),
    ctrl2YOffset: -(
      (SWARM.ctrl2YOffsetBase ?? 52) +
      Math.abs(fanStrength) * (SWARM.ctrl2YOffsetScale ?? 0.45)
    ),
    maxLifetime: SWARM.maxLifetimeMs ?? 5200,
  };

  const shuriken = new ReturningShuriken(
    scene,
    { x: spawnX, y: spawnY },
    player,
    config,
  );

  if (isOwner) {
    const enemyList = Array.isArray(opponentPlayers)
      ? opponentPlayers
      : Object.values(opponentPlayers || {});
    shuriken.attachEnemyOverlap(enemyList);
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
  lockFlipDuringRelease(scene, player);

  try {
    scene.sound?.play("shurikenThrow", {
      volume: isOwner ? 0.9 : 0.42,
      rate: 1.18,
    });
  } catch (_) {}

  try {
    if (scene.anims?.exists("ninja-throw")) {
      player.anims.play("ninja-throw", true);
    }
  } catch (_) {}

  for (let index = 0; index < SWARM_COUNT; index++) {
    scene.time.delayedCall(index * SWARM_RELEASE_MS, () => {
      spawnSingleSwarmShuriken(
        scene,
        player,
        opponentPlayers,
        username,
        gameId,
        isOwner,
        index,
      );
      if (isOwner && index % 4 === 0) {
        try {
          scene.sound?.play("shurikenThrow", { volume: 0.34, rate: 1.28 });
        } catch (_) {}
      }
    });
  }
}
