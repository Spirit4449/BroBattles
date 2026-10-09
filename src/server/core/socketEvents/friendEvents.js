const TYPING_THROTTLE_MS = 1000;

// Direct-message typing indicators. Requests, messages and party invites go
// over HTTP (friendRoutes); the service pushes updates to `user:<id>` rooms.
function registerFriendEvents(socket, { friendService }) {
  let lastTypingAt = 0;
  socket.on("friends:typing", async (payload = {}, cb) => {
    try {
      const user = socket.data?.user;
      const friendId = Number(payload?.friendId) || 0;
      if (!user?.user_id || !friendId) return cb?.({ ok: false });
      const isTyping = !!payload?.isTyping;
      if (isTyping && Date.now() - lastTypingAt < TYPING_THROTTLE_MS) return cb?.({ ok: true });
      if (isTyping) lastTypingAt = Date.now();
      if (!(await friendService.canShowTyping(user.user_id, friendId))) return cb?.({ ok: false });
      friendService.io?.to(`user:${friendId}`).emit("friends:typing", {
        userId: Number(user.user_id),
        isTyping,
      });
      cb?.({ ok: true });
    } catch (error) {
      cb?.({ ok: false, error: error?.message || "Failed to update typing" });
    }
  });
}

module.exports = { registerFriendEvents };
