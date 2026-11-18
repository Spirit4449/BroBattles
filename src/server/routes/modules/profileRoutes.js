const { API_PATHS } = require("../../../shared/net/apiPaths.js");
const { authedRoute } = require("../http");
const { httpError } = require("../../services/httpError");

function mapRenameError(error) {
  if (error?.code === "ER_DUP_ENTRY" || error?.errno === 1062) {
    return httpError(409, "Username is already taken.");
  }
  return error;
}

const { getConfig } = require("../../config");

const bcrypt = require("bcrypt");
const { NAME_CHANGE_COST, changeUsername } = require("../../services/auth/accountNameService");
const { getProfileBattles, buildProfileViewForUser, findProfileIdByName, findProfileByName } = require("../../services/profile/profileViewService");

const { USERNAME_RE, MIN_PW, MAX_PW, verifiedPasswordHash } = require("../../services/auth/authAccountService");
const { isReservedAdminName } = require("../../services/auth/auth");

function registerProfileRoutes({ app, db, requireCurrentUser }) {
  app.get(API_PATHS.PROFILE_DATA, authedRoute(requireCurrentUser, "[profile] /profile/data", async (req, res, user) => {
    const profile = await buildProfileViewForUser(db, user);

    return res.json({
      success: true,
      profile,
    });
  }));

  app.get(API_PATHS.PROFILE_VIEW, authedRoute(requireCurrentUser, "[profile] /profile/view", async (req, res) => {
    const username = String(req.query?.username || "").trim();
    if (!username) {
      return res
        .status(400)
        .json({ success: false, error: "Username is required." });
    }
    const target = await findProfileByName(db, username);
    if (!target) {
      return res
        .status(404)
        .json({ success: false, error: "Player not found." });
    }
    const profile = await buildProfileViewForUser(db, target, { publicView: true });
    return res.json({ success: true, profile });
  }));

  app.get(API_PATHS.PROFILE_BATTLES, authedRoute(requireCurrentUser, "[profile] /profile/battles", async (req, res, viewer) => {
    let targetUserId = viewer.user_id;
    const username = String(req.query?.username || "").trim();
    if (username) {
      targetUserId = await findProfileIdByName(db, username);
      if (!targetUserId) {
        return res
          .status(404)
          .json({ success: false, error: "Player not found." });
      }
    }

    const limit = Math.min(20, Math.max(1, Number(req.query?.limit) || 10));
    const battles = await getProfileBattles(db, targetUserId, limit);

    return res.json({
      success: true,
      battles,
    });
  }));

  app.post(API_PATHS.PROFILE_CHANGE_USERNAME, authedRoute(requireCurrentUser, "[profile] /profile/change-username", async (req, res, user) => {
    if (user.expires_at) {
      return res.status(403).json({
        success: false,
        error: "Sign up or log in to change your name.",
      });
    }

    const next = String(req.body?.username || "").trim();
    if (!USERNAME_RE.test(next)) {
      return res.status(400).json({
        success: false,
        error: "Username must be 3-14 chars: letters, numbers, _ . - only.",
      });
    }
    if (isReservedAdminName(next)) {
      return res
        .status(409)
        .json({ success: false, error: "Username is already taken." });
    }

    const result = await changeUsername(db, user.user_id, next);
    if (result.error) {
      const { status, ...payload } = result;
      return res.status(status).json({ success: false, ...payload });
    }

    res.cookie(
      "display_name",
      next,
      req.app.locals?.DISPLAY_COOKIE_OPTS || {},
    );
    return res.json(result);
  }, { mapError: mapRenameError }));

  app.post(API_PATHS.PROFILE_CHANGE_PASSWORD, authedRoute(requireCurrentUser, "[profile] /profile/change-password", async (req, res, user) => {
    if (user.expires_at) {
      return res.status(403).json({
        success: false,
        error: "Sign up or log in to change your password.",
      });
    }

    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword || !newPassword) {
      return res
        .status(400)
        .json({ success: false, error: "Both passwords are required." });
    }
    if (newPassword.length < MIN_PW || newPassword.length > MAX_PW) {
      return res.status(400).json({
        success: false,
        error: `Password must be ${MIN_PW}-${MAX_PW} characters.`,
      });
    }

    const existingHash = await verifiedPasswordHash(db, user.user_id, currentPassword);
    if (!existingHash) {
      return res
        .status(401)
        .json({ success: false, error: "Current password is incorrect." });
    }

    const rounds = getConfig().bcryptRounds;
    const nextHash = await bcrypt.hash(newPassword, rounds);
    await app.locals.authSessions.changePassword(user.user_id, existingHash, nextHash);
    await app.locals.authSessions.create({ ...user, password: nextHash }, res);

    return res.json({ success: true });
  }));
}

module.exports = { registerProfileRoutes, NAME_CHANGE_COST };
