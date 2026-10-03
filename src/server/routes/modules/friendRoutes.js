function registerFriendRoutes({ app, requireCurrentUser, friendService, abuseControl }) {
  function sendError(res, error) {
    const status = Number(error?.statusCode) || 500;
    if (status >= 500) console.warn("[friends] route failed:", error?.message);
    return res.status(status).json({
      error: status >= 500 ? "Something went wrong. Please try again." : error?.message,
      cooldownUntilMs: Number(error?.cooldownUntilMs) || null,
    });
  }

  // Shares the chat rate limiter so requests and DMs cannot be used to spam.
  async function guard(res, user, actionType, source) {
    if (!abuseControl) return true;
    const result = await abuseControl.guardChatAction({ userId: Number(user.user_id) || 0, actionType, source });
    if (result?.allowed) return true;
    res.status(result?.type === "ban" ? 403 : 429).json({
      success: false,
      // Keep ban/suspension notices; soften generic rate-limit wording.
      error: result?.type === "ban" || /suspended/i.test(result?.message || "")
        ? result.message
        : "Slow down a little and try again.",
      type: result?.type || "chat_limited",
      suspendedUntilMs: Number(result?.suspendedUntilMs || 0) || null,
    });
    return false;
  }

  function route(method, path, handler) {
    app[method](path, async (req, res) => {
      try {
        const user = await requireCurrentUser(req, res);
        if (!user) return res.status(401).json({ error: "Please sign in to use friends." });
        const result = await handler(user, req, res);
        if (!res.headersSent) res.json({ success: true, ...result });
      } catch (error) {
        sendError(res, error);
      }
    });
  }

  route("get", "/friends", (user) => friendService.getOverview(user));

  route("get", "/friends/suggestions", async (user) => ({
    suggestions: await friendService.getSuggestions(user),
  }));

  route("get", "/friends/relationship", async (user, req) => ({
    relationship: await friendService.getRelationship(user, Number(req.query?.userId)),
  }));

  route("post", "/friends/request", async (user, req, res) => {
    if (!(await guard(res, user, "reaction", "POST /friends/request"))) return;
    const { userId, username, friendCode, query } = req.body || {};
    return friendService.sendRequest(user, { userId, username, friendCode, query });
  });

  route("post", "/friends/respond", (user, req) =>
    friendService.respondToRequest(user, Number(req.body?.requestId), !!req.body?.accept));

  route("post", "/friends/cancel", (user, req) =>
    friendService.cancelRequest(user, Number(req.body?.requestId)));

  route("post", "/friends/remove", (user, req) =>
    friendService.removeFriend(user, Number(req.body?.friendId)));

  route("post", "/friends/messages/history", (user, req) =>
    friendService.getConversation(user, Number(req.body?.friendId), {
      beforeMessageId: req.body?.beforeMessageId,
      limit: req.body?.limit,
    }));

  route("post", "/friends/messages/send", async (user, req, res) => {
    if (!(await guard(res, user, "message", "POST /friends/messages/send"))) return;
    return { message: await friendService.sendMessage(user, Number(req.body?.friendId), req.body?.body) };
  });

  route("post", "/friends/messages/react", async (user, req, res) => {
    if (!(await guard(res, user, "reaction", "POST /friends/messages/react"))) return;
    return { message: await friendService.reactToMessage(user, Number(req.body?.messageId), req.body?.reaction) };
  });

  route("post", "/friends/messages/read", (user, req) =>
    friendService.markRead(user, Number(req.body?.friendId)));

  // Invites have their own escalating per-friend cooldown in partyInviteStore.
  route("post", "/friends/party-invite", (user, req) =>
    friendService.sendPartyInvite(user, Number(req.body?.friendId)));
}

module.exports = { registerFriendRoutes };
