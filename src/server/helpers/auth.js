const {
  DEFAULT_CHARACTER,
  defaultCharacterList,
} = require("../../lib/characterStats");
const { createAuthSessionService } = require("../services/authSessionService");
const { randomString } = require("./utils");
const { setBanHoldCookies } = require("./banHold");

const ADMIN_TOKENS = (process.env.ADMIN_USERS || "nishay")
  .split(",")
  .map((token) => token.trim())
  .filter(Boolean);

function isGuest(userRow) {
  return userRow?.expires_at !== null && userRow?.expires_at !== undefined;
}

function makeAuthHelpers(db, cookieOpts) {
  const { SIGNED_COOKIE_OPTS, DISPLAY_COOKIE_OPTS } = cookieOpts;
  const sessions = createAuthSessionService({ db, cookieOptions: SIGNED_COOKIE_OPTS });

  async function createGuestAndSetCookies(res) {
    const guestName = `Guest${randomString(6, true)}`;
    const expiresAtMs = Date.now() + 2 * 60 * 60 * 1000;
    const charLevelsJson = JSON.stringify(defaultCharacterList());

    const result = await db.runQuery(
      "INSERT INTO users (name, char_class, status, expires_at, char_levels) VALUES (?, ?, ?, ?, ?)",
      [
        guestName,
        DEFAULT_CHARACTER,
        "online",
        new Date(expiresAtMs),
        charLevelsJson,
      ],
    );
    const userId = result.insertId;
    const rows = await db.runQuery(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [userId],
    );
    const user = rows[0];

    await sessions.create(user, res);
    res.cookie("display_name", user.name, {
      ...DISPLAY_COOKIE_OPTS,
      expires: new Date(expiresAtMs),
    });

    console.log(`[auth] Guest ${guestName} created with ID ${userId}`);
    return user;
  }

  async function getOrCreateCurrentUser(req, res, { autoCreate = true } = {}) {
    const user = await requireCurrentUser(req, res);
    if (user || req.authBanned) return [user || req.authBanned, "existing"];
    if (!autoCreate) return null;
    return [await createGuestAndSetCookies(res), "new"];
  }

  async function requireCurrentUser(req, res) {
    if (Object.prototype.hasOwnProperty.call(req || {}, "abuseResolvedUser")) {
      const cachedUser = req.abuseResolvedUser || null;
      if (cachedUser && Number(cachedUser.is_banned || 0) === 1) {
        req.authBanned = cachedUser;
        setBanHoldCookies({
          req,
          res,
          reason: String(
            cachedUser?.ban_reason || "Your account has been banned.",
          ),
        });
        try {
          res.clearCookie("user_id", SIGNED_COOKIE_OPTS);
          res.clearCookie("display_name", DISPLAY_COOKIE_OPTS);
        } catch (_) {}
        return null;
      }
      return cachedUser;
    }

    const user = await sessions.resolve(req.signedCookies?.user_id);
    if (user && Number(user.is_banned || 0) === 1) {
      req.authBanned = user;
      setBanHoldCookies({
        req,
        res,
        reason: String(user?.ban_reason || "Your account has been banned."),
      });
      try {
        res.clearCookie("user_id", SIGNED_COOKIE_OPTS);
        res.clearCookie("display_name", DISPLAY_COOKIE_OPTS);
      } catch (_) {}
      return null;
    }
    return user;
  }

  function isAdminUser(user) {
    if (!user || !ADMIN_TOKENS.length) return false;
    const id = String(user.user_id || "");
    const name = String(user.name || "").toLowerCase();
    return ADMIN_TOKENS.some((token) => {
      const trimmed = token.trim();
      if (!trimmed) return false;
      if (/^[0-9]+$/.test(trimmed)) return trimmed === id;
      return trimmed.toLowerCase() === name;
    });
  }

  async function requireAdminUser(req, res) {
    const user = await requireCurrentUser(req, res);
    if (!user || !isAdminUser(user)) return null;
    return user;
  }

  return {
    sessions,
    createGuestAndSetCookies,
    getOrCreateCurrentUser,
    requireCurrentUser,
    requireAdminUser,
    isGuest,
    isAdminUser,
  };
}

module.exports = { makeAuthHelpers, isGuest };
