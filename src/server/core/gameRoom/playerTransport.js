const huntressCombat = require('./huntressCombat');
const inputManager = require("./inputManager");
const characterCombat = require('./characterCombatRegistry');
const {
  ACTION_MIN_INTERVAL_MS,
  ACTION_SPAM_WINDOW_MS,
  ACTION_SPAM_MAX_IN_WINDOW,
  ACTION_SPAM_SUPPRESS_MS
} = require("../gameRoomConfig");
const { registerGameChatEvents } = require("../socketEvents/gameChatEvents");

function setupPlayerSocket(room, socket) {
  room.onSocket(socket, 'game:clock', (data, ack) => {
    if (typeof ack === 'function') ack(huntressCombat.timing(room));
  });
    // Handle player input
  room.onSocket(socket, "game:input", (inputData) => {
    if (room.status !== "finished" && room.players.has(socket.id) && Number.isFinite(inputData?.x) && Number.isFinite(inputData?.y)) {
      room.playerActivity?.gameActivity(socket, room.matchId);
    }
    room.handlePlayerInput(socket.id, inputData);
  });

    // NEW: Handle input intent (Phase 2 server-side movement simulation)
    // Non-breaking; queued but not used unless USE_SERVER_MOVEMENT_SIMULATION_V1 enabled
  room.onSocket(socket, "game:input-intent", (intentData) => {
    if (room.status !== "finished" && room.players.has(socket.id) && Number.isFinite(intentData?.seq)) {
      room.playerActivity?.gameActivity(socket, room.matchId);
    }
    inputManager.handlePlayerInputIntent(room, socket.id, intentData);
  });

    // Handle player actions (attacks, abilities, etc.)
  room.onSocket(socket, "game:action", (actionData) => {
    const player = room.players.get(socket.id);
    if (!player) return;
    if (characterCombat.ownsAction(room, player, actionData)) {
      room.handlePlayerAction(socket.id, actionData);
      return;
    }
    if (Number(player._controlLockUntil || 0) > Date.now()) return;
    const actionType = String(actionData?.type || "").toLowerCase();
    const isReturnControlAction = actionType === "ninja-shuriken-return";
    const now = Date.now();
    if (Number(player._actionSuppressedUntil || 0) > now) return;

    const lastActionAt = Number(player._lastActionAt || 0);
    if (
      !isReturnControlAction &&
      lastActionAt > 0 &&
      now - lastActionAt < ACTION_MIN_INTERVAL_MS
    ) {
      const windowStart = Number(player._actionWindowStart || 0);
      if (!windowStart || now - windowStart > ACTION_SPAM_WINDOW_MS) {
        player._actionWindowStart = now;
        player._actionInWindow = 0;
      }
      player._actionInWindow = Number(player._actionInWindow || 0) + 1;
      if (player._actionInWindow >= ACTION_SPAM_MAX_IN_WINDOW) {
        player._actionSuppressedUntil = now + ACTION_SPAM_SUPPRESS_MS;
        player._actionWindowStart = now;
        player._actionInWindow = 0;
        if (room.DEV_TIMING_DIAG && !room._netTestEnabled) {
          console.warn(
            `[GameRoom ${room.matchId}] action stream temporarily suppressed for ${player.name}`,
          );
        }
      }
      return;
    }

    if (!isReturnControlAction) {
      player._lastActionAt = now;
    }
    room.handlePlayerAction(socket.id, actionData);
  });

    // Handle special attack request
  room.onSocket(socket, "game:special", (payload = {}) => room.requestSpecial(socket.id, payload));

    // Owner-side hit proposal (server authoritative application)
  room.onSocket(socket, "hit", (payload) => {
    room.handleHit(socket.id, payload);
  });

    // Heal proposal (e.g., abilities/pickups) - server clamps and applies
  room.onSocket(socket, "heal", (payload) => {
    room.handleHeal(socket.id, payload);
  });

  room.onSocket(socket, "deathdrop:pickup", (payload) => {
    room._handleDeathDropPickup(socket.id, payload);
  });

    // Handle disconnection
  room.onSocket(socket, "disconnect", () => {
    // This will be handled by the main socket disconnect handler
    // which calls gameHub.handlePlayerLeave
  });

    // Client signals they're ready to start (assets + scene loaded)
  room.onSocket(socket, "game:ready", (payload = {}) => {
    try {
      const p = room.players.get(socket.id);
      if (!p || !p.user_id) return;
      if (room.status !== "starting" || p._sceneReady) return;
      p._sceneReady = true;
      p.loaded = Number.isFinite(p.x) && Number.isFinite(p.y);
      inputManager.updateBodyGeometry(p, room);
      // Track by user_id (robust to reconnection)
      if (!room._readyAcks.has(p.user_id)) {
        room._readyAcks.add(p.user_id);
        const need = room._requiredUserIds.size;
        const have = room._readyAcks.size;
        if (!room._netTestEnabled) {
          console.log(
            `[GameRoom ${room.matchId}] Ready ack from ${p.name} (${have}/${need})`,
          );
        }
        if (have >= need) {
          room._finalizeStart("all_acks");
        }
      }
    } catch (e) {
      console.warn(
        `[GameRoom ${room.matchId}] game:ready handler error`,
        e?.message,
      );
    }
  });

  registerGameChatEvents(room, socket);
}

module.exports = { setupPlayerSocket };
