import ReturningShuriken from "./attack";

const SWARM_COUNT = 15;
const SWARM_RELEASE_MS = 36;
const SWARM_LOCK_MS = SWARM_COUNT * SWARM_RELEASE_MS + 180;
const SWARM_DAMAGE = 300;

function makeSwarmInstanceId(burstIndex) {
  return `ninja_swarm_${Date.now()}_${burstIndex}_${Math.floor(Math.random() * 1e6)}`;
}

function lockFlipDuringRelease(scene, player) {
  if (!player) return;
  player._lockFlip = true;
  player._lockedFlipX = player.flipX;
  scene.time.delayedCall(SWARM_LOCK_MS, () => {
    if (!player || !player.active) return;
    player._lockFlip = false;
    delete player._lockedFlipX;
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
  const yOffset = spread * 5.5;
  const fanStrength = spread * 14;
  const spawnX = player.x + direction * (28 + Math.abs(spread) * 1.6);
  const spawnY = player.y - 12 + yOffset;
  const config = {
    direction,
    username,
    gameId,
    isOwner,
    damage: SWARM_DAMAGE,
    attackType: "ninja-special-swarm",
    instanceId: makeSwarmInstanceId(burstIndex),
    scale: 0.135,
    glowScale: 1.35,
    rotationSpeed: 2200 + Math.abs(spread) * 35,
    forwardDistance: 440 + Math.abs(spread) * 6,
    outwardDuration: 330 + Math.abs(spread) * 8,
    returnSpeed: 960,
    hitCooldown: 320,
    endYOffset: fanStrength,
    ctrl1YOffset: 16 + yOffset * 0.25,
    ctrl2YOffset: -(52 + Math.abs(fanStrength) * 0.45),
    maxLifetime: 5200,
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
