const {
  PRIVACY_COLUMNS,
  SUGGESTION_WINDOW_DAYS,
  SUGGESTION_MIN_GAMES,
  FRIEND_VISIBLE_PRIVACY,
} = require("./friendRules");
const {
  PRIVACY_FIELDS,
  privacyFromRow,
  sanitizePrivacyUpdate,
} = require("../../../shared/social/privacy.cjs");
const { httpError } = require("../httpError");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");

function createFriendPrivacy({ db, assertRegistered, emitToUser, notifyChanged, areFriends }) {
  async function getPrivacy(userId, q = db.runQuery) {
    const rows = await q("SELECT * FROM user_privacy_settings WHERE user_id = ? LIMIT 1", [
      Number(userId),
    ]);
    return privacyFromRow(rows[0]);
  }

  // Name plus privacy for a player we are about to message or invite.
  async function getUserWithPrivacy(userId) {
    const rows = await db.runQuery(
      `SELECT u.name, ${PRIVACY_COLUMNS}
         FROM users u
         LEFT JOIN user_privacy_settings p ON p.user_id = u.user_id
        WHERE u.user_id = ? LIMIT 1`,
      [Number(userId)],
    );
    return rows[0] ? { name: String(rows[0].name || ""), privacy: privacyFromRow(rows[0]) } : null;
  }

  // Receipts only flow when both players allow them.
  async function sharesReadReceipts(userId, otherId) {
    const rows = await db.runQuery(
      "SELECT read_receipts FROM user_privacy_settings WHERE user_id IN (?, ?)",
      [Number(userId), Number(otherId)],
    );
    return rows.every((row) => privacyFromRow(row).readReceipts);
  }

  async function playedTogetherRecently(q, userId, otherId) {
    const [row] = await q(
      `SELECT COUNT(DISTINCT mp1.match_id) AS games
         FROM match_participants mp1
         JOIN match_participants mp2 ON mp2.match_id = mp1.match_id AND mp2.user_id = ?
         JOIN matches m
           ON m.match_id = mp1.match_id
          AND m.status = 'completed'
          AND m.created_at > NOW() - INTERVAL ${SUGGESTION_WINDOW_DAYS} DAY
        WHERE mp1.user_id = ?`,
      [Number(otherId), Number(userId)],
    );
    return Number(row?.games) >= SUGGESTION_MIN_GAMES;
  }

  async function assertAcceptsRequest(q, fromId, to) {
    const { friendRequests } = await getPrivacy(to.user_id, q);
    if (friendRequests === "none")
      throw httpError(403, `${to.name} isn't accepting friend requests.`);
    if (friendRequests === "recent" && !(await playedTogetherRecently(q, fromId, to.user_id))) {
      throw httpError(
        403,
        `${to.name} only accepts friend requests from players they've battled with recently.`,
      );
    }
  }

  async function getPrivacySettings(user) {
    assertRegistered(user);
    return { privacy: await getPrivacy(user.user_id) };
  }

  async function updatePrivacy(user, update) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const changes = sanitizePrivacyUpdate(update);
    const fields = PRIVACY_FIELDS.filter((field) => field.key in changes);
    if (!fields.length) throw httpError(400, "Pick a privacy setting to change.");
    const columns = fields.map((field) => field.column);
    const values = fields.map((field) =>
      field.boolean ? (changes[field.key] ? 1 : 0) : changes[field.key],
    );
    await db.runQuery(
      `INSERT INTO user_privacy_settings (user_id, ${columns.join(", ")})
       VALUES (?, ${columns.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${columns.map((column) => `${column} = VALUES(${column})`).join(", ")}`,
      [me, ...values],
    );
    const privacy = await getPrivacy(me);
    emitToUser(me, SOCKET_EVENTS.FRIENDS_PRIVACY, { privacy });
    if (fields.some((field) => FRIEND_VISIBLE_PRIVACY.has(field.key))) {
      const friends = await db.runQuery("SELECT friend_id FROM friendships WHERE user_id = ?", [
        me,
      ]);
      notifyChanged(...friends.map((row) => row.friend_id));
    }
    return { privacy };
  }

  // No typing indicator toward a friend who can't receive messages.
  async function canShowTyping(userId, friendId) {
    if (!(await areFriends(userId, friendId))) return false;
    const target = await getUserWithPrivacy(friendId);
    return target?.privacy.messages !== "none";
  }

  return {
    getPrivacy,
    getUserWithPrivacy,
    sharesReadReceipts,
    assertAcceptsRequest,
    getPrivacySettings,
    updatePrivacy,
    canShowTyping,
  };
}

module.exports = { createFriendPrivacy };
