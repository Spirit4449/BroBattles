const bcrypt = require("bcrypt");
const { getBanHoldFromRequest } = require("./banHold");
const { failure } = require("../serviceResult");
const { isReservedAdminName } = require("./auth");

// Account credential rules (signup, login, and profile edits all use these).
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,14}$/; // 3-14 chars: letters, digits, _ . -
const MIN_PW = 6; // shortest allowed password
const MAX_PW = 32; // longest allowed password

function validateCredentials(usernameRaw, passwordRaw) {
  const username = typeof usernameRaw === "string" ? usernameRaw.trim() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";

  if (!username || !password) {
    return failure(400, { success: false, error: "Username and password are required." });
  }
  if (!USERNAME_RE.test(username)) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        success: false,
        error: "Username must be 3-14 chars: letters, numbers, _ . - only.",
      },
    };
  }
  if (isReservedAdminName(username)) {
    return failure(409, { success: false, error: "Username is already taken." });
  }
  if (password.length < MIN_PW || password.length > MAX_PW) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        success: false,
        error: `Password must be ${MIN_PW}-${MAX_PW} characters.`,
      },
    };
  }
  return { ok: true, username, password };
}

async function completeSignupFromGuest(context) {
  return require('./signupVerificationService').beginSignup(context);
}

async function loginPermanentUser({ app, db, req }) {
  const hold = getBanHoldFromRequest(req);
  if (hold) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        success: false,
        error: "This browser is temporarily blocked.",
        banned: true,
        reason: hold.reason,
        redirect: "/banned",
      },
    };
  }

  const username =
    typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password =
    typeof req.body?.password === "string" ? req.body.password : "";

  if (!username || !password) {
    return failure(400, { success: false, error: "Username and password are required." });
  }

  let rows = [];
  try {
    rows = await db.runQuery(
      "SELECT user_id, name, password, is_banned, ban_reason FROM users WHERE name = ? AND expires_at IS NULL LIMIT 1",
      [username],
    );
  } catch (error) {
    if (error?.code === "ER_BAD_FIELD_ERROR") {
      rows = await db.runQuery(
        "SELECT user_id, name, password FROM users WHERE name = ? AND expires_at IS NULL LIMIT 1",
        [username],
      );
    } else {
      throw error;
    }
  }
  if (rows.length === 0) {
    return failure(401, { success: false, error: "Invalid username or password." });
  }

  const user = rows[0];
  if (Number(user?.is_banned || 0) === 1) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        success: false,
        error: String(user?.ban_reason || "Your account has been banned."),
        banned: true,
        reason: String(user?.ban_reason || "Your account has been banned."),
        redirect: "/banned",
      },
    };
  }
  const ok = await bcrypt.compare(password, user.password || "");
  if (!ok) {
    return failure(401, { success: false, error: "Invalid username or password." });
  }

  return {
    ok: true,
    statusCode: 200,
    payload: { success: true, userId: user.user_id, username: user.name },
    user,
  };
}

module.exports = {
  USERNAME_RE,
  MIN_PW,
  MAX_PW,
  validateCredentials,
  completeSignupFromGuest,
  loginPermanentUser,
};
