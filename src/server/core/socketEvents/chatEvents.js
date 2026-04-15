const TYPING_STALE_MS = 4500;
const typingByParty = new Map(); // partyId -> Map<userIdOrName, typer>

function normalizeTypingKey(user) {
  const userId = Number(user?.user_id) || 0;
  if (userId > 0) return `u:${userId}`;
  const fallbackName = String(user?.name || "")
    .trim()
    .toLowerCase();
  if (!fallbackName) return null;
  return `n:${fallbackName}`;
}

function normalizePartyId(value) {
  const partyId = Number(value) || 0;
  return partyId > 0 ? partyId : 0;
}

function getTypingMapForParty(partyId) {
  const normalizedPartyId = normalizePartyId(partyId);
  if (!normalizedPartyId) return null;
  let map = typingByParty.get(normalizedPartyId);
  if (!map) {
    map = new Map();
    typingByParty.set(normalizedPartyId, map);
  }
  return map;
}

function pruneTypingMap(map, now = Date.now()) {
  if (!(map instanceof Map)) return;
  for (const [key, entry] of map.entries()) {
    if (!entry || Number(entry.updatedAt) + TYPING_STALE_MS <= now) {
      map.delete(key);
    }
  }
}

function broadcastTyping(io, partyId) {
  const normalizedPartyId = normalizePartyId(partyId);
  if (!normalizedPartyId) return;
  const map = typingByParty.get(normalizedPartyId);
  if (!map) {
    io?.to?.(`party:${normalizedPartyId}`)?.emit?.("party-chat:typing", {
      partyId: normalizedPartyId,
      typers: [],
    });
    return;
  }
  pruneTypingMap(map);
  if (!map.size) {
    typingByParty.delete(normalizedPartyId);
  }
  const typers = Array.from(map.values())
    .sort((a, b) => String(a?.name || "").localeCompare(String(b?.name || "")))
    .map((entry) => ({
      userId: Number(entry?.userId) || null,
      name: String(entry?.name || ""),
      charClass: String(entry?.charClass || "ninja"),
      profileIconId: String(entry?.profileIconId || "") || null,
    }))
    .filter((entry) => !!entry.name);
  io?.to?.(`party:${normalizedPartyId}`)?.emit?.("party-chat:typing", {
    partyId: normalizedPartyId,
    typers,
  });
}

function clearUserTypingFromAllParties(io, user, keepPartyId = 0) {
  const key = normalizeTypingKey(user);
  if (!key) return;
  const keepId = normalizePartyId(keepPartyId);
  for (const [partyId, map] of typingByParty.entries()) {
    if (keepId && Number(partyId) === keepId) continue;
    if (!(map instanceof Map) || !map.has(key)) continue;
    map.delete(key);
    if (!map.size) {
      typingByParty.delete(partyId);
    }
    broadcastTyping(io, partyId);
  }
}

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

  socket.on("party-chat:typing", (payload = {}, cb) => {
    try {
      const partyId = normalizePartyId(
        payload?.partyId || socket.data?.partyId,
      );
      const user = socket.data?.user || {};
      const key = normalizeTypingKey(user);
      if (!partyId || !key) {
        cb?.({ ok: false, error: "Party not found" });
        return;
      }

      const isTyping = !!payload?.isTyping;
      const map = getTypingMapForParty(partyId);
      if (!map) {
        cb?.({ ok: false, error: "Party not found" });
        return;
      }

      clearUserTypingFromAllParties(
        chatService?.io || socket.nsp?.server,
        user,
        partyId,
      );

      if (isTyping) {
        map.set(key, {
          userId: Number(user?.user_id) || null,
          name: String(user?.name || "").trim() || "Player",
          charClass: String(user?.char_class || "ninja"),
          profileIconId: String(user?.selected_profile_icon_id || "") || null,
          updatedAt: Date.now(),
        });
      } else {
        map.delete(key);
      }

      if (!map.size) {
        typingByParty.delete(partyId);
      }
      broadcastTyping(chatService?.io || socket.nsp?.server, partyId);
      cb?.({ ok: true });
    } catch (error) {
      cb?.({ ok: false, error: error?.message || "Failed to update typing" });
    }
  });

  socket.on("disconnect", () => {
    clearUserTypingFromAllParties(
      chatService?.io || socket.nsp?.server,
      socket.data?.user || {},
    );
  });
}

module.exports = { registerChatEvents };
