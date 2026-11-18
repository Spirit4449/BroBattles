const { applyAdminRestriction } = require("../../services/moderation/accountRestrictionService");
const { adminGrant, recentAdminGrants } = require("../../services/economy/adminGrants");
const {
  searchPlayers,
  getPlayer,
  updatePlayer,
} = require("../../services/admin/playerManagementService");
const {
  API_PATHS,
  adminModerationPath,
  adminUserPath,
} = require("../../../shared/net/apiPaths.js");

const {
  updatePlayerInventory,
  setPlayerStreak,
} = require("../../services/admin/playerAdminService");

function registerAdminUsersRoutes({ app, db, io, requireAdminUser, sendUnauthorized }) {
  app.post(API_PATHS.API_ADMIN_USER_SEARCH, async (req, res) => {
    if (!(await requireAdminUser(req, res))) return sendUnauthorized(res);
    try {
      return res.json(await searchPlayers(db, req.body || {}));
    } catch (err) {
      console.error("[admin] search", err);
      return res.status(500).json({ success: false, error: "Unable to search players" });
    }
  });

  app.get(adminUserPath(), async (req, res) => {
    if (!(await requireAdminUser(req, res))) return sendUnauthorized(res);
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id <= 0)
      return res.status(400).json({ error: "Invalid player ID" });
    try {
      const detail = await getPlayer(db, id);
      if (!detail) return res.status(404).json({ error: "Player not found" });
      return res.json(detail);
    } catch (error) {
      console.error("[admin] detail", error);
      return res.status(500).json({ error: "Unable to load player" });
    }
  });

  for (const [action, update] of [
    ["inventory", (id, adminId, body) => updatePlayerInventory(db, id, adminId, body.changes)],
    ["streak", (id, adminId, body) => setPlayerStreak(db, id, adminId, body.streak)],
  ]) {
    app.post(adminUserPath(undefined, action), async (req, res) => {
      const admin = await requireAdminUser(req, res);
      if (!admin) return sendUnauthorized(res);
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id <= 0)
        return res.status(400).json({ error: "Invalid player ID" });
      try {
        return res.json({ success: true, ...(await update(id, admin.user_id, req.body || {})) });
      } catch (error) {
        console.error(`[admin] ${action}`, error);
        return res
          .status(error.status || 500)
          .json({ error: error.status ? error.message : `Unable to update player ${action}` });
      }
    });
  }

  function moderationRoute(action) {
    return async (req, res) => {
      const admin = await requireAdminUser(req, res);
      if (!admin) return sendUnauthorized(res);
      const userId = req.body?.userId;
      const reason = typeof req.body?.reason === "string" ? req.body.reason.trim() : "";
      if (!Number.isSafeInteger(userId) || userId <= 0)
        return res.status(400).json({ error: "Choose a valid player" });
      if (
        action !== "unban" &&
        (!reason || reason.length > 220 || /[\x00-\x1f\x7f]/.test(reason))
      ) {
        return res.status(400).json({ error: "Enter a reason of up to 220 characters" });
      }
      const durationMinutes = req.body?.durationMinutes;
      if (
        action === "suspend" &&
        (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 525600)
      ) {
        return res.status(400).json({ error: "Choose a suspension between 1 minute and 365 days" });
      }
      if (action !== "unban" && userId === Number(admin.user_id))
        return res.status(400).json({ error: "You cannot restrict your own account" });
      try {
        const user = await applyAdminRestriction({
          db,
          io,
          userId,
          action,
          reason,
          durationMinutes,
          adminUserId: admin.user_id,
        });
        if (!user) return res.status(404).json({ error: "Player not found" });
        console.log(`[admin] ${admin.user_id} ${action} player ${userId}`);
        return res.json({ success: true, user });
      } catch (error) {
        if (error.status === 409) return res.status(409).json({ error: error.message });
        console.error(`[admin] ${action}`, error);
        return res.status(500).json({ error: "Unable to update player restriction" });
      }
    };
  }
  app.post(adminModerationPath("ban"), moderationRoute("ban"));
  app.post(adminModerationPath("suspend"), moderationRoute("suspend"));
  app.post(adminModerationPath("unban"), moderationRoute("unban"));

  app.post(API_PATHS.API_ADMIN_USER_UPDATE, async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    const userId = Number(req.body?.userId);
    const changes = req.body?.changes;
    if (
      !Number.isSafeInteger(userId) ||
      userId <= 0 ||
      !changes ||
      typeof changes !== "object" ||
      Array.isArray(changes)
    )
      return res.status(400).json({ error: "Invalid update" });
    try {
      const user = await updatePlayer(db, userId, changes);
      if (!user) return res.status(404).json({ error: "Player not found" });
      console.log(
        `[admin] ${admin.user_id} updated player ${userId}: ${Object.keys(changes).join(", ")}`,
      );
      return res.json({ success: true, user });
    } catch (error) {
      if (error.status === 400) return res.status(400).json({ error: error.message });
      if (error.code === "ER_DUP_ENTRY")
        return res.status(409).json({ error: "That username is already in use" });
      console.error("[admin] update", error);
      return res.status(500).json({ error: "Unable to save player" });
    }
  });

  app.post(API_PATHS.API_ADMIN_GRANT, async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const users = await adminGrant(db, admin.user_id, req.body || {});
      console.log(
        `[admin] ${admin.user_id} granted currency to ${users.map((user) => user.user_id).join(", ")}`,
      );
      return res.json({ success: true, users });
    } catch (error) {
      if (error.status === 404 || error.status === 400)
        return res.status(error.status).json({ error: error.message });
      console.error("[admin] grant", error);
      return res.status(500).json({ error: "Unable to grant currency" });
    }
  });

  app.get(API_PATHS.API_ADMIN_GRANTS, async (req, res) => {
    if (!(await requireAdminUser(req, res))) return sendUnauthorized(res);
    try {
      return res.json({ success: true, grants: await recentAdminGrants(db) });
    } catch (error) {
      console.error("[admin] grants", error);
      return res.status(500).json({ error: "Grant history is unavailable" });
    }
  });
}

module.exports = { registerAdminUsersRoutes };
