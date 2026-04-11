function registerChatEvents(socket, { chatService }) {
  socket.on("party-chat:send", async (payload = {}, cb) => {
    try {
      const partyId = Number(payload?.partyId || socket.data?.partyId || 0);
      const message = await chatService.sendPartyChatMessage({
        partyId,
        user: socket.data.user,
        body: payload?.body,
        replyToMessageId: payload?.replyToMessageId,
      });
      cb?.({ ok: true, message });
    } catch (error) {
      cb?.({ ok: false, error: error?.message || "Failed to send message" });
    }
  });

  socket.on("party-chat:react", async (payload = {}, cb) => {
    try {
      const partyId = Number(payload?.partyId || socket.data?.partyId || 0);
      const message = await chatService.reactToPartyChatMessage({
        partyId,
        user: socket.data.user,
        messageId: payload?.messageId,
        reaction: payload?.reaction,
      });
      cb?.({ ok: true, message });
    } catch (error) {
      cb?.({ ok: false, error: error?.message || "Failed to react" });
    }
  });

  socket.on("party-chat:read", async (payload = {}, cb) => {
    try {
      const partyId = Number(payload?.partyId || socket.data?.partyId || 0);
      const result = await chatService.markPartyChatRead({
        partyId,
        user: socket.data.user,
        lastMessageId: payload?.lastMessageId,
      });
      cb?.({ ok: true, ...result });
    } catch (error) {
      cb?.({ ok: false, error: error?.message || "Failed to mark read" });
    }
  });
}

module.exports = { registerChatEvents };
