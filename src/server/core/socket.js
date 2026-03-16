// socket.js
const cookie = require("cookie");
const cookieSignature = require("cookie-signature");
const {
  PARTY_STATUS,
  DISCONNECT_GRACE_MS,
  TEAM_SIZE_BY_MODE,
} = require("../../server/helpers/constants");
const { createMatchmaking } = require("./matchmaking");
const { createGameHub } = require("./gameHub");
const { registerGameEvents } = require("./socketEvents/gameEvents");
const { registerPartyEvents } = require("./socketEvents/partyEvents");
const {
  registerMatchmakingEvents,
} = require("./socketEvents/matchmakingEvents");
const { registerPresenceEvents } = require("./socketEvents/presenceEvents");

// Presence tracking (multi-tab safe)
const userSockets = new Map(); // name -> Set<socketId>
const pendingOffline = new Map(); // name -> timeoutId

function readSignedCookieFromHandshake(socket, cookieName, secret) {
  const header = socket.handshake?.headers?.cookie;
  if (!header) return null;
  const parsed = cookie.parse(header);
  const raw = parsed[cookieName];
  if (!raw || !raw.startsWith("s:")) return null; // cookie-parser format
  const unsigned = cookieSignature.unsign(raw.slice(2), secret);
  return unsigned || null;
}

/**
 * Create the socket layer with injected DB helpers.
 * @param {object} deps
 *  - io
 *  - COOKIE_SECRET
 *  - db: {
 *      getUserById, getPartyIdByName, fetchPartyMembersDetailed,
 *      setUserStatus, setUserSocketId, clearUserSocketIfMatch,
 *      updateLastSeen
 *    }
 */
function initSocket({ io, COOKIE_SECRET, db, runtimeConfig }) {
  // Game hub for managing active game rooms
  const gameHub = createGameHub({ io, db, runtimeConfig });

  // Matchmaking controller (power-saved loop inside)
  const mm = createMatchmaking({
    io,
    db,
    gameHub, // Pass game hub to matchmaking
    teamSizeByMode: TEAM_SIZE_BY_MODE,
  });
  // unified presence setter
  async function setPresence(name, status, partyId = null) {
    try {
      await db.setUserStatus(name, status);
      if (!partyId) partyId = await db.getPartyIdByName(name);
      if (partyId) {
        io.to(`party:${partyId}`).emit("status:update", {
          partyId,
          name,
          status,
        });
      }
    } catch (_) {}
  }

  // auth: attach user row from signed cookie (middleware)
  io.use(async (socket, next) => {
    try {
      const userIdStr = readSignedCookieFromHandshake(
        socket,
        "user_id", // this cookie stores the user ID
        COOKIE_SECRET,
      );
      if (!userIdStr) {
        socket.data.user = null;
        return next();
      }
      const user = await db.getUserById(Number(userIdStr));
      socket.data.user = user || null;
      next();
    } catch (e) {
      console.error("Socket auth error:", e);
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", async (socket) => {
    const user = socket.data.user; // returns from middleware
    const userId = user?.user_id;
    const username = user?.name;

    // IMPORTANT: Register timing-sensitive handlers BEFORE any awaited work
    // to avoid dropping early client emits (e.g., game:join right after connect).
    registerGameEvents(socket, {
      db,
      gameHub,
    });

    // store socket id and mark online
    try {
      if (userId) await db.setUserSocketId(userId, socket.id);
    } catch (e) {
      console.warn("Could not persist socket_id:", e?.message);
    }

    // Track this socket for the user and mark online
    if (username) {
      console.log("User connected:", { username, socketId: socket.id });
      const timeoutId = pendingOffline.get(username);
      if (timeoutId) {
        clearTimeout(timeoutId);
        pendingOffline.delete(username);
      }
      let set = userSockets.get(username);
      if (!set) {
        set = new Set();
        userSockets.set(username, set);
      }
      set.add(socket.id);

      try {
        // mark online if not already and emit to others
        const partyId = await db.getPartyIdByName(username);
        await setPresence(username, "online", partyId || null);
        // auto-join room
        if (partyId) {
          socket.join(`party:${partyId}`);
          socket.emit("party:joined", { partyId });
        } else {
          socket.join("lobby");
          socket.emit("party:joined", { partyId: null });
        }
      } catch (e) {
        console.warn(
          "Could not set online presence or auto join party:",
          e?.message,
        );
      }
    }

    registerPartyEvents(socket, {
      db,
      io,
      mm,
      setPresence,
      PARTY_STATUS,
    });

    registerMatchmakingEvents(socket, {
      db,
      io,
      mm,
      PARTY_STATUS,
    });
    registerPresenceEvents(socket, {
      db,
      io,
      mm,
      gameHub,
      setPresence,
      userSockets,
      pendingOffline,
      DISCONNECT_GRACE_MS,
    });
  });

  // fallback offline scanner
  setInterval(async () => {
    try {
      // (We can’t do this purely here without raw SQL; routes keep last_seen fresh)
      // This module relies on db.updateLastSeen being called by heartbeat/routes,
      // and your server eviction loop handling removal + roster broadcasts.
      // If you want this module to own fallback offline too, inject a db.findStaleSince(sec).
    } catch (e) {
      console.warn("offline fallback scan failed:", e?.message);
    }
  }, 15_000);

  return {
    // For routes to move sockets after DB changes:
    async moveUserSocketToParty(username, partyId) {
      try {
        const rows = await db.runQuery(
          "SELECT socket_id FROM users WHERE name = ? LIMIT 1",
          [username],
        );
        const sid = rows[0]?.socket_id;
        if (!sid) return;
        const sock = io.sockets.sockets.get(sid);
        if (!sock) return;
        for (const room of sock.rooms)
          if (room.startsWith("party:")) sock.leave(room);
        sock.join(`party:${partyId}`);
        sock.emit("party:joined", { partyId });
      } catch (e) {
        console.warn("moveUserSocketToParty failed:", e?.message);
      }
    },
    async moveUserSocketToLobby(username) {
      try {
        const rows = await db.runQuery(
          "SELECT socket_id FROM users WHERE name = ? LIMIT 1",
          [username],
        );
        const sid = rows[0]?.socket_id;
        if (!sid) return;
        const sock = io.sockets.sockets.get(sid);
        if (!sock) return;
        for (const room of sock.rooms)
          if (room.startsWith("party:")) sock.leave(room);
        sock.join("lobby");
        sock.emit("party:joined", { partyId: null });
      } catch (e) {
        console.warn("moveUserSocketToLobby failed:", e?.message);
      }
    },
    // Cancel any active matchmaking when party composition changes (e.g., someone joins)
    async cancelPartyQueue(partyId, userId = null) {
      try {
        if (partyId) {
          try {
            await mm.queueLeave({ partyId, userId: null });
          } catch (_) {}
          io.to(`party:${partyId}`).emit("match:cancelled", {
            reason: `A new user joined the party`,
          });
          console.log(
            `[cancel][party] composition changed -> cancelled party ${partyId}`,
          );
        }
        if (userId) {
          try {
            await mm.queueLeave({ partyId: null, userId });
            console.log(
              `[cancel][solo] user ${userId} solo ticket, if any, removed`,
            );
          } catch (_) {}
        }
      } catch (e) {
        console.warn("cancelPartyQueue failed:", e?.message);
      }
    },
  };
}

module.exports = { initSocket };
