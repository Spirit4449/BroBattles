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
    app.post(path, async (req, res) => {
      try {
        const user = await requireCurrentUser(req, res);
        if (!user) return res.status(401).json({ error: "Not authenticated" });
        return await handler(req, res, user);
      } catch (error) {
        const status = Number(error?.statusCode) || 500;
        return res
          .status(status)
          .json({ error: error?.message || "Internal error" });
      }
    });
  }

  chatRoute("/party-chat/history", async (req, res, user) => {
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

  chatRoute("/party-chat/send", async (req, res, user) => {
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

  chatRoute("/party-chat/react", async (req, res, user) => {
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

  chatRoute("/party-chat/read", async (req, res, user) => {
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
