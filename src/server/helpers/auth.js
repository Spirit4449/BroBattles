const {
  DEFAULT_CHARACTER,
  defaultCharacterList,
} = require("../../lib/characterStats");
const { randomString } = require("./utils");

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
      ]
    );
    const userId = result.insertId;
    const rows = await db.runQuery(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [userId]
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
        [id]
      );
      if (rows.length > 0) return [rows[0], "existing"];
    }
    if (!autoCreate) return null;
    return [await createGuestAndSetCookies(res), "new"];
  }

  async function requireCurrentUser(req, res) {
    const id = req.signedCookies?.user_id;
    if (!id) return null;
    const rows = await db.runQuery(
      "SELECT * FROM users WHERE user_id = ? LIMIT 1",
      [id]
    );
    return rows[0] || null;
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
