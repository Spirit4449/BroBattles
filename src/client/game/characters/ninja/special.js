import { ninjaEnabled } from './network';
import ReturningShuriken from "./attack";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { lockPlayerFlip } from "../shared/flipLock";
import { presentSwarmRelease } from './swarmPresentation';
import { swarmShard } from "../../../../shared/characters/ninjaProjectile";

const SWARM = getResolvedCharacterSpecialConfig("ninja", "swarm");
// Tuning lives in src/shared/characters/ninja.json (special.swarm).
const SWARM_COUNT = SWARM.count;
const SWARM_RELEASE_MS = SWARM.releaseMs;
const SWARM_LOCK_MS = SWARM_COUNT * SWARM_RELEASE_MS + SWARM.lockPaddingMs;
const SWARM_DAMAGE = SWARM.damage;

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
  username,
  gameId,
  isOwner,
  burstIndex,
  specialData = null,
) {
  if (!player || !player.active) return;
  const resolvedAngle = Number.isFinite(Number(specialData?.angle))
    ? Number(specialData.angle)
    : null;
  const direction =
    Number(specialData?.direction) === -1 ||
    (Number.isFinite(resolvedAngle) &&
      Math.cos(resolvedAngle) < 0 &&
      Number(specialData?.direction) !== 1)
      ? -1
      : Number(specialData?.direction) === 1
        ? 1
        : player.flipX
          ? -1
          : 1;
  const angle = direction < 0 ? Math.PI : 0;
  const shard = swarmShard(burstIndex, direction);
  const spawnX = player.x + shard.spawnOffsetX;
  const spawnY = player.y + shard.spawnOffsetY;
  const config = {
    direction,
    angle,
    username,
    gameId,
    isOwner,
    damage: SWARM_DAMAGE,
    attackType: "ninja-special-swarm",
    instanceId: makeSwarmInstanceId(burstIndex),
    scale: SWARM.scale,
    glowScale: SWARM.glowScale,
    rotationSpeed: shard.rotationSpeed,
    forwardDistance: shard.forwardDistance,
    outwardDuration: shard.outwardDuration,
    returnSpeed: shard.returnSpeed,
    endYOffset: shard.endYOffset,
    ctrl1YOffset: shard.ctrl1YOffset,
    ctrl2YOffset: shard.ctrl2YOffset,
    maxLifetime: SWARM.maxLifetimeMs,
  };

  new ReturningShuriken(
    scene,
    { x: spawnX, y: spawnY },
    player,
    config,
  );
}

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
  const desiredAngle = Number.isFinite(Number(specialData?.angle))
    ? Number(specialData.angle)
    : null;
  const desiredDirection =
    Number(specialData?.direction) === -1
      ? -1
      : Number.isFinite(desiredAngle) && Math.cos(desiredAngle) < 0
        ? -1
      : Number(specialData?.direction) === 1
        ? 1
        : player?.flipX
          ? -1
          : 1;
  if (player) {
    player.flipX = desiredDirection < 0;
  }
  lockFlipDuringRelease(scene, player);

  if (ninjaEnabled()) return;
  for (let index = 0; index < SWARM_COUNT; index++) {
    scene.time.delayedCall(index * SWARM_RELEASE_MS, () => {
      spawnSingleSwarmShuriken(
        scene,
        player,
        username,
        gameId,
        isOwner,
        index,
        specialData,
      );
      presentSwarmRelease(scene, player, SWARM_RELEASE_MS, !isOwner);
    });
  }
}
