const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const effectManager = require("../../../shared/combat/runtime/effects/effectManager.js");
const inputManager = require("./inputManager");

function scheduleRespawn(room, playerData, plan = {}) {
  if (!playerData || !plan?.enabled) return;
  if (playerData._respawnTimeout) {
    clearTimeout(playerData._respawnTimeout);
  }
  const delayMs = Math.max(0, Number(plan.delayMs) || 0);
  playerData._respawnTimeout = setTimeout(() => {
    playerData._respawnTimeout = null;
    if (room.status !== "active") return;
    const now = Date.now();
    const spawnX = Number(plan?.position?.x);
    const spawnY = Number(plan?.position?.y);
    const nextX = Number.isFinite(spawnX)
      ? spawnX
      : Number(playerData.x) || 0;
    const nextY = Number.isFinite(spawnY)
      ? spawnY
      : Number(playerData.y) || 0;
    playerData.isAlive = true;
    playerData._dashReadyAt = 0;
    playerData._dashUntil = 0;
    playerData._stompPendingUntil = 0;
    playerData._deathHandled = false;
    playerData.health = Math.max(1, Number(playerData.maxHealth) || 1);
    playerData.x = nextX;
    playerData.y = nextY;
    playerData.ducking = false;
    inputManager.updateBodyGeometry(playerData, room);
    inputManager.resetMovementBudget(playerData, now);
    playerData.vx = 0;
    playerData.vy = 0;
    playerData.wallSliding = false;
    playerData.wallSide = null;
    playerData.lastDamagedAt = 0;
    playerData.lastCombatAt = now;
    if (Number(plan.shieldMs) > 0) {
      effectManager.apply(
        playerData,
        "respawnShield",
        now,
        { durationMs: Number(plan.shieldMs) },
        room,
      );
    }
    room.broadcast(SOCKET_EVENTS.PLAYER_RESPAWN, {
      username: playerData.name,
      x: nextX,
      y: nextY,
      team: playerData.team,
      health: playerData.health,
      maxHealth: playerData.maxHealth,
      shieldMs: Math.max(0, Number(plan.shieldMs) || 0),
      at: now,
    });
    room.broadcastHealthUpdate(playerData, { cause: "respawn" });
    room.broadcastSnapshot();
  }, delayMs);
}

module.exports = { scheduleRespawn };
