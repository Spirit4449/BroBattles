function registerGameChatEvents(gameRoom, socket) {
  socket.on("game:chat:send", async (payload = {}, cb) => {
    try {
      const player = gameRoom.players.get(socket.id);
      if (!player || !player.name) {
        cb?.({ ok: false, error: "not_in_game" });
        return;
      }

      if (gameRoom.abuseControl && Number(player.user_id) > 0) {
        const guard = await gameRoom.abuseControl.guardChatAction({
          userId: Number(player.user_id),
          actionType: "message",
          source: "socket:game-chat:send",
        });
        if (!guard?.allowed) {
          cb?.({
            ok: false,
            error: guard?.message || "You are sending messages too fast.",
            type: guard?.type || "chat_limited",
            suspendedUntilMs: Number(guard?.suspendedUntilMs || 0) || null,
            level: Number(guard?.level || 0) || null,
            violationsUntilBan: Number(guard?.violationsUntilBan || 0) || null,
            banWarning: guard?.banWarning || null,
          });
          return;
        }
      }

      const body = String(payload?.body || "")
        .trim()
        .slice(0, 220);
      if (!body) {
        cb?.({ ok: false, error: "empty_message" });
        return;
      }
      const message = {
        id: `${Date.now()}-${gameRoom._chatSeq++}`,
        matchId: Number(gameRoom.matchId),
        body,
        createdAt: new Date().toISOString(),
        sender: {
          name: player.name,
          charClass: String(player.char_class || "ninja"),
          profileIconId: String(player.profile_icon_id || "") || null,
          team: String(player.team || "team1"),
        },
      };
      gameRoom.io
        .to(`game:${gameRoom.matchId}`)
        .emit("game:chat:message", message);
      cb?.({ ok: true, message });
    } catch (error) {
      cb?.({ ok: false, error: error?.message || "Failed to send game chat" });
    }
  });
}

module.exports = { registerGameChatEvents };
