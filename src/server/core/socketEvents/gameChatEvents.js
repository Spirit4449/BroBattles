const { GAME_CHAT_BODY_MAX } = require("../../../shared/social/textRules.js");
const { defineSocketHandler, checkChat, respondWithError } = require("./handler");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { resolveCharacterKey } = require("../../../shared/characters/characterStats.js");
function registerGameChatEvents(gameRoom, socket) {
  gameRoom.onSocket(socket, SOCKET_EVENTS.GAME_CHAT_SEND, defineSocketHandler((payload = {}, cb, player) => {
    const body = String(payload?.body || "")
      .trim()
      .slice(0, GAME_CHAT_BODY_MAX);
    if (!body) {
      cb?.({ ok: false, error: "empty_message" });
      return;
    }
    const audience =
      String(payload?.scope || "team").toLowerCase() === "all"
        ? "all"
        : "team";
    const message = {
      id: `${Date.now()}-${gameRoom._chatSeq++}`,
      matchId: Number(gameRoom.matchId),
      body,
      scope: audience,
      createdAt: new Date().toISOString(),
      sender: {
        name: player.name,
        charClass: resolveCharacterKey(player.char_class),
        profileIconId: String(player.profile_icon_id || "") || null,
        team: String(player.team || "team1"),
      },
    };
    if (audience === "all") gameRoom.broadcast(SOCKET_EVENTS.GAME_CHAT_MESSAGE, message);
    else gameRoom.broadcastTeam(String(player.team || "team1"), SOCKET_EVENTS.GAME_CHAT_MESSAGE, message);
    cb?.({ ok: true, message });
  }, {
    auth: () => {
      const player = gameRoom.players.get(socket.id);
      return player?.name ? player : null;
    },
    onUnauthorized: ack => ack?.({ ok: false, error: "not_in_game" }),
    guard: (_payload, player) => Number(player.user_id) > 0 ? checkChat(gameRoom.abuseControl, {
      userId: Number(player.user_id),
      actionType: "message",
      source: "socket:game-chat:send",
      includeWarning: true,
    }) : null,
    onError: respondWithError("Failed to send game chat"),
  }));
}

module.exports = { registerGameChatEvents };
