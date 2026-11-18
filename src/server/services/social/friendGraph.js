const {
  randomFriendCode,
  normalizeFriendCode,
  TEAMMATE_WINDOW_DAYS,
  PRIVACY_COLUMNS,
  toPublicUser,
  SUGGESTION_WINDOW_DAYS,
  DECLINE_WINDOW_DAYS,
  MAX_DECLINES,
  SUGGESTION_MIN_GAMES,
  SUGGESTION_LIMIT,
  isGuestRow,
} = require("./friendRules");
const { httpError } = require("../httpError");
const { privacyFromRow } = require("../../../shared/social/privacy.cjs");
const { DEFAULT_CHARACTER } = require("../../../shared/characters/characterStats.js");

function createFriendGraph({ db, getStatusForName, assertRegistered, getPrivacy, areFriends }) {
  async function getOrCreateFriendCode(userId) {
    const rows = await db.runQuery("SELECT friend_code FROM users WHERE user_id = ? LIMIT 1", [
      Number(userId),
    ]);
    if (rows[0]?.friend_code) return rows[0].friend_code;
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = randomFriendCode();
      try {
        const result = await db.runQuery(
          "UPDATE users SET friend_code = ? WHERE user_id = ? AND friend_code IS NULL",
          [code, Number(userId)],
        );
        if (result.affectedRows) return code;
        // Another request generated it first.
        const again = await db.runQuery("SELECT friend_code FROM users WHERE user_id = ? LIMIT 1", [
          Number(userId),
        ]);
        if (again[0]?.friend_code) return again[0].friend_code;
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
      }
    }
    throw httpError(500, "Couldn't load your friend code. Please try again.");
  }

  async function resolveTarget({ userId, username, friendCode, query }) {
    const select =
      "SELECT user_id, name, char_class, selected_profile_icon_id, trophies, expires_at, is_banned, ban_expires_at FROM users";
    if (Number(userId) > 0) {
      return (
        (await db.runQuery(`${select} WHERE user_id = ? LIMIT 1`, [Number(userId)]))[0] || null
      );
    }
    const text = String(friendCode || query || "").trim();
    const code = normalizeFriendCode(friendCode || query);
    if (code) {
      const byCode = (await db.runQuery(`${select} WHERE friend_code = ? LIMIT 1`, [code]))[0];
      if (byCode) return byCode;
    }
    const name = String(username || text).trim();
    if (!name) return null;
    return (await db.runQuery(`${select} WHERE name = ? LIMIT 1`, [name.slice(0, 50)]))[0] || null;
  }

  // Completed matches shared with each friend recently, keyed by friend id.
  async function getGamesWithFriends(userId) {
    const rows = await db.runQuery(
      `SELECT mp2.user_id AS friend_id, COUNT(DISTINCT mp1.match_id) AS games
         FROM match_participants mp1
         JOIN match_participants mp2
           ON mp2.match_id = mp1.match_id AND mp2.user_id <> mp1.user_id
         JOIN matches m
           ON m.match_id = mp1.match_id
          AND m.status = 'completed'
          AND m.created_at > NOW() - INTERVAL ${TEAMMATE_WINDOW_DAYS} DAY
        WHERE mp1.user_id = ?
          AND EXISTS (SELECT 1 FROM friendships link WHERE link.user_id = mp1.user_id AND link.friend_id = mp2.user_id)
        GROUP BY mp2.user_id`,
      [Number(userId)],
    );
    const out = new Map();
    for (const row of rows) out.set(Number(row.friend_id), Number(row.games) || 0);
    return out;
  }

  async function listFriends(userId) {
    const [rows, gamesWith] = await Promise.all([
      db.runQuery(
        `SELECT u.user_id, u.name, u.char_class, u.selected_profile_icon_id, u.trophies, u.last_seen_at, f.created_at,
              ${PRIVACY_COLUMNS}
         FROM friendships f
         JOIN users u ON u.user_id = f.friend_id
         LEFT JOIN user_privacy_settings p ON p.user_id = u.user_id
        WHERE f.user_id = ?
        ORDER BY u.name ASC`,
        [Number(userId)],
      ),
      getGamesWithFriends(userId),
    ]);
    return rows.map((row) => {
      const privacy = privacyFromRow(row);
      const lastSeenHidden = privacy.lastSeen === "none";
      return {
        ...toPublicUser(row, getStatusForName(row.name)),
        since: row.created_at,
        lastSeenAt: lastSeenHidden ? null : row.last_seen_at || null,
        lastSeenHidden,
        acceptsMessages: privacy.messages !== "none",
        acceptsPartyInvites: privacy.partyInvites !== "none",
        gamesTogether: gamesWith.get(Number(row.user_id)) || 0,
      };
    });
  }

  async function listRequests(userId) {
    const rows = await db.runQuery(
      `SELECT r.request_id, r.from_user_id, r.to_user_id, r.created_at,
              u.user_id, u.name, u.char_class, u.selected_profile_icon_id, u.trophies
         FROM friend_requests r
         JOIN users u ON u.user_id = IF(r.from_user_id = ?, r.to_user_id, r.from_user_id)
        WHERE r.status = 'pending' AND (r.from_user_id = ? OR r.to_user_id = ?)
        ORDER BY r.created_at DESC`,
      [Number(userId), Number(userId), Number(userId)],
    );
    const incoming = [];
    const outgoing = [];
    for (const row of rows) {
      const entry = {
        requestId: Number(row.request_id),
        createdAt: row.created_at,
        user: toPublicUser(row, getStatusForName(row.name)),
      };
      (Number(row.to_user_id) === Number(userId) ? incoming : outgoing).push(entry);
    }
    return { incoming, outgoing };
  }

  async function getUnreadCounts(userId) {
    const rows = await db.runQuery(
      `SELECT sender_id, COUNT(*) AS c
         FROM friend_messages
        WHERE recipient_id = ? AND read_at IS NULL
        GROUP BY sender_id`,
      [Number(userId)],
    );
    const out = {};
    for (const row of rows) out[Number(row.sender_id)] = Number(row.c) || 0;
    return out;
  }

  async function getOverview(user) {
    assertRegistered(user);
    const userId = Number(user.user_id);
    const [friendCode, friends, requests, unread, privacy] = await Promise.all([
      getOrCreateFriendCode(userId),
      listFriends(userId),
      listRequests(userId),
      getUnreadCounts(userId),
      getPrivacy(userId),
    ]);
    return {
      me: {
        userId,
        name: String(user.name || ""),
        charClass: user.char_class || DEFAULT_CHARACTER,
        profileIconId: user.selected_profile_icon_id || null,
      },
      friendCode,
      friends,
      ...requests,
      unread,
      privacy,
    };
  }

  async function getSuggestions(user) {
    assertRegistered(user);
    const userId = Number(user.user_id);
    const rows = await db.runQuery(
      `SELECT u.user_id, u.name, u.char_class, u.selected_profile_icon_id, u.trophies,
              COUNT(*) AS games, MAX(m.created_at) AS last_played
         FROM match_participants mp1
         JOIN match_participants mp2
           ON mp2.match_id = mp1.match_id AND mp2.user_id <> mp1.user_id
         JOIN matches m
           ON m.match_id = mp1.match_id
          AND m.status = 'completed'
          AND m.created_at > NOW() - INTERVAL ${SUGGESTION_WINDOW_DAYS} DAY
         JOIN users u
           ON u.user_id = mp2.user_id AND u.expires_at IS NULL AND (COALESCE(u.is_banned, 0) = 0 OR u.ban_expires_at <= NOW())
         LEFT JOIN user_privacy_settings p ON p.user_id = u.user_id
        WHERE mp1.user_id = ?
          AND COALESCE(p.show_in_suggestions, 1) = 1
          AND COALESCE(p.friend_requests, 'everyone') <> 'none'
          AND NOT EXISTS (SELECT 1 FROM friendships f WHERE f.user_id = ? AND f.friend_id = mp2.user_id)
          AND NOT EXISTS (
            SELECT 1 FROM friend_requests r
             WHERE r.status = 'pending'
               AND ((r.from_user_id = ? AND r.to_user_id = mp2.user_id)
                 OR (r.to_user_id = ? AND r.from_user_id = mp2.user_id)))
          AND (SELECT COUNT(*) FROM friend_requests d
                WHERE d.from_user_id = ? AND d.to_user_id = mp2.user_id AND d.status = 'declined'
                  AND d.responded_at > NOW() - INTERVAL ${DECLINE_WINDOW_DAYS} DAY) < ${MAX_DECLINES}
        GROUP BY u.user_id, u.name, u.char_class, u.selected_profile_icon_id, u.trophies
       HAVING games >= ${SUGGESTION_MIN_GAMES}
        ORDER BY games DESC, last_played DESC
        LIMIT ${SUGGESTION_LIMIT}`,
      [userId, userId, userId, userId, userId],
    );
    return rows.map((row) => ({
      ...toPublicUser(row, getStatusForName(row.name)),
      gamesTogether: Number(row.games) || 0,
      lastPlayedAt: row.last_played,
    }));
  }

  // Lets the profile modal show Add Friend / Pending / Friends.
  async function getRelationship(viewer, otherUserId) {
    if (!viewer?.user_id || isGuestRow(viewer)) return { state: "unavailable" };
    const me = Number(viewer.user_id);
    const other = Number(otherUserId);
    if (!other || me === other) return { state: "self" };
    if (await areFriends(me, other)) return { state: "friends" };
    const rows = await db.runQuery(
      `SELECT request_id, from_user_id FROM friend_requests
        WHERE status = 'pending'
          AND ((from_user_id = ? AND to_user_id = ?) OR (from_user_id = ? AND to_user_id = ?))
        LIMIT 1`,
      [me, other, other, me],
    );
    if (rows[0]) {
      return {
        state: Number(rows[0].from_user_id) === me ? "outgoing" : "incoming",
        requestId: Number(rows[0].request_id),
      };
    }
    return { state: "none" };
  }

  return { resolveTarget, getOverview, getSuggestions, getRelationship };
}

module.exports = { createFriendGraph };
