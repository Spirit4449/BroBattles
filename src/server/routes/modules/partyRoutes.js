const { emitRoster } = require("../../helpers/party");
const { createPartyStateService } = require("../../services/partyStateService");
const { createPartyRouteService } = require("../../services/partyRouteService");
const { normalizeSelectionFromRow } = require("../../helpers/gameSelectionCatalog");

function registerPartyRoutes({ app, io, db, requireCurrentUser }) {
  const partyState = createPartyStateService({ db, io });
  const partyRoute = createPartyRouteService({ db });

  app.post("/create-party", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const username = user.name;

      const partyId = await partyState.createPartyForUser(username);

      console.log(`[party] Party ${partyId} created by ${username}`);
      res.status(201).json({ partyId });
    } catch (err) {
      console.error(`[party] Failed to create party:`, err.message);
      if (err?.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "Duplicate membership" });
      res.status(500).json({ error: "Failed to create party" });
    }
  });

  app.post("/partydata", async (req, res) => {
    const user = await requireCurrentUser(req, res);
    if (!user) return res.status(401).json({ error: "Not authenticated" });
    const username = user.name;
    const partyIdRaw = req.body?.partyId;
    const partyId = Number(partyIdRaw);
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }
    try {
      const result = await partyState.joinPartyAndGetData({
        partyId,
        username,
      });
      if (!result.ok) {
        return res.status(result.statusCode || 500).json(result.payload || {});
      }

      try {
        await db.setUserStatus(username, "online");
      } catch (_) {}

      let membersForEmit = result.members;
      try {
        membersForEmit = await db.fetchPartyMembersDetailed(partyId);
      } catch (_) {}

      await req.app.locals.socketApi.moveUserSocketToParty(username, partyId);
      if (result.joinedNow) {
        try {
          await req.app.locals.socketApi.cancelPartyQueue(
            partyId,
            user.user_id,
          );
        } catch (_) {}
      }
      await emitRoster(io, partyId, result.party, membersForEmit, db);
      const selection = normalizeSelectionFromRow(result.party || {});

      // Authoritative settings sync: ensure joiners adopt party mode/map.
      io.to(`party:${partyId}`).emit("mode-change", {
        partyId,
        selectedValue: selection.modeVariantId,
        mode: result.party?.mode,
        modeId: selection.modeId,
        modeVariantId: selection.modeVariantId,
        selection,
        username,
        members: membersForEmit,
      });
      io.to(`party:${partyId}`).emit("map-change", {
        partyId,
        selectedValue: selection.mapId,
        map: selection.mapId,
        modeId: selection.modeId,
        modeVariantId: selection.modeVariantId,
        selection,
        username,
      });

      res.json({
        party: result.party,
        selection,
        capacity: result.capacity,
        members: membersForEmit,
        ownerName: result.ownerName || null,
        viewer: username,
      });
    } catch (err) {
      console.error("[party] /partydata error", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/party-members", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const result = await partyRoute.getPartyMembersView({
        username: user.name,
        partyId: req.body?.partyId,
      });
      if (!result.ok) {
        return res.status(result.statusCode || 400).json(result.payload || {});
      }
      return res.json(result.payload);
    } catch (err) {
      console.error("[party] /party-members error", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/leave-party", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const username = user.name;
      const partyId = await partyRoute.resolveLeavePartyId({
        username,
        partyId: req.body?.partyId,
      });
      if (!partyId) {
        return res.json({ success: true, left: false, deleted: false });
      }
      const leaveResult = await partyState.leaveParty({ partyId, username });
      if (!leaveResult.left)
        return res.json({ success: true, left: false, deleted: false });
      await req.app.locals.socketApi.moveUserSocketToLobby(username);
      console.log(
        `[party] ${username} left party ${partyId}, party deleted: ${leaveResult.deleted}`,
      );
      res.json({ success: true, left: true, deleted: leaveResult.deleted });
    } catch (e) {
      console.error("/leave-party", e);
      res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/party/kick", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const partyId = Number(req.body?.partyId);
      const targetName = String(req.body?.targetName || "").trim();
      if (!Number.isFinite(partyId) || partyId <= 0 || !targetName) {
        return res.status(400).json({ error: "partyId and targetName are required" });
      }
      const result = await partyState.kickMember({
        partyId,
        actorName: user.name,
        targetName,
      });
      if (!result.ok) {
        return res.status(403).json({ error: result.error || "Unable to kick member" });
      }
      try {
        const rows = await db.runQuery(
          "SELECT socket_id FROM users WHERE name = ? LIMIT 1",
          [targetName],
        );
        const sid = rows?.[0]?.socket_id;
        const sock = sid ? io.sockets.sockets.get(sid) : null;
        if (sock) {
          sock.emit("party:kicked", {
            partyId,
            actorName: user.name,
          });
        }
      } catch (_) {}
      try {
        await req.app.locals.socketApi.moveUserSocketToLobby(targetName);
      } catch (_) {}
      return res.json({ success: true });
    } catch (error) {
      console.error("[party] /party/kick error", error);
      return res.status(500).json({ error: "Internal error" });
    }
  });

  app.post("/party/make-owner", async (req, res) => {
    try {
      const user = await requireCurrentUser(req, res);
      if (!user) return res.status(401).json({ error: "Not authenticated" });
      const partyId = Number(req.body?.partyId);
      const targetName = String(req.body?.targetName || "").trim();
      if (!Number.isFinite(partyId) || partyId <= 0 || !targetName) {
        return res.status(400).json({ error: "partyId and targetName are required" });
      }
      const result = await partyState.makeOwner({
        partyId,
        actorName: user.name,
        targetName,
      });
      if (!result.ok) {
        return res
          .status(403)
          .json({ error: result.error || "Unable to transfer ownership" });
      }
      return res.json({ success: true });
    } catch (error) {
      console.error("[party] /party/make-owner error", error);
      return res.status(500).json({ error: "Internal error" });
    }
  });
}

module.exports = { registerPartyRoutes };
