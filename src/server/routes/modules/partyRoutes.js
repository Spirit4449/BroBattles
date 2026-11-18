const { presentJoinedParty, notifyKickedMember } = require("../../services/party/partyMembershipNotifications");
const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { authedRoute } = require("../http");
const { httpError } = require("../../services/httpError");

const partyErrors = { shape: "bare", fallback: "Internal error" };

const { createPartyStateService } = require("../../services/party/partyStateService");
const { createPartyRouteService } = require("../../services/party/partyRouteService");

function registerPartyRoutes({ app, io, db, requireCurrentUser }) {
  const partyState = createPartyStateService({ db, io });
  const partyRoute = createPartyRouteService({ db });

  app.post(API_PATHS.CREATE_PARTY, authedRoute(requireCurrentUser, "[party] /create-party", async (req, res, user) => {
    const username = user.name;

    const partyId = await partyState.createPartyForUser(
      username,
      req.body?.selection,
    );

    res.status(201).json({ partyId });
  }, {
    shape: "bare",
    fallback: "Failed to create party",
    mapError: (error) => error?.code === "ER_DUP_ENTRY" ? httpError(409, "Duplicate membership") : error,
  }));

  app.post(API_PATHS.PARTYDATA, authedRoute(requireCurrentUser, "[party] /partydata", async (req, res, user) => {
    const username = user.name;
    const partyIdRaw = req.body?.partyId;
    const partyId = Number(partyIdRaw);
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }
    const result = await partyState.joinPartyAndGetData({
      partyId,
      username,
      userId: user.user_id,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 500).json(result.payload || {});
    }

    return res.json(await presentJoinedParty({ db, io, socketApi: req.app.locals.socketApi, partyId, username, userId: user.user_id, result }));
  }, partyErrors));

  app.post(API_PATHS.PARTY_MEMBERS, authedRoute(requireCurrentUser, "[party] /party-members", async (req, res, user) => {
    const result = await partyRoute.getPartyMembersView({
      username: user.name,
      partyId: req.body?.partyId,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.payload || {});
    }
    return res.json(result.payload);
  }, partyErrors));

  app.post(API_PATHS.LEAVE_PARTY, authedRoute(requireCurrentUser, "[party] /leave-party", async (req, res, user) => {
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
    res.json({ success: true, left: true, deleted: leaveResult.deleted });
  }, partyErrors));

  app.post(API_PATHS.PARTY_KICK, authedRoute(requireCurrentUser, "[party] /party/kick", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    const targetName = String(req.body?.targetName || "").trim();
    if (!Number.isFinite(partyId) || partyId <= 0 || !targetName) {
      return res
        .status(400)
        .json({ error: "partyId and targetName are required" });
    }
    const result = await partyState.kickMember({
      partyId,
      actorName: user.name,
      targetName,
    });
    if (!result.ok) {
      return res
        .status(403)
        .json({ error: result.error || "Unable to kick member" });
    }
    await notifyKickedMember({ db, io, socketApi: req.app.locals.socketApi, partyId, actorName: user.name, targetName });
    return res.json({ success: true });
  }, partyErrors));

  app.post(API_PATHS.PARTY_MAKE_OWNER, authedRoute(requireCurrentUser, "[party] /party/make-owner", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    const targetName = String(req.body?.targetName || "").trim();
    if (!Number.isFinite(partyId) || partyId <= 0 || !targetName) {
      return res
        .status(400)
        .json({ error: "partyId and targetName are required" });
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
  }, partyErrors));

  app.post(API_PATHS.PARTY_SETTINGS, authedRoute(requireCurrentUser, "[party] /party/settings", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }

    const result = await partyRoute.getPartySettingsView({
      username: user.name,
      partyId,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.payload || {});
    }
    return res.json(result.payload);
  }, partyErrors));

  app.post(API_PATHS.PARTY_SETTINGS_UPDATE, authedRoute(requireCurrentUser, "[party] /party/settings/update", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    const isPublic = req.body?.isPublic === true;
    const publicName = String(req.body?.publicName || "").trim();
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }

    const result = await partyState.setPartyVisibility({
      partyId,
      actorName: user.name,
      isPublic,
      publicName,
      allowMemberSelection: req.body?.allowMemberSelection,
      hideEnemyBros: req.body?.hideEnemyBros,
    });
    if (!result.ok) {
      const statusCode = Number(result.statusCode) || 403;
      return res.status(statusCode).json({
        error: result.error || "Unable to update party settings",
      });
    }
    return res.json({
      success: true,
      settings: result.settings,
    });
  }, partyErrors));

  app.post(API_PATHS.PARTY_DISCOVER, authedRoute(requireCurrentUser, "[party] /party/discover", async (req, res, user) => {
    const query = String(req.body?.query || "").trim();
    const result = await partyRoute.discoverPublicParties({
      query,
      requesterName: user.name,
      requesterTrophies: user.trophies,
      limit: 30,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.payload || {});
    }
    return res.json(result.payload);
  }, partyErrors));

  app.post(API_PATHS.PARTY_JOIN_REQUESTS, authedRoute(requireCurrentUser, "[party] /party/join-requests", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }

    const result = await partyState.getPendingJoinRequests({
      partyId,
      actorName: user.name,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.payload || {});
    }
    return res.json(result.payload);
  }, partyErrors));

  app.post(API_PATHS.PARTY_JOIN_REQUEST, authedRoute(requireCurrentUser, "[party] /party/join-request", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }

    const result = await partyState.submitJoinRequest({
      partyId,
      requesterUserId: user.user_id,
      requesterName: user.name,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.payload || {});
    }
    return res.json(result.payload);
  }, partyErrors));

  app.post(API_PATHS.PARTY_JOIN_REQUEST_RESPOND, authedRoute(requireCurrentUser, "[party] /party/join-request/respond", async (req, res, user) => {
    const partyId = Number(req.body?.partyId);
    const requestId = Number(req.body?.requestId);
    const response = String(req.body?.response || "")
      .trim()
      .toLowerCase();
    if (!Number.isFinite(partyId) || partyId <= 0) {
      return res.status(400).json({ error: "partyId is required" });
    }
    if (!Number.isFinite(requestId) || requestId <= 0) {
      return res.status(400).json({ error: "requestId is required" });
    }
    if (!response) {
      return res.status(400).json({ error: "response is required" });
    }

    const result = await partyState.respondToJoinRequest({
      partyId,
      actorName: user.name,
      requestId,
      response,
    });
    if (!result.ok) {
      return res.status(result.statusCode || 400).json(result.payload || {});
    }
    return res.json(result.payload);
  }, partyErrors));
}

module.exports = { registerPartyRoutes };
