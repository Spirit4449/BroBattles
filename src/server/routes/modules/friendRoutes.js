const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { authedRoute } = require("../http");

function registerFriendRoutes({ app, requireCurrentUser, friendService, abuseControl }) {
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
    app[method](path, authedRoute(requireCurrentUser, `[friends] ${path}`, async (req, res, user) => {
      const result = await handler(user, req, res);
      if (!res.headersSent) res.json({ success: true, ...result });
    }, {
      shape: "bare",
      fallback: "Something went wrong. Please try again.",
      authMessage: "Please sign in to use friends.",
      extra: (error) => ({
        cooldownUntilMs: Number(error?.details?.cooldownUntilMs ?? error?.cooldownUntilMs) || null,
      }),
    }));
  }

  route("get", API_PATHS.FRIENDS, (user) => friendService.getOverview(user));

  route("get", API_PATHS.FRIENDS_SUGGESTIONS, async (user) => ({
    suggestions: await friendService.getSuggestions(user),
  }));

  route("get", API_PATHS.FRIENDS_RELATIONSHIP, async (user, req) => ({
    relationship: await friendService.getRelationship(user, Number(req.query?.userId)),
  }));

  route("get", API_PATHS.FRIENDS_PRIVACY, (user) => friendService.getPrivacySettings(user));

  route("post", API_PATHS.FRIENDS_PRIVACY, (user, req) => friendService.updatePrivacy(user, req.body?.privacy));

  route("post", API_PATHS.FRIENDS_REQUEST, async (user, req, res) => {
    if (!(await guard(res, user, "reaction", "POST /friends/request"))) return;
    const { userId, username, friendCode, query } = req.body || {};
    return friendService.sendRequest(user, { userId, username, friendCode, query });
  });

  route("post", API_PATHS.FRIENDS_RESPOND, (user, req) =>
    friendService.respondToRequest(user, Number(req.body?.requestId), !!req.body?.accept));

  route("post", API_PATHS.FRIENDS_CANCEL, (user, req) =>
    friendService.cancelRequest(user, Number(req.body?.requestId)));

  route("post", API_PATHS.FRIENDS_REMOVE, (user, req) =>
    friendService.removeFriend(user, Number(req.body?.friendId)));

  route("post", API_PATHS.FRIENDS_MESSAGES_HISTORY, (user, req) =>
    friendService.getConversation(user, Number(req.body?.friendId), {
      beforeMessageId: req.body?.beforeMessageId,
      limit: req.body?.limit,
    }));

  route("post", API_PATHS.FRIENDS_MESSAGES_SEND, async (user, req, res) => {
    if (!(await guard(res, user, "message", "POST /friends/messages/send"))) return;
    return { message: await friendService.sendMessage(user, Number(req.body?.friendId), req.body?.body) };
  });

  route("post", API_PATHS.FRIENDS_MESSAGES_REACT, async (user, req, res) => {
    if (!(await guard(res, user, "reaction", "POST /friends/messages/react"))) return;
    return { message: await friendService.reactToMessage(user, Number(req.body?.messageId), req.body?.reaction) };
  });

  route("post", API_PATHS.FRIENDS_MESSAGES_READ, (user, req) =>
    friendService.markRead(user, Number(req.body?.friendId)));

  // Invites have their own escalating per-friend cooldown in partyInviteStore.
  route("post", API_PATHS.FRIENDS_PARTY_INVITE, (user, req) =>
    friendService.sendPartyInvite(user, Number(req.body?.friendId)));
}

module.exports = { registerFriendRoutes };
