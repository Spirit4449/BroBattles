const { getConfig } = require("../config");
const { SOCKET_EVENTS } = require("../../shared/net/socketEvents.js");
const { isAccountBanned } = require("../../shared/moderation/accountBan");
const { createPlayerActivityService } = require("../services/match/playerActivityService");
const cookie = require("cookie");
const cookieSignature = require("cookie-signature");
const {
  PARTY_STATUS,
  TEAM_SIZE_BY_MODE,
} = require("../services/party/partyRules");
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
} = require("../services/party/partyPresenceService");
const { createPartyStateService } = require("../services/party/partyStateService");
const {
  createPartyQueueTransitionService,
} = require("../services/party/partyQueueTransitionService");
const { registerChatEvents } = require("./socketEvents/chatEvents");
const { registerFriendEvents } = require("./socketEvents/friendEvents");
const { netTrace } = require("./gameRoom/netTraceRecorder");

const NOISY_EVENTS = new Set([SOCKET_EVENTS.GAME_INPUT, SOCKET_EVENTS.HEARTBEAT]);
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
function initSocket({
  io,
  COOKIE_SECRET,
  sessions,
  navigation,
  matchResults,
  db,
  runtimeConfig,
  chatService,
  abuseControl,
  friendService,
}) {
  const typingByParty = new Map();
  const userSockets = new Map(); // name -> Set<socketId>
  const DEBUG_SOCKET_EVENTS = getConfig().diagnostics.socketEvents;
  const partyPresence = createPartyPresenceService({ db, io });
  let gameHub;
  const playerActivity = createPlayerActivityService({
    schedule: "deferred",
    db, io, setPresence: partyPresence.setUserPresence,
    getGameRoom: matchId => gameHub?.getGameRoom(matchId),
    onStatusChange: (name, status) => friendService?.handleStatusChange(name, status),
  });
  friendService?.attachPresence({ getStatus: playerActivity.getStatus });
  // Game hub for managing active game rooms
  gameHub = createGameHub({ io, db, runtimeConfig, abuseControl, playerActivity, matchResults, navigation });

  // Matchmaking controller (power-saved loop inside)
  const mm = createMatchmaking({
    io,
    db,
    gameHub, // Pass game hub to matchmaking
    runtimeConfig,
    teamSizeByMode: TEAM_SIZE_BY_MODE,
  });
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
        "user_id", // this cookie stores an opaque session token
        COOKIE_SECRET,
      );
      socket.data.netTrace = netTrace.authorize(socket.handshake?.auth);
      if (!userIdStr) {
        socket.data.user = null;
        return next();
      }
      const user = await sessions.authenticateSocket(socket, userIdStr);

      socket.data.user = user || null;
      if (user && socket.data.netTrace) netTrace.markTracedUser(user.name);
      if (!user && DEBUG_SOCKET_EVENTS) {
        console.warn("[socket-auth] no user found for signed cookie", {
          socketId: socket.id,
          sessionCookiePresent: !!userIdStr,
        });
      } else if (user && isAccountBanned(user)) {
        socket.data.user = null;
        return next(new Error("Account banned"));
      }
      next();
    } catch (e) {
      console.error("Socket auth error:", e);
      next(new Error("Unauthorized"));
    }
  });

  io.on(SOCKET_EVENTS.CONNECTION, async (socket) => {
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
      abuseControl,
    });
    // Lobby selection can be emitted as soon as the client sees `connect`.
    // Register party/character handlers before the presence DB work below so a
    // fast character or skin selection is never dropped during connection setup.
    registerPartyEvents(socket, {
      db,
      io,
      mm,
      partyPresence,
      partyState,
      partyQueueTransition,
      gameHub,
      PARTY_STATUS,
    });

    registerPresenceEvents(socket, { db, gameHub, playerActivity, partyQueueTransition, userSockets });

    // Per-user room reaches every tab, independent of users.socket_id.
    if (userId) socket.join(`user:${Number(userId)}`);

    // store socket id and mark online
    try {
      if (userId) await db.setUserSocketId(userId, socket.id);
    } catch (e) {
      console.warn("Could not persist socket_id:", e?.message);
    }

    if (!socket.connected) return;

    // Track this socket for the user and mark online
    if (username) {
      let set = userSockets.get(username);
      if (!set) {
        set = new Set();
        userSockets.set(username, set);
      }
      set.add(socket.id);

      try {
        // mark online if not already and emit to others
        const partyId = await db.getPartyIdByName(username);
        // auto-join room
        if (partyId) {
          socket.join(`party:${partyId}`);
          socket.data.partyId = partyId;
          socket.emit(SOCKET_EVENTS.PARTY_JOINED, { partyId });
        } else {
          socket.join("lobby");
          socket.data.partyId = null;
          socket.emit(SOCKET_EVENTS.PARTY_JOINED, { partyId: null });
        }
      } catch (e) {
        console.warn(
          "Could not set online presence or auto join party:",
          e?.message,
        );
      }
    }

    registerChatEvents(socket, {
      typingByParty,
      chatService,
      abuseControl,
    });

    if (friendService) registerFriendEvents(socket, { friendService });

    registerMatchmakingEvents(socket, {
      db,
      io,
      mm,
      PARTY_STATUS,
      abuseControl,
    });

  });

  return {
    start() { playerActivity.start(); return mm.start(); },
    async dispose() { await mm.stop(); gameHub.dispose(); playerActivity.dispose(); partyPresence.dispose(); },
    getGameRoom: matchId => gameHub.getGameRoom(Number(matchId)),
    // For routes to move sockets after DB changes:
    async moveUserSocketToParty(username, partyId) {
      try {
        const rows = await db.runQuery(
          "SELECT socket_id FROM users WHERE name = ? LIMIT 1",
          [username],
        );
        const sid = rows[0]?.socket_id;
        if (!sid) {
          console.warn("[socket] moveUserSocketToParty missing socket_id", {
            username,
            partyId,
          });
          return;
        }
        const sock = io.sockets.sockets.get(sid);
        if (!sock) {
          console.warn(
            "[socket] moveUserSocketToParty socket not found in io map",
            {
              username,
              partyId,
              socketId: sid,
            },
          );
          return;
        }
        for (const room of sock.rooms)
          if (room.startsWith("party:")) sock.leave(room);
        sock.join(`party:${partyId}`);
        sock.data.partyId = Number(partyId) || null;
        sock.emit(SOCKET_EVENTS.PARTY_JOINED, { partyId });
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
        sock.data.partyId = null;
        sock.emit(SOCKET_EVENTS.PARTY_JOINED, { partyId: null });
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
