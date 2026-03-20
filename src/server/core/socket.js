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
const {
  createPartyPresenceService,
} = require("../services/partyPresenceService");
const { createPartyStateService } = require("../services/partyStateService");
const {
  createPartyQueueTransitionService,
} = require("../services/partyQueueTransitionService");

const DEBUG_SOCKET_EVENTS =
  String(process.env.DEBUG_SOCKET_EVENTS || "").toLowerCase() === "1" ||
  String(process.env.DEBUG_SOCKET_EVENTS || "").toLowerCase() === "true";
const NOISY_EVENTS = new Set(["game:input", "game:input-intent", "heartbeat"]);
const NOISY_EVENT_SAMPLE_EVERY = 50;

function summarizeArg(value) {
  if (value == null) return value;
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return `[array:${value.length}]`;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    if (Array.isArray(v)) {
      out[k] = `[array:${v.length}]`;
      continue;
    }
    if (typeof v === "object") {
      out[k] = "[object]";
      continue;
    }
    out[k] = v;
  }
  return out;
}

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
  const partyPresence = createPartyPresenceService({ db, io });
  const partyState = createPartyStateService({ db, io });
  const partyQueueTransition = createPartyQueueTransitionService({
    db,
    io,
    mm,
  });

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

    if (DEBUG_SOCKET_EVENTS) {
      const eventCounts = new Map();
      const shouldLogEvent = (eventName) => {
        if (!NOISY_EVENTS.has(eventName)) return true;
        const n = (eventCounts.get(eventName) || 0) + 1;
        eventCounts.set(eventName, n);
        return n % NOISY_EVENT_SAMPLE_EVERY === 0;
      };

      socket.onAny((eventName, ...args) => {
        if (!shouldLogEvent(eventName)) return;
        const sample = args.slice(0, 1).map(summarizeArg);
        console.log(
          `[SocketDebug] IN event=${eventName} socket=${socket.id} user=${username || "anon"}`,
          sample.length ? sample[0] : "",
        );
      });

      if (typeof socket.onAnyOutgoing === "function") {
        socket.onAnyOutgoing((eventName, ...args) => {
          if (!shouldLogEvent(eventName)) return;
          const sample = args.slice(0, 1).map(summarizeArg);
          console.log(
            `[SocketDebug] OUT event=${eventName} socket=${socket.id} user=${username || "anon"}`,
            sample.length ? sample[0] : "",
          );
        });
      }
    }

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
        await partyPresence.setUserPresence(
          username,
          "online",
          partyId || null,
        );
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
      partyPresence,
      partyState,
      partyQueueTransition,
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
      setPresence: partyPresence.setUserPresence,
      partyQueueTransition,
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
      await partyQueueTransition.cancelPartyQueue({
        partyId,
        userId,
        reason: "A new user joined the party",
      });
    },
  };
}

module.exports = { initSocket };
