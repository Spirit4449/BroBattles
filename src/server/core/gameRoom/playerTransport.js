const { defineSocketHandler } = require("../socketEvents/handler");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { decodeWire } = require("../../../shared/networkWire");
const sparrowCombat = require('../../../shared/combat/runtime/sparrowCombat.js');
const inputManager = require("./inputManager");
const characterCombat = require('../../../shared/combat/runtime/characterCombatRegistry.js');
const { stampViewRewind, createLatencyProbe } = require('../../../shared/combat/runtime/lagCompensation.js');
const {
  ACTION_MIN_INTERVAL_MS,
  ACTION_SPAM_WINDOW_MS,
  ACTION_SPAM_MAX_IN_WINDOW,
  ACTION_SPAM_SUPPRESS_MS
} = require("../../../shared/combat/matchConfig.js");
const { registerGameChatEvents } = require("../socketEvents/gameChatEvents");
const { netTrace } = require('./netTraceRecorder');

function setupPlayerSocket(room, socket) {
  const latency = createLatencyProbe(room, socket);
  if (socket.data?.netTrace) {
    netTrace.attachRoom(room, socket);
    room.onSocket(socket, SOCKET_EVENTS.DEBUG_NET_TRACE, defineSocketHandler((payload, ack) => {
      const ok = netTrace.acceptClientBatch(socket, payload);
      if (typeof ack === 'function') ack({ ok });
    }));
  }
  room.onSocket(socket, SOCKET_EVENTS.GAME_CLOCK, defineSocketHandler((data, ack) => {
    if (typeof ack === 'function') ack(sparrowCombat.timing(room));
    latency.probe();
  }));
    // Handle player input
  room.onSocket(socket, SOCKET_EVENTS.GAME_INPUT, (inputData) => {
    inputData = decodeWire(inputData);
    if (room.netTrace) netTrace.noteInput(room, socket.id);
    if (room.status !== "finished" && room.players.has(socket.id) && Number.isFinite(inputData?.x) && Number.isFinite(inputData?.y)) {
      room.playerActivity?.gameActivity(socket, room.matchId);
    }
    room.handlePlayerInput(socket.id, inputData);
  });

    // Handle player actions (attacks, abilities, etc.)
  room.onSocket(socket, SOCKET_EVENTS.GAME_ACTION, (actionData) => {
    const player = room.players.get(socket.id);
    if (!player) return;
    stampViewRewind(room, actionData, latency);
    if (room.netTrace) netTrace.noteAction(room, socket.id, SOCKET_EVENTS.GAME_ACTION, actionData);
    if (characterCombat.ownsAction(room, player, actionData)) {
      room.handlePlayerAction(socket.id, actionData);
      return;
    }
    if (Number(player._controlLockUntil || 0) > Date.now()) return;
    const now = Date.now();
    if (Number(player._actionSuppressedUntil || 0) > now) return;

    const lastActionAt = Number(player._lastActionAt || 0);
    if (
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

    player._lastActionAt = now;
    room.handlePlayerAction(socket.id, actionData);
  });

    // Handle special attack request
  room.onSocket(socket, SOCKET_EVENTS.GAME_SPECIAL, (payload = {}) => {
    stampViewRewind(room, payload, latency);
    if (room.netTrace) netTrace.noteAction(room, socket.id, SOCKET_EVENTS.GAME_SPECIAL, payload);
    room.requestSpecial(socket.id, payload);
  });

  room.onSocket(socket, SOCKET_EVENTS.DEATHDROP_PICKUP, (payload) => {
    room.pickupDeathDrop(socket.id, payload);
  });

  // The client's loading screen lifted: its scene exists and its pregame began.
  // Repeats (watchdog, reconnects) are harmless. Once the match is underway a
  // late loader becomes loaded through its input packets instead.
  room.onSocket(socket, SOCKET_EVENTS.GAME_READY, () => {
    try {
      const p = room.players.get(socket.id);
      if (!p || !p.user_id || room.status !== "waiting") return;
      if (!p._sceneReady) {
        p._sceneReady = true;
        p.loaded = Number.isFinite(p.x) && Number.isFinite(p.y);
        inputManager.updateBodyGeometry(p, room);
        // No snapshots flow before FIGHT, so clients that loaded earlier would
        // keep this fighter hidden through the pregame without this.
        if (p.loaded) {
          room.broadcast(SOCKET_EVENTS.PLAYER_LOADED, { name: p.name, x: p.x, y: p.y });
        }
      }
      if (room._noteReady(p) && !room._netTestEnabled) {
        console.log(
          `[GameRoom ${room.matchId}] Ready from ${p.name} (${room._readyAt.size}/${room._requiredUserIds.size})`,
        );
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
