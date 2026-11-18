const { USERNAME_RE, MIN_PW, MAX_PW, validateCredentials } = require("./credentials");
const { isAccountBanned } = require("../../../shared/moderation/accountBan");
const bcrypt = require("bcrypt");
const { failure } = require("../serviceResult");
const { beginSignup } = require("./signupVerificationService");

async function completeSignupFromGuest(context) {
  return beginSignup(context);
}

async function loginPermanentUser({ app, db, req }) {
  const username =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return failure(400, { success: false, error: "Username and password are required." });
  }

  const rows = await db.runQuery(
    "SELECT user_id, name, password, is_banned, ban_expires_at, ban_reason FROM users WHERE name = ? AND expires_at IS NULL LIMIT 1",
    [username],
  );
  if (rows.length === 0) {
    return failure(401, { success: false, error: "Invalid username or password." });
  }

  const user = rows[0];
  // Verify the password before revealing ban status or reason.
  const ok = await bcrypt.compare(password, user.password || "");
  if (!ok) {
    return failure(401, { success: false, error: "Invalid username or password." });
  }
  if (isAccountBanned(user)) {
    return {
      ok: true,
      statusCode: 200,
      user,
      payload: {
        success: true,
        username: user.name,
        banned: true,
        userId: user.user_id,
        banExpiresAt: user.ban_expires_at,
        reason: String(user?.ban_reason || "Your account has been banned."),
        redirect: "/banned",
      },
    };
  }

  return {
    ok: true,
    statusCode: 200,
    payload: { success: true, userId: user.user_id, username: user.name },
    user,
  };
}

async function verifiedPasswordHash(db, userId, currentPassword) {
  const [user] = await db.runQuery("SELECT password FROM users WHERE user_id = ? LIMIT 1", [userId]);
  const hash = user?.password || "";
  return await bcrypt.compare(currentPassword, hash) ? hash : null;
}

module.exports = {
  verifiedPasswordHash,
  USERNAME_RE,
  MIN_PW,
  MAX_PW,
  validateCredentials,
  completeSignupFromGuest,
  loginPermanentUser,
};
