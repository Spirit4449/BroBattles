const { USERNAME_PATTERN: USERNAME_RE, USERNAME_MIN, USERNAME_MAX, PASSWORD_MIN: MIN_PW, PASSWORD_MAX: MAX_PW } = require("../../../shared/social/textRules.js");
const { failure } = require("../serviceResult");
const { isReservedAdminName } = require("./auth");

// Account credential rules (signup, login, and profile edits all use these).

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
        error: `Username must be ${USERNAME_MIN}-${USERNAME_MAX} chars: letters, numbers, _ . - only.`,
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

module.exports = { USERNAME_RE, MIN_PW, MAX_PW, validateCredentials };
