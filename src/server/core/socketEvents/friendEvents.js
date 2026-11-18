const { defineSocketHandler, respondWithError } = require("./handler");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const TYPING_THROTTLE_MS = 1000;

// Direct-message typing indicators. Requests, messages and party invites go
// over HTTP (friendRoutes); the service pushes updates to `user:<id>` rooms.
function registerFriendEvents(socket, { friendService }) {
  let lastTypingAt = 0;
  socket.on(SOCKET_EVENTS.FRIENDS_TYPING, defineSocketHandler(async (payload = {}, cb, user) => {
    const friendId = Number(payload?.friendId) || 0;
    if (!friendId) return cb?.({ ok: false });
    const isTyping = !!payload?.isTyping;
    if (isTyping && Date.now() - lastTypingAt < TYPING_THROTTLE_MS) return cb?.({ ok: true });
    if (isTyping) lastTypingAt = Date.now();
    if (!(await friendService.canShowTyping(user.user_id, friendId))) return cb?.({ ok: false });
    friendService.io?.to(`user:${friendId}`).emit(SOCKET_EVENTS.FRIENDS_TYPING, {
      userId: Number(user.user_id),
      isTyping,
    });
    cb?.({ ok: true });
  }, {
    auth: () => {
      const user = socket.data?.user;
      return user?.user_id ? user : null;
    },
    onUnauthorized: ack => ack?.({ ok: false }),
    onError: respondWithError("Failed to update typing"),
  }));
}

module.exports = { registerFriendEvents };
