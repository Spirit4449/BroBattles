import { ninjaEnabled } from './network';
import ReturningShuriken from "./attack";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { createRuntimeId } from "../shared/runtimeId";
import { aimFacesLeft, faceAttack } from "../shared/flipLock";
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
  const direction = aimFacesLeft(specialData, player.flipX) ? -1 : 1;
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
  // Face the aim (left or right) for the whole barrage. The owner already
  // turned on the key press (predictNinja); this covers remote viewers and
  // re-holds the facing for the full release.
  if (player) faceAttack(scene, player, aimFacesLeft(specialData, player.flipX), SWARM_LOCK_MS);

  if (scene?._ninjaCombatEnabled ?? ninjaEnabled()) return;
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
