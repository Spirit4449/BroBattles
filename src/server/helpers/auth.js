const {
  DEFAULT_CHARACTER,
  defaultCharacterList,
} = require("../../lib/characterStats");
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

    res.cookie("user_id", String(userId), {
      ...SIGNED_COOKIE_OPTS,
      maxAge: 1000 * 60 * 60 * 24 * 30,
    });
    res.cookie("display_name", user.name, {
      ...DISPLAY_COOKIE_OPTS,
      expires: new Date(expiresAtMs),
    });

    console.log(`[auth] Guest ${guestName} created with ID ${userId}`);
    return user;
  }

  async function getOrCreateCurrentUser(req, res, { autoCreate = true } = {}) {
    const id = req.signedCookies?.user_id;
    if (id) {
      const rows = await db.runQuery(
        "SELECT * FROM users WHERE user_id = ? LIMIT 1",
        [id],
      );
      if (rows.length > 0) return [rows[0], "existing"];
    }
    if (!autoCreate) return null;
    return [await createGuestAndSetCookies(res), "new"];
  }

  async function requireCurrentUser(req, res) {
    if (Object.prototype.hasOwnProperty.call(req || {}, "abuseResolvedUser")) {
      const cachedUser = req.abuseResolvedUser || null;
      if (cachedUser && Number(cachedUser.is_banned || 0) === 1) {
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

    const id = req.signedCookies?.user_id;
    if (!id) {
      console.warn("[auth] requireCurrentUser missing signed user_id cookie", {
        method: req?.method,
        path: req?.originalUrl || req?.url,
        host: req?.headers?.host,
        origin: req?.headers?.origin || null,
        referer: req?.headers?.referer || null,
        cookieHeaderPresent: !!req?.headers?.cookie,
        forwardedProto: req?.headers?.["x-forwarded-proto"] || null,
      });
      return null;
    }
    const rows = await db.runQuery(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [id],
    );
    if (!rows[0]) {
      console.warn(
        "[auth] requireCurrentUser cookie did not resolve to a user",
        {
          method: req?.method,
          path: req?.originalUrl || req?.url,
          host: req?.headers?.host,
          userId: Number(id),
        },
      );
    }
    const user = rows[0] || null;
    if (user && Number(user.is_banned || 0) === 1) {
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
    createGuestAndSetCookies,
    getOrCreateCurrentUser,
    requireCurrentUser,
    requireAdminUser,
    isGuest,
    isAdminUser,
  };
}

module.exports = { makeAuthHelpers, isGuest };
