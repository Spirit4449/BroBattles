// gameHub.js
// Central hub for managing active game rooms

/**
 * @typedef {Object} GameHubDeps
 * @property {import('socket.io').Server} io
 * @property {object} db - Database helpers
 * @property {object} [runtimeConfig]
 */

/**
 * Create game hub controller
 * @param {GameHubDeps} deps
 */
function createGameHub({ io, db, runtimeConfig = null }) {
  // Map of matchId -> GameRoom instance
  const activeRooms = new Map();

  /**
   * Create a new game room when match goes live
   * @param {number} matchId
   * @param {object} matchData - { mode, map, players }
   */
  async function createGameRoom(matchId, matchData) {
    if (activeRooms.has(matchId)) {
      console.warn(`[GameHub] Room ${matchId} already exists`);
      return activeRooms.get(matchId);
    }

    const { GameRoom } = require("./gameRoom");
    const room = new GameRoom(matchId, matchData, {
      io,
      db,
      runtimeConfig,
    });
    activeRooms.set(matchId, room);

    console.log(
      `[GameHub] Created game room ${matchId} for ${matchData.players.length} players`
    );
    return room;
  }

  /**
   * Get existing game room
   * @param {number} matchId
   */
  function getGameRoom(matchId) {
    return activeRooms.get(matchId);
  }

  /**
   * Remove a game room (called when game ends)
   * @param {number} matchId
   */
  function removeGameRoom(matchId) {
    const room = activeRooms.get(matchId);
    if (room) {
      room.cleanup();
      activeRooms.delete(matchId);
      console.log(`[GameHub] Removed game room ${matchId}`);
    }
  }

  /**
   * Handle player joining a game room
   * @param {object} socket
   * @param {number} matchId
   */
  async function handlePlayerJoin(socket, matchId) {
    const room = activeRooms.get(matchId);
    if (!room) {
      socket.emit("game:error", { message: "Game room not found" });
      return false;
    }

    const user = socket.data.user;
    if (!user) {
      socket.emit("game:error", { message: "Authentication required" });
      return false;
    }

    try {
      await room.addPlayer(socket, user);
      return true;
    } catch (error) {
      console.error(
        `[GameHub] Error adding player ${user.name} to room ${matchId}:`,
        error
      );
      socket.emit("game:error", { message: error.message });
      return false;
    }
  }

  /**
   * Handle player leaving a game room
   * @param {object} socket
   * @param {number} matchId
   */
  async function handlePlayerLeave(socket, matchId) {
    const room = activeRooms.get(matchId);
    if (!room) return;

    const user = socket.data.user;
    if (!user) return;

    try {
      await room.removePlayer(socket, user);
      // If room is empty, clean it up immediately
      if (room.getPlayerCount() === 0) removeGameRoom(matchId);
    } catch (error) {
      console.error(
        `[GameHub] Error removing player ${user.name} from room ${matchId}:`,
        error
      );
    }
  }

  /**
   * Get all active room stats (for debugging/monitoring)
   */
  function getStats() {
    const rooms = [];
    for (const [matchId, room] of activeRooms) {
      rooms.push({
        matchId,
        playerCount: room.getPlayerCount(),
        status: room.getStatus(),
        uptime: Date.now() - room.getStartTime(),
      });
    }
    return { activeRooms: rooms.length, rooms };
  }

  return {
    createGameRoom,
    getGameRoom,
    removeGameRoom,
    handlePlayerJoin,
    handlePlayerLeave,
    getStats,
  };
}

module.exports = { createGameHub };
