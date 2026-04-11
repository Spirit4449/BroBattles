function registerChatRoutes({ app, requireCurrentUser, chatService }) {
  app.post("/party-chat/history", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const partyId = Number(req.body?.partyId);
      if (!Number.isFinite(partyId) || partyId <= 0) {
        return res.status(400).json({ error: "partyId is required" });
      }
      const result = await chatService.getPartyChatHistory({
        partyId,
        user,
        limit: req.body?.limit,
        beforeMessageId: req.body?.beforeMessageId,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      return res
        .status(status)
        .json({ error: error?.message || "Internal error" });
    }
  });

  app.post("/party-chat/send", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const partyId = Number(req.body?.partyId);
      if (!Number.isFinite(partyId) || partyId <= 0) {
        return res.status(400).json({ error: "partyId is required" });
      }
      const message = await chatService.sendPartyChatMessage({
        partyId,
        user,
        body: req.body?.body,
        replyToMessageId: req.body?.replyToMessageId,
      });
      return res.json({ success: true, message });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      return res
        .status(status)
        .json({ error: error?.message || "Internal error" });
    }
  });

  app.post("/party-chat/react", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const partyId = Number(req.body?.partyId);
      const messageId = Number(req.body?.messageId);
      if (
        !Number.isFinite(partyId) ||
        partyId <= 0 ||
        !Number.isFinite(messageId) ||
        messageId <= 0
      ) {
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
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      return res
        .status(status)
        .json({ error: error?.message || "Internal error" });
    }
  });

  app.post("/party-chat/read", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const partyId = Number(req.body?.partyId);
      if (!Number.isFinite(partyId) || partyId <= 0) {
        return res.status(400).json({ error: "partyId is required" });
      }
      const result = await chatService.markPartyChatRead({
        partyId,
        user,
        lastMessageId: req.body?.lastMessageId,
      });
      return res.json({ success: true, ...result });
    } catch (error) {
      const status = Number(error?.statusCode) || 500;
      return res
        .status(status)
        .json({ error: error?.message || "Internal error" });
    }
  });
}

module.exports = { registerChatRoutes };
