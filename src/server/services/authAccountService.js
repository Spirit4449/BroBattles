const bcrypt = require("bcrypt");
const { getBanHoldFromRequest } = require("../helpers/banHold");

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,14}$/;
const MIN_PW = 6;
const MAX_PW = 32;

function validateCredentials(usernameRaw, passwordRaw) {
  const username = typeof usernameRaw === "string" ? usernameRaw.trim() : "";
  const password = typeof passwordRaw === "string" ? passwordRaw : "";

  if (!username || !password) {
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Username and password are required." },
    };
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

async function completeSignupFromGuest({
  app,
  db,
  requireCurrentUser,
  req,
  res,
}) {
  const hold = getBanHoldFromRequest(req);
  if (hold) {
    return {
      ok: false,
      statusCode: 403,
      payload: {
        success: false,
        error: "This browser is temporarily blocked from creating accounts.",
        banned: true,
        reason: hold.reason,
        redirect: "/banned",
      },
    };
  }

  const validated = validateCredentials(req.body?.username, req.body?.password);
  if (!validated.ok) return validated;

  const user = await requireCurrentUser(req, res);
  if (!user) {
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Guest session not found." },
    };
  }
  if (user.expires_at === null) {
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "This account is already permanent." },
    };
  }

  const rounds = Number(process.env.BCRYPT_ROUNDS) || 12;
  const hash = await bcrypt.hash(validated.password, rounds);

  try {
    const result = await db.runQuery(
      `UPDATE users
         SET name = ?, password = ?, expires_at = NULL
       WHERE user_id = ?`,
      [validated.username, hash, user.user_id],
    );
    if (!result || result.affectedRows !== 1) {
      return {
        ok: false,
        statusCode: 409,
        payload: {
          success: false,
          error: "Unable to complete signup. Please try again.",
        },
      };
    }
  } catch (err) {
    if (err && (err.code === "ER_DUP_ENTRY" || err.errno === 1062)) {
      return {
        ok: false,
        statusCode: 409,
        payload: { success: false, error: "Username is already taken." },
      };
    }
    throw err;
  }

  res.cookie(
    "display_name",
    validated.username,
    app.locals?.DISPLAY_COOKIE_OPTS || {},
  );

  return {
    ok: true,
    statusCode: 201,
    payload: { success: true, username: validated.username },
  };
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
    return {
      ok: false,
      statusCode: 400,
      payload: { success: false, error: "Username and password are required." },
    };
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
    return {
      ok: false,
      statusCode: 401,
      payload: { success: false, error: "Invalid username or password." },
    };
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
    return {
      ok: false,
      statusCode: 401,
      payload: { success: false, error: "Invalid username or password." },
    };
  }

  return {
    ok: true,
    statusCode: 200,
    payload: { success: true, userId: user.user_id, username: user.name },
    user,
  };
}

module.exports = {
  validateCredentials,
  completeSignupFromGuest,
  loginPermanentUser,
};
