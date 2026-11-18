const { createParticipantRecord } = require("./playerRecord");
const { fetchRosterLevel } = require("../../services/match/matchRosterService");
const { computeMatchStats } = require("../../../shared/characters/characterStats");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { roomChannel, teamChannel } = require("./channels");
const inputManager = require("./inputManager");

const pendingJoins = new WeakMap();

async function addPlayer(room, socket, user) {
  let joins = pendingJoins.get(room);
  if (!joins) {
    joins = new Map();
    pendingJoins.set(room, joins);
  }
  const userId = Number(user?.user_id);
  // Room adapter operations can await. Finish replacing a participant's
  // socket before starting another join for that participant.
  const previous = joins.get(userId);
  const continueJoin = () => joinPlayer(room, socket, user);
  const current = previous
    ? previous.then(continueJoin, continueJoin)
    : continueJoin();
  joins.set(userId, current);
  try {
    return await current;
  } finally {
    if (joins.get(userId) === current) joins.delete(userId);
  }
}

function assertJoinAvailable(room, socket) {
  if (room._disposed || room.status === "finished") {
    throw Object.assign(new Error("This match has finished"), { code: "MATCH_FINISHED" });
  }
  if (socket.connected === false) {
    throw Object.assign(new Error("This socket disconnected"), { code: "SOCKET_DISCONNECTED" });
  }
}

async function settleChannels(socket, action, channels) {
  const results = await Promise.allSettled(channels.map(async (channel) => socket[action](channel)));
  for (const result of results) {
    if (result.status === "rejected") {
      console.warn(`[GameRoom] Failed to ${action} socket room during join rollback:`, result.reason?.message);
    }
  }
}

async function joinPlayer(room, socket, user) {
  const userId = Number(user?.user_id);
  const matchPlayer = room.matchData.players.find(
    (p) => !p.isBot && Number(p.user_id) === userId,
  );
  if (!Number.isFinite(userId) || userId <= 0 || !matchPlayer) {
    throw Object.assign(new Error("You are not a participant in this match"), { code: "NOT_PARTICIPANT" });
  }
  assertJoinAvailable(room, socket);

  const channels = [roomChannel(room.matchId), teamChannel(room.matchId, matchPlayer.team)];
  const findExisting = () => Array.from(room.players.values()).find(
    (p) => !p.isBot && Number(p.user_id) === userId,
  );
  let playerData = findExisting();
  if (playerData?._levelLookup) {
    // A ghost seeded without a level: join with its real stats.
    await playerData._levelLookup;
    assertJoinAvailable(room, socket);
  }
  let level = Number(matchPlayer.level);
  if (!playerData && !(level > 0)) {
    level = await fetchRosterLevel(room.db, userId, matchPlayer.char_class);
  }
  assertJoinAvailable(room, socket);

  // Keep existing ownership in place until both adapter memberships succeed.
  // Track attempted rooms too, in case an adapter rejects after adding one.
  const added = [];
  try {
    for (const channel of channels) {
      if (socket.rooms?.has(channel)) continue;
      added.push(channel);
      await socket.join(channel);
      assertJoinAvailable(room, socket);
    }

    // The countdown may have seeded a ghost, or the old socket may have
    // disconnected, while the adapter was joining the new socket.
    playerData = findExisting();
    if (playerData?.socketId === socket.id) {
      room.sendGameStateToPlayer(socket);
      room._cancelAbandonTimer("player_joined");
      return;
    }

    const previousSocket = room.io.sockets.sockets.get(playerData?.socketId);
    if (previousSocket) {
      const removed = [];
      try {
        for (const channel of channels) {
          if (!previousSocket.rooms?.has(channel)) continue;
          removed.push(channel);
          await previousSocket.leave(channel);
          assertJoinAvailable(room, socket);
        }
      } catch (error) {
        if (!room._disposed && room.status !== "finished" && previousSocket.connected !== false) {
          await settleChannels(previousSocket, "join", removed);
          if (room._disposed || room.status === "finished" || previousSocket.connected === false) {
            await settleChannels(previousSocket, "leave", removed);
          }
        }
        throw error;
      }
      room.removePlayerSocket(previousSocket);
    }
  } catch (error) {
    await settleChannels(socket, "leave", added);
    throw error;
  }

  const reconnecting = Boolean(playerData);
  if (!playerData) {
    playerData = createParticipantRecord(room, matchPlayer, {
      socketId: socket.id, userId, level, name: matchPlayer.name || user.name,
    });
  } else {
    for (const [key, value] of room.players) {
      if (value === playerData) room.players.delete(key);
    }
    playerData.socketId = socket.id;
    playerData.connected = true;
    playerData._neverJoined = false;
    playerData._lastPositionSeq = -1;
    playerData._lastPositionClientTs = 0;
    if (!Number.isFinite(playerData.x) || !Number.isFinite(playerData.y)) {
      Object.assign(playerData, room.spawnStateFor(playerData), { flip: false });
    }
  }
  inputManager.updateBodyGeometry(playerData, room);
  inputManager.resetMovementBudget(playerData);
  room.players.set(socket.id, playerData);
  room.ensureRewardBucket(playerData);
  if (reconnecting) {
    room.broadcast(SOCKET_EVENTS.PLAYER_RECONNECTED, {
      name: playerData.name,
      username: playerData.name,
      loaded: playerData.loaded === true,
    });
  }
  room.setupPlayerSocket(socket);
  room.sendGameStateToPlayer(socket);
  room._cancelAbandonTimer("player_joined");
}

async function removePlayer(room, socket, user) {
  const playerData = room.players.get(socket.id);
  if (!playerData) return;

  room.removePlayerSocket(socket);
  socket.leave(roomChannel(room.matchId));
  const teamRoom = teamChannel(room.matchId, playerData.team || "team1");
  socket.leave(teamRoom);
  room.players.delete(socket.id);
  playerData.socketId = null;
  playerData.connected = false;
  room.players.set(`offline:${playerData.user_id}`, playerData);

  if (!room._netTestEnabled) {
    console.log(
      `[GameRoom ${room.matchId}] Player ${user.name} left (${room.getPlayerCount()} connected remaining)`,
    );
  }

  // Handle disconnection during active game
  if (room.status === "active") {
    room.broadcast(SOCKET_EVENTS.PLAYER_DISCONNECTED, {
      name: user.name,
      username: user.name,
      loaded: playerData.loaded === true,
      playersRemaining: room.getPlayerCount(),
    });
  }

  room._scheduleAbandonIfNoHumansConnected();
}

function seedAbsentHumans(room) {
  for (const matchPlayer of Array.isArray(room.matchData?.players) ? room.matchData.players : []) {
    const userId = Number(matchPlayer?.user_id);
    if (matchPlayer?.isBot || !Number.isFinite(userId) || userId <= 0) continue;
    const present = Array.from(room.players.values()).some((p) => !p.isBot && Number(p.user_id) === userId);
    if (present) continue;
    const knownLevel = Number(matchPlayer.level) > 0 ? Number(matchPlayer.level) : null;
    const playerData = createParticipantRecord(room, matchPlayer, {
      userId, level: knownLevel || 1, name: matchPlayer.name, connected: false,
    });
    // Cleared when the player joins; a no-show earns trophies but no rewards.
    playerData._neverJoined = true;
    inputManager.updateBodyGeometry(playerData, room);
    inputManager.resetMovementBudget(playerData);
    room.players.set(`offline:${userId}`, playerData);
    // Legacy rosters carry no level: look it up while the countdown runs,
    // and let a join wait for it (see addPlayer).
    if (!knownLevel) {
      playerData._levelLookup = fetchRosterLevel(room.db, userId, matchPlayer.char_class)
        .then((level) => applyLevel(room, playerData, level))
        .finally(() => { playerData._levelLookup = null; });
    }
  }
}

// Preserve the fighter's remaining health percentage when its saved level arrives.
function applyLevel(room, playerData, level) {
  if (room._disposed || !playerData || playerData.level === level) return;
  const {
    maxHealth, baseDamage, specialDamage, specialChargeHits,
    ammoCapacity, ammoCooldownMs, ammoReloadMs,
  } = computeMatchStats(playerData.char_class, level);
  const share = playerData.maxHealth > 0 ? playerData.health / playerData.maxHealth : 1;
  Object.assign(playerData, {
    level, maxHealth, baseDamage, specialDamage, maxSuperCharge: specialChargeHits,
    health: playerData.isAlive ? Math.max(1, Math.round(maxHealth * share)) : 0,
  });
  Object.assign(playerData.ammoState, {
    capacity: ammoCapacity,
    charges: Math.min(playerData.ammoState.charges, ammoCapacity),
    cooldownMs: ammoCooldownMs,
    reloadMs: ammoReloadMs,
  });
  room.broadcastHealthUpdate(playerData, { cause: "level" });
}

function seedBotPlayers(room) {
  for (const player of room.matchData.players || []) {
    if (!player.isBot) continue;
    room.players.set(player.participantId, createParticipantRecord(room, player, {
      userId: player.user_id, level: player.level || 1, name: player.name,
    }));
  }
}

module.exports = { addPlayer, removePlayer, seedAbsentHumans, applyLevel, seedBotPlayers };
