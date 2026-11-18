const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { authedRoute } = require("../http");

function positiveId(value) {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? id : null;
}

function registerChatRoutes({
  app,
  requireCurrentUser,
  chatService,
  abuseControl,
}) {
  // Rate limits chat writes. Answers the request and returns false when the
  // user is throttled or banned.
  async function guardChat(res, user, actionType, source) {
    if (!abuseControl) return true;
    const guard = await abuseControl.guardChatAction({
      userId: Number(user.user_id) || 0,
      actionType,
      source,
    });
    if (guard?.allowed) return true;
    res.status(guard?.type === "ban" ? 403 : 429).json({
      success: false,
      error: guard?.message || "You are sending messages too fast.",
      type: guard?.type || "chat_limited",
      suspendedUntilMs: Number(guard?.suspendedUntilMs || 0) || null,
      level: Number(guard?.level || 0) || null,
      violationsUntilBan: Number(guard?.violationsUntilBan || 0) || null,
      banWarning: guard?.banWarning || null,
    });
    return false;
  }

  // Chat service errors carry their own status code and user-facing message.
  function chatRoute(path, handler) {
    app.post(path, authedRoute(requireCurrentUser, `[chat] ${path}`, handler, {
      shape: "bare",
      fallback: "Internal error",
    }));
  }

  chatRoute(API_PATHS.PARTY_CHAT_HISTORY, async (req, res, user) => {
    const partyId = positiveId(req.body?.partyId);
    if (!partyId) return res.status(400).json({ error: "partyId is required" });
    const result = await chatService.getPartyChatHistory({
      partyId,
      user,
      limit: req.body?.limit,
      beforeMessageId: req.body?.beforeMessageId,
    });
    return res.json({ success: true, ...result });
  });

  chatRoute(API_PATHS.PARTY_CHAT_SEND, async (req, res, user) => {
    if (!(await guardChat(res, user, "message", "POST /party-chat/send"))) return undefined;
    const partyId = positiveId(req.body?.partyId);
    if (!partyId) return res.status(400).json({ error: "partyId is required" });
    const message = await chatService.sendPartyChatMessage({
      partyId,
      user,
      body: req.body?.body,
      replyToMessageId: req.body?.replyToMessageId,
    });
    return res.json({ success: true, message });
  });

  chatRoute(API_PATHS.PARTY_CHAT_REACT, async (req, res, user) => {
    if (!(await guardChat(res, user, "reaction", "POST /party-chat/react"))) return undefined;
    const partyId = positiveId(req.body?.partyId);
    const messageId = positiveId(req.body?.messageId);
    if (!partyId || !messageId) {
      return res
        .status(400)
        .json({ error: "partyId and messageId are required" });
    }
    const message = await chatService.reactToPartyChatMessage({
      partyId,
      user,
      messageId,
      reaction: req.body?.reaction,
    });
    return res.json({ success: true, message });
  });

  chatRoute(API_PATHS.PARTY_CHAT_READ, async (req, res, user) => {
    const partyId = positiveId(req.body?.partyId);
    if (!partyId) return res.status(400).json({ error: "partyId is required" });
    const result = await chatService.markPartyChatRead({
      partyId,
      user,
      lastMessageId: req.body?.lastMessageId,
    });
    return res.json({ success: true, ...result });
  });
}

module.exports = { registerChatRoutes };
