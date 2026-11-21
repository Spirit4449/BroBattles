const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { isDetachedProjectile } = require("../../../shared/combat/runtime/attackRuntimes/projectileLifecycle");
const { cancelCasts } = require("../../../shared/combat/runtime/characterCombatRegistry");
const { participantId } = require("./participants");
const inputManager = require("./inputManager");

function clearFighterEffects(player) {
  player.activeEffects = {};
  player.effects = {};
  delete player._gloopPullState;
  player._controlLockUntil = 0;
  player._knockbackUntil = 0;
  player._attackInterruptedUntil = 0;
  player._attackInterruptSeq = (player._attackInterruptSeq || 0) + 1;
  player._visibleAttack = null;
  player._botActionUntil = 0;
  player._dashUntil = 0;
  player._stompPendingUntil = 0;
  player._stompStartY = null;
  player._duckAvailableAt = 0;
}

function scheduleRespawn(room, playerData, plan = {}) {
  if (!playerData || !plan?.enabled) return;
  if (playerData._respawnTimeout) {
    clearTimeout(playerData._respawnTimeout);
  }
  const delayMs = Math.max(0, Number(plan.delayMs) || 0);
  playerData._respawnTimeout = setTimeout(() => {
    playerData._respawnTimeout = null;
    if (room.status !== "active" || room.gameMode?.isCombatPaused?.()) return;
    respawnPlayer(room, playerData, plan);
  }, delayMs);
}

function respawnPlayer(room, playerData, plan, now = Date.now()) {
  const spawnX = Number(plan?.position?.x);
  const spawnY = Number(plan?.position?.y);
  const nextX = Number.isFinite(spawnX)
    ? spawnX
    : Number(playerData.x) || 0;
  const nextY = Number.isFinite(spawnY)
    ? spawnY
    : Number(playerData.y) || 0;
  clearFighterEffects(playerData);
  cancelCasts(room, playerData, { releasedSupers: true });
  // A timer can revive the owner before another combat step sees the death.
  const owner = participantId(playerData);
  if (owner && room.activeAttacks?.length) {
    room.activeAttacks = room.activeAttacks.filter(attack =>
      attack.attackerParticipantId !== owner || isDetachedProjectile(attack));
  }
  playerData.isAlive = true;
  playerData._dashReadyAt = 0;
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
  playerData.animation = "idle";
  room.broadcast(SOCKET_EVENTS.PLAYER_RESPAWN, {
    username: playerData.name,
    x: nextX,
    y: nextY,
    team: playerData.team,
    health: playerData.health,
    maxHealth: playerData.maxHealth,
    shieldMs: 0,
    at: now,
    ...(plan.kickoff ? { kickoff: true } : {}),
    ...(plan.spawnReset ? { spawnReset: true } : {}),
  });
  room.broadcastHealthUpdate(playerData, { cause: "respawn" });
  if (!plan.kickoff) room.broadcastSnapshot();
}

module.exports = { scheduleRespawn, respawnPlayer, clearFighterEffects };
