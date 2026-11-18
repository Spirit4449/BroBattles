const { placeholders } = require("../../lib/sqlList");
const { MAX_HISTORY_LIMIT } = require("./friendRules");
const { httpError } = require("../httpError");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { sanitizeBody, normalizeReaction, shouldStoreReaction } = require("./messageRules");

function createFriendMessages({
  getUserWithPrivacy,
  db,
  assertRegistered,
  assertFriends,
  emitToUser,
  sharesReadReceipts,
}) {
  async function assertAcceptsMessages(userId) {
    const target = await getUserWithPrivacy(userId);
    if (target?.privacy.messages === "none")
      throw httpError(403, `${target.name} isn't accepting messages.`);
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
        WHERE r.message_id IN (${placeholders(ids.length)})
        ORDER BY r.created_at ASC`,
      ids,
    );
    for (const row of rows) {
      const id = Number(row.message_id);
      if (!byMessage.has(id)) byMessage.set(id, []);
      byMessage
        .get(id)
        .push({
          reaction: String(row.reaction),
          userId: Number(row.user_id),
          name: String(row.name || ""),
        });
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
    const clean = normalizeReaction(reaction);
    const rows = await db.runQuery(
      "SELECT message_id, sender_id, recipient_id, body, created_at, read_at FROM friend_messages WHERE message_id = ? LIMIT 1",
      [Number(messageId)],
    );
    const row = rows[0];
    if (!row || (Number(row.sender_id) !== me && Number(row.recipient_id) !== me)) {
      throw httpError(404, "That message is no longer available.");
    }
    if (Number(row.sender_id) === me) throw httpError(400, "You can't react to your own message.");
    const other =
      Number(row.recipient_id) === me ? Number(row.sender_id) : Number(row.recipient_id);
    await assertFriends(me, other);
    await assertAcceptsMessages(other);
    const current = await db.runQuery(
      "SELECT reaction FROM friend_message_reactions WHERE message_id = ? AND user_id = ? LIMIT 1",
      [Number(row.message_id), me],
    );
    // Same toggle rules as party chat: same emoji removes, a new one replaces.
    const added = shouldStoreReaction(current[0]?.reaction, clean);
    if (!added) {
      await db.runQuery(
        "DELETE FROM friend_message_reactions WHERE message_id = ? AND user_id = ?",
        [Number(row.message_id), me],
      );
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
    emitToUser(me, SOCKET_EVENTS.FRIENDS_REACTION, payload);
    emitToUser(other, SOCKET_EVENTS.FRIENDS_REACTION, payload);
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
    const text = sanitizeBody(body);
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
    const payload = {
      message,
      sender: { userId: me, name: user.name, profileIconId: user.selected_profile_icon_id || null },
    };
    emitToUser(me, SOCKET_EVENTS.FRIENDS_MESSAGE, payload);
    emitToUser(other, SOCKET_EVENTS.FRIENDS_MESSAGE, payload);
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
      if (await sharesReadReceipts(me, other))
        emitToUser(other, SOCKET_EVENTS.FRIENDS_READ, { readerId: me, upToMessageId, readAt });
      emitToUser(me, SOCKET_EVENTS.FRIENDS_READ, {
        readerId: me,
        friendId: other,
        upToMessageId,
        readAt,
      });
    }
    return { updated: Number(result.affectedRows) || 0 };
  }

  return { reactToMessage, getConversation, sendMessage, markRead };
}

module.exports = { createFriendMessages };
