const crypto = require("crypto");
const { addPartyInvite, getInviteCooldownMs } = require("../party/partyInviteStore");
const { DEFAULT_CHARACTER, resolveCharacterKey } = require("../../../shared/characters/characterStats.js");
const { PRIVACY_FIELDS, privacyFromRow, sanitizePrivacyUpdate } = require("../../../shared/social/privacy.cjs");

const MAX_FRIENDS = 200;
const MAX_MESSAGE_LENGTH = 500;
const MAX_HISTORY_LIMIT = 100;
const SUGGESTION_WINDOW_DAYS = 14;
const SUGGESTION_MIN_GAMES = 2;
const SUGGESTION_LIMIT = 10;
// Friends played with in this window get "now online" lobby hints.
const TEAMMATE_WINDOW_DAYS = 30;
// Repeat-request protection, per sender -> recipient pair.
const DECLINE_COOLDOWN_MINUTES = 10;
const MAX_DECLINES = 3;
const DECLINE_WINDOW_DAYS = 30;
const MAX_REQUESTS_PER_DAY = 5;
// No 0/O/1/I so codes are easy to read aloud and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FRIEND_CODE_PATTERN = /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/i;
// Joined as `p` wherever another player's privacy decides what we send.
const PRIVACY_COLUMNS = PRIVACY_FIELDS.map((field) => `p.${field.column}`).join(", ");
// Settings that change what friends see in their list.
const FRIEND_VISIBLE_PRIVACY = new Set(["messages", "partyInvites", "lastSeen"]);

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

function formatWait(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function isGuestRow(row) {
  return row?.expires_at !== null && row?.expires_at !== undefined;
}

function randomFriendCode() {
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function normalizeFriendCode(value) {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, "");
  if (!FRIEND_CODE_PATTERN.test(raw)) return null;
  const compact = raw.replace("-", "");
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function toPublicUser(row, status = "offline") {
  return {
    userId: Number(row.user_id),
    name: String(row.name || ""),
    charClass: resolveCharacterKey(row.char_class),
    profileIconId: row.selected_profile_icon_id ? String(row.selected_profile_icon_id) : null,
    trophies: Number(row.trophies) || 0,
    status,
  };
}

function createFriendService({ db, io }) {
  // Injected by initSocket once the activity service exists.
  let getStatusForName = () => "offline";

  function emitToUser(userId, event, payload) {
    io?.to?.(`user:${Number(userId)}`)?.emit?.(event, payload);
  }

  function assertRegistered(user) {
    if (!user?.user_id) throw httpError(401, "Please sign in to use friends.");
    if (isGuestRow(user)) throw httpError(403, "Create an account to add friends.");
  }

  async function areFriends(userId, friendId) {
    const rows = await db.runQuery(
      "SELECT 1 FROM friendships WHERE user_id = ? AND friend_id = ? LIMIT 1",
      [Number(userId), Number(friendId)],
    );
    return rows.length > 0;
  }

  async function assertFriends(userId, friendId) {
    if (!(await areFriends(userId, friendId))) throw httpError(403, "You're not friends with this player anymore.");
  }

  async function countFriends(userId) {
    const rows = await db.runQuery("SELECT COUNT(*) AS c FROM friendships WHERE user_id = ?", [Number(userId)]);
    return Number(rows[0]?.c) || 0;
  }

  async function getPrivacy(userId, q = db.runQuery) {
    const rows = await q("SELECT * FROM user_privacy_settings WHERE user_id = ? LIMIT 1", [Number(userId)]);
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
    if (friendRequests === "none") throw httpError(403, `${to.name} isn't accepting friend requests.`);
    if (friendRequests === "recent" && !(await playedTogetherRecently(q, fromId, to.user_id))) {
      throw httpError(403, `${to.name} only accepts friend requests from players they've battled with recently.`);
    }
  }

  async function getOrCreateFriendCode(userId) {
    const rows = await db.runQuery("SELECT friend_code FROM users WHERE user_id = ? LIMIT 1", [Number(userId)]);
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
        const again = await db.runQuery("SELECT friend_code FROM users WHERE user_id = ? LIMIT 1", [Number(userId)]);
        if (again[0]?.friend_code) return again[0].friend_code;
      } catch (error) {
        if (error?.code !== "ER_DUP_ENTRY") throw error;
      }
    }
    throw httpError(500, "Couldn't load your friend code. Please try again.");
  }

  async function resolveTarget({ userId, username, friendCode, query }) {
    const select = "SELECT user_id, name, char_class, selected_profile_icon_id, trophies, expires_at, is_banned FROM users";
    if (Number(userId) > 0) {
      return (await db.runQuery(`${select} WHERE user_id = ? LIMIT 1`, [Number(userId)]))[0] || null;
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
    const [rows, gamesWith] = await Promise.all([db.runQuery(
      `SELECT u.user_id, u.name, u.char_class, u.selected_profile_icon_id, u.trophies, u.last_seen_at, f.created_at,
              ${PRIVACY_COLUMNS}
         FROM friendships f
         JOIN users u ON u.user_id = f.friend_id
         LEFT JOIN user_privacy_settings p ON p.user_id = u.user_id
        WHERE f.user_id = ?
        ORDER BY u.name ASC`,
      [Number(userId)],
    ), getGamesWithFriends(userId)]);
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
    return { me: { userId, name: String(user.name || ""), charClass: user.char_class || DEFAULT_CHARACTER, profileIconId: user.selected_profile_icon_id || null }, friendCode, friends, ...requests, unread, privacy };
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
           ON u.user_id = mp2.user_id AND u.expires_at IS NULL AND COALESCE(u.is_banned, 0) = 0
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

  function notifyChanged(...userIds) {
    for (const id of userIds) emitToUser(id, "friends:changed", {});
  }

  async function acceptRequestRow(q, row) {
    await q("UPDATE friend_requests SET status = 'accepted', responded_at = NOW() WHERE request_id = ?", [row.request_id]);
    await q(
      "INSERT IGNORE INTO friendships (user_id, friend_id) VALUES (?, ?), (?, ?)",
      [row.from_user_id, row.to_user_id, row.to_user_id, row.from_user_id],
    );
  }

  // Stops re-sending after declines and cancel/resend loops.
  async function assertCanRequest(q, fromId, toId, toName) {
    const [row] = await q(
      `SELECT
         SUM(status = 'declined' AND responded_at > NOW() - INTERVAL ${DECLINE_WINDOW_DAYS} DAY) AS declines,
         SUM(status = 'declined' AND responded_at > NOW() - INTERVAL ${DECLINE_COOLDOWN_MINUTES} MINUTE) AS recent_declines,
         SUM(created_at > NOW() - INTERVAL 1 DAY) AS recent_requests
       FROM friend_requests
       WHERE from_user_id = ? AND to_user_id = ?`,
      [fromId, toId],
    );
    if (Number(row?.declines) >= MAX_DECLINES) {
      throw httpError(429, `${toName} isn't accepting friend requests from you right now.`);
    }
    if (Number(row?.recent_declines) > 0) {
      throw httpError(429, `${toName} declined your request. You can try again in a few minutes.`);
    }
    if (Number(row?.recent_requests) >= MAX_REQUESTS_PER_DAY) {
      throw httpError(429, `You've sent ${toName} a lot of requests. Try again tomorrow.`);
    }
  }

  async function sendRequest(user, target) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = await resolveTarget(target || {});
    if (!other) throw httpError(404, "We couldn't find a player with that name or code.");
    const otherId = Number(other.user_id);
    if (otherId === me) throw httpError(400, "That's you! Try a friend's code instead.");
    if (isGuestRow(other)) throw httpError(400, "That player needs an account before you can add them.");
    if (Number(other.is_banned || 0) === 1) throw httpError(404, "We couldn't find a player with that name or code.");
    if (await areFriends(me, otherId)) throw httpError(409, `You and ${other.name} are already friends.`);
    if ((await countFriends(me)) >= MAX_FRIENDS) throw httpError(409, `Your friends list is full (${MAX_FRIENDS} max).`);

    const result = await db.withTransaction(async (_conn, q) => {
      const reverse = await q(
        `SELECT * FROM friend_requests
          WHERE status = 'pending' AND from_user_id = ? AND to_user_id = ?
          FOR UPDATE`,
        [otherId, me],
      );
      // They already asked us, so asking back accepts.
      if (reverse[0]) {
        await acceptRequestRow(q, reverse[0]);
        return { status: "accepted" };
      }
      await assertAcceptsRequest(q, me, other);
      await assertCanRequest(q, me, otherId, other.name);
      try {
        const insert = await q(
          "INSERT INTO friend_requests (from_user_id, to_user_id) VALUES (?, ?)",
          [me, otherId],
        );
        return { status: "pending", requestId: Number(insert.insertId) };
      } catch (error) {
        if (error?.code === "ER_DUP_ENTRY") throw httpError(409, `You already sent ${other.name} a request.`);
        throw error;
      }
    });
    notifyChanged(me, otherId);
    if (result.status === "pending") {
      emitToUser(otherId, "friends:request", { from: toPublicUser(user, "online"), requestId: result.requestId });
    }
    return { ...result, user: toPublicUser(other, getStatusForName(other.name)) };
  }

  async function respondToRequest(user, requestId, accept) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const row = await db.withTransaction(async (_conn, q) => {
      const rows = await q(
        `SELECT * FROM friend_requests
          WHERE request_id = ? AND to_user_id = ? AND status = 'pending'
          FOR UPDATE`,
        [Number(requestId), me],
      );
      if (!rows[0]) throw httpError(404, "That request is no longer available.");
      if (accept) {
        if ((await countFriends(me)) >= MAX_FRIENDS) throw httpError(409, `Your friends list is full (${MAX_FRIENDS} max).`);
        await acceptRequestRow(q, rows[0]);
      } else {
        await q("UPDATE friend_requests SET status = 'declined', responded_at = NOW() WHERE request_id = ?", [rows[0].request_id]);
      }
      return rows[0];
    });
    notifyChanged(me, row.from_user_id);
    return { status: accept ? "accepted" : "declined" };
  }

  async function cancelRequest(user, requestId) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const rows = await db.runQuery(
      "SELECT to_user_id FROM friend_requests WHERE request_id = ? AND from_user_id = ? AND status = 'pending' LIMIT 1",
      [Number(requestId), me],
    );
    if (!rows[0]) throw httpError(404, "That request is no longer available.");
    await db.runQuery(
      "UPDATE friend_requests SET status = 'cancelled', responded_at = NOW() WHERE request_id = ? AND status = 'pending'",
      [Number(requestId)],
    );
    notifyChanged(me, rows[0].to_user_id);
    return { status: "cancelled" };
  }

  async function removeFriend(user, friendId) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = Number(friendId);
    const result = await db.runQuery(
      "DELETE FROM friendships WHERE (user_id = ? AND friend_id = ?) OR (user_id = ? AND friend_id = ?)",
      [me, other, other, me],
    );
    if (!result.affectedRows) throw httpError(404, "That player isn't on your friends list.");
    notifyChanged(me, other);
    return { removed: true };
  }

  async function assertAcceptsMessages(userId) {
    const target = await getUserWithPrivacy(userId);
    if (target?.privacy.messages === "none") throw httpError(403, `${target.name} isn't accepting messages.`);
  }

  function toMessage(row, reactions = []) {
    return {
      messageId: Number(row.message_id),
      senderId: Number(row.sender_id),
      recipientId: Number(row.recipient_id),
      body: String(row.body || ""),
      createdAt: row.created_at,
      readAt: row.read_at || null,
      reactions,
    };
  }

  // messageId -> [{ reaction, userId, name }]
  async function fetchReactions(messageIds) {
    const ids = messageIds.map(Number).filter((id) => id > 0);
    const byMessage = new Map();
    if (!ids.length) return byMessage;
    const rows = await db.runQuery(
      `SELECT r.message_id, r.reaction, r.user_id, u.name
         FROM friend_message_reactions r
         JOIN users u ON u.user_id = r.user_id
        WHERE r.message_id IN (${ids.map(() => "?").join(",")})
        ORDER BY r.created_at ASC`,
      ids,
    );
    for (const row of rows) {
      const id = Number(row.message_id);
      if (!byMessage.has(id)) byMessage.set(id, []);
      byMessage.get(id).push({ reaction: String(row.reaction), userId: Number(row.user_id), name: String(row.name || "") });
    }
    return byMessage;
  }

  async function withReactions(rows) {
    const reactions = await fetchReactions(rows.map((row) => row.message_id));
    return rows.map((row) => toMessage(row, reactions.get(Number(row.message_id)) || []));
  }

  async function reactToMessage(user, messageId, reaction) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const clean = String(reaction || "").trim().slice(0, 16);
    const rows = await db.runQuery(
      "SELECT message_id, sender_id, recipient_id, body, created_at, read_at FROM friend_messages WHERE message_id = ? LIMIT 1",
      [Number(messageId)],
    );
    const row = rows[0];
    if (!row || (Number(row.sender_id) !== me && Number(row.recipient_id) !== me)) {
      throw httpError(404, "That message is no longer available.");
    }
    if (Number(row.sender_id) === me) throw httpError(400, "You can't react to your own message.");
    const other = Number(row.recipient_id) === me ? Number(row.sender_id) : Number(row.recipient_id);
    await assertFriends(me, other);
    await assertAcceptsMessages(other);
    const current = await db.runQuery(
      "SELECT reaction FROM friend_message_reactions WHERE message_id = ? AND user_id = ? LIMIT 1",
      [Number(row.message_id), me],
    );
    // Same toggle rules as party chat: same emoji removes, a new one replaces.
    const added = !!clean && String(current[0]?.reaction || "") !== clean;
    if (!added) {
      await db.runQuery("DELETE FROM friend_message_reactions WHERE message_id = ? AND user_id = ?", [Number(row.message_id), me]);
    } else {
      await db.runQuery(
        `INSERT INTO friend_message_reactions (message_id, user_id, reaction, created_at)
         VALUES (?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), created_at = NOW()`,
        [Number(row.message_id), me, clean],
      );
    }
    const [message] = await withReactions([row]);
    const payload = { message, reactorId: me, reaction: clean, added };
    emitToUser(me, "friends:reaction", payload);
    emitToUser(other, "friends:reaction", payload);
    return message;
  }

  async function getConversation(user, friendId, { beforeMessageId, limit } = {}) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = Number(friendId);
    await assertFriends(me, other);
    const cap = Math.max(1, Math.min(MAX_HISTORY_LIMIT, Number(limit) || 50));
    const before = Number(beforeMessageId) > 0 ? Number(beforeMessageId) : null;
    const rows = await db.runQuery(
      `SELECT message_id, sender_id, recipient_id, body, created_at, read_at
         FROM friend_messages
        WHERE user_a = LEAST(?, ?) AND user_b = GREATEST(?, ?)
          ${before ? "AND message_id < ?" : ""}
        ORDER BY message_id DESC
        LIMIT ${cap}`,
      before ? [me, other, me, other, before] : [me, other, me, other],
    );
    const messages = await withReactions(rows.reverse());
    if (!(await sharesReadReceipts(me, other))) {
      for (const message of messages) if (message.senderId === me) message.readAt = null;
    }
    return { messages, hasMore: rows.length === cap };
  }

  async function sendMessage(user, friendId, body) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = Number(friendId);
    const text = String(body || "").trim().slice(0, MAX_MESSAGE_LENGTH);
    if (!text) throw httpError(400, "Type a message first.");
    await assertFriends(me, other);
    await assertAcceptsMessages(other);
    const insert = await db.runQuery(
      "INSERT INTO friend_messages (sender_id, recipient_id, body) VALUES (?, ?, ?)",
      [me, other, text],
    );
    const rows = await db.runQuery(
      "SELECT message_id, sender_id, recipient_id, body, created_at, read_at FROM friend_messages WHERE message_id = ? LIMIT 1",
      [Number(insert.insertId)],
    );
    const message = toMessage(rows[0]);
    const payload = { message, sender: { userId: me, name: user.name, profileIconId: user.selected_profile_icon_id || null } };
    emitToUser(me, "friends:message", payload);
    emitToUser(other, "friends:message", payload);
    return message;
  }

  async function markRead(user, friendId) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = Number(friendId);
    // Pin the read point first so a message arriving mid-update stays unread.
    const [latest] = await db.runQuery(
      "SELECT MAX(message_id) AS upTo FROM friend_messages WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL",
      [me, other],
    );
    const upToMessageId = Number(latest?.upTo) || 0;
    if (!upToMessageId) return { updated: 0 };
    const result = await db.runQuery(
      "UPDATE friend_messages SET read_at = NOW() WHERE recipient_id = ? AND sender_id = ? AND read_at IS NULL AND message_id <= ?",
      [me, other, upToMessageId],
    );
    if (result.affectedRows) {
      const readAt = new Date().toISOString();
      // The sender's chat flips its receipts; my other tabs clear their badge.
      if (await sharesReadReceipts(me, other)) emitToUser(other, "friends:read", { readerId: me, upToMessageId, readAt });
      emitToUser(me, "friends:read", { readerId: me, friendId: other, upToMessageId, readAt });
    }
    return { updated: Number(result.affectedRows) || 0 };
  }

  async function sendPartyInvite(user, friendId) {
    assertRegistered(user);
    const me = Number(user.user_id);
    const other = Number(friendId);
    await assertFriends(me, other);
    const partyId = await db.getPartyIdByName(user.name);
    if (!partyId) throw httpError(400, "Join or create a party first, then invite friends.");
    const target = await getUserWithPrivacy(other);
    if (!target) throw httpError(404, "That player isn't on your friends list.");
    const friendName = target.name;
    if (target.privacy.partyInvites === "none") throw httpError(403, `${friendName} isn't accepting party invites.`);
    if (getStatusForName(friendName) === "offline") throw httpError(409, `${friendName} is offline right now.`);
    if (Number(await db.getPartyIdByName(friendName)) === Number(partyId)) throw httpError(409, `${friendName} is already in your party.`);
    const waitMs = getInviteCooldownMs(me, other);
    if (waitMs > 0) {
      throw Object.assign(httpError(429, `You can invite ${friendName} again in ${formatWait(waitMs)}.`), { cooldownUntilMs: Date.now() + waitMs });
    }
    const cooldownMs = addPartyInvite(other, partyId, me);
    emitToUser(other, "friends:party-invite", {
      partyId: Number(partyId),
      from: { userId: me, name: user.name, profileIconId: user.selected_profile_icon_id || null },
    });
    return { invited: true, partyId: Number(partyId), cooldownUntilMs: cooldownMs ? Date.now() + cooldownMs : null };
  }

  // Called by the activity service whenever a user's derived status changes.
  async function handleStatusChange(name, status) {
    try {
      const rows = await db.runQuery(
        `SELECT u.user_id, u.last_seen_at, f.friend_id, p.last_seen
           FROM users u
           JOIN friendships f ON f.user_id = u.user_id
           LEFT JOIN user_privacy_settings p ON p.user_id = u.user_id
          WHERE u.name = ?`,
        [name],
      );
      for (const row of rows) {
        const lastSeenHidden = privacyFromRow(row).lastSeen === "none";
        emitToUser(row.friend_id, "friends:presence", {
          userId: Number(row.user_id),
          name,
          status,
          lastSeenAt: lastSeenHidden ? null : row.last_seen_at || null,
          lastSeenHidden,
        });
      }
    } catch (error) {
      console.warn("[friends] presence fan-out failed:", error?.message);
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
    const values = fields.map((field) => (field.boolean ? (changes[field.key] ? 1 : 0) : changes[field.key]));
    await db.runQuery(
      `INSERT INTO user_privacy_settings (user_id, ${columns.join(", ")})
       VALUES (?, ${columns.map(() => "?").join(", ")})
       ON DUPLICATE KEY UPDATE ${columns.map((column) => `${column} = VALUES(${column})`).join(", ")}`,
      [me, ...values],
    );
    const privacy = await getPrivacy(me);
    emitToUser(me, "friends:privacy", { privacy });
    if (fields.some((field) => FRIEND_VISIBLE_PRIVACY.has(field.key))) {
      const friends = await db.runQuery("SELECT friend_id FROM friendships WHERE user_id = ?", [me]);
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

  function attachPresence({ getStatus }) {
    if (typeof getStatus === "function") getStatusForName = getStatus;
  }

  return {
    io,
    attachPresence,
    handleStatusChange,
    areFriends,
    canShowTyping,
    getOverview,
    getPrivacySettings,
    updatePrivacy,
    getSuggestions,
    getRelationship,
    sendRequest,
    respondToRequest,
    cancelRequest,
    removeFriend,
    getConversation,
    sendMessage,
    reactToMessage,
    markRead,
    sendPartyInvite,
  };
}

module.exports = { createFriendService, normalizeFriendCode, isGuestRow };
