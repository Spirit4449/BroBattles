const MAX_CHAT_BODY_LENGTH = 500;
const MAX_CHAT_LIMIT = 100;

function createPartyChatService({ db, io }) {
  function sanitizeBody(body) {
    const text = String(body || "").trim();
    if (!text) return "";
    return text.slice(0, MAX_CHAT_BODY_LENGTH);
  }

  function normalizeReaction(reaction) {
    const text = String(reaction || "").trim();
    if (!text) return "";
    return text.slice(0, 16);
  }

  function placeholders(count) {
    return Array.from(
      { length: Math.max(0, Number(count) || 0) },
      () => "?",
    ).join(",");
  }

  async function assertPartyMembership(partyId, user) {
    const userName = String(user?.name || "").trim();
    if (
      !Number.isFinite(Number(partyId)) ||
      Number(partyId) <= 0 ||
      !userName
    ) {
      throw new Error("Party membership required");
    }
    const rows = await db.runQuery(
      "SELECT 1 FROM party_members WHERE party_id = ? AND name = ? LIMIT 1",
      [Number(partyId), userName],
    );
    if (!rows?.length) {
      const error = new Error("Not a member of this party");
      error.statusCode = 403;
      throw error;
    }
    return { partyId: Number(partyId), userName };
  }

  async function fetchCurrentUserReadState({ partyId, userId }) {
    const rows = await db.runQuery(
      `SELECT COALESCE(MAX(message_id), 0) AS last_read_message_id
         FROM party_chat_message_reads
        WHERE party_id = ? AND user_id = ?`,
      [partyId, userId],
    );
    return Number(rows[0]?.last_read_message_id) || 0;
  }

  async function fetchMessageAggregates({ partyId, messageIds, userId }) {
    const ids = Array.from(
      new Set(
        (Array.isArray(messageIds) ? messageIds : [])
          .map((id) => Number(id))
          .filter((id) => Number.isFinite(id) && id > 0),
      ),
    );
    if (!ids.length) {
      return {
        reactionsByMessageId: new Map(),
        reactionUsersByMessageId: new Map(),
        viewerReactionByMessageId: new Map(),
        readCountByMessageId: new Map(),
        readersByMessageId: new Map(),
      };
    }

    const inClause = placeholders(ids.length);
    const reactionRows = await db.runQuery(
      `SELECT message_id, reaction, COUNT(*) AS reaction_count
         FROM party_chat_message_reactions
        WHERE party_id = ?
          AND message_id IN (${inClause})
        GROUP BY message_id, reaction`,
      [partyId, ...ids],
    );
    const readRows = await db.runQuery(
      `SELECT message_id, COUNT(*) AS view_count
         FROM party_chat_message_reads
        WHERE party_id = ?
          AND message_id IN (${inClause})
        GROUP BY message_id`,
      [partyId, ...ids],
    );
    const viewerReactionRows = await db.runQuery(
      `SELECT message_id, reaction
         FROM party_chat_message_reactions
        WHERE party_id = ?
          AND user_id = ?
          AND message_id IN (${inClause})`,
      [partyId, userId, ...ids],
    );
    const reactionUserRows = await db.runQuery(
      `SELECT r.message_id, r.reaction, r.user_id, u.name AS reactor_name
         FROM party_chat_message_reactions r
         JOIN users u ON u.user_id = r.user_id
        WHERE r.party_id = ?
          AND r.message_id IN (${inClause})
        ORDER BY r.message_id ASC, r.reaction ASC, u.name ASC`,
      [partyId, ...ids],
    );
    const readerRows = await db.runQuery(
      `SELECT r.message_id, r.user_id, u.name AS reader_name, u.char_class AS reader_char_class, u.selected_profile_icon_id AS reader_profile_icon_id, r.read_at
         FROM party_chat_message_reads r
         JOIN users u ON u.user_id = r.user_id
        WHERE r.party_id = ?
          AND r.message_id IN (${inClause})
        ORDER BY r.message_id ASC, r.read_at ASC, u.name ASC`,
      [partyId, ...ids],
    );

    const reactionsByMessageId = new Map();
    for (const row of reactionRows) {
      const messageId = Number(row.message_id);
      if (!reactionsByMessageId.has(messageId)) {
        reactionsByMessageId.set(messageId, []);
      }
      reactionsByMessageId.get(messageId).push({
        reaction: String(row.reaction || ""),
        count: Number(row.reaction_count) || 0,
      });
    }
    for (const list of reactionsByMessageId.values()) {
      list.sort(
        (a, b) => b.count - a.count || a.reaction.localeCompare(b.reaction),
      );
    }

    const viewerReactionByMessageId = new Map();
    for (const row of viewerReactionRows) {
      viewerReactionByMessageId.set(
        Number(row.message_id),
        String(row.reaction || ""),
      );
    }

    const reactionUsersByMessageId = new Map();
    for (const row of reactionUserRows) {
      const messageId = Number(row.message_id);
      const reaction = String(row.reaction || "");
      if (!reactionUsersByMessageId.has(messageId)) {
        reactionUsersByMessageId.set(messageId, {});
      }
      const byReaction = reactionUsersByMessageId.get(messageId);
      if (!Array.isArray(byReaction[reaction])) {
        byReaction[reaction] = [];
      }
      byReaction[reaction].push({
        userId: Number(row.user_id) || null,
        name: String(row.reactor_name || ""),
      });
    }

    const readCountByMessageId = new Map();
    for (const row of readRows) {
      readCountByMessageId.set(
        Number(row.message_id),
        Number(row.view_count) || 0,
      );
    }

    const readersByMessageId = new Map();
    for (const row of readerRows) {
      const messageId = Number(row.message_id);
      if (!readersByMessageId.has(messageId)) {
        readersByMessageId.set(messageId, []);
      }
      readersByMessageId.get(messageId).push({
        userId: Number(row.user_id),
        name: String(row.reader_name || ""),
        charClass: String(row.reader_char_class || "ninja"),
        profileIconId: String(row.reader_profile_icon_id || "") || null,
        readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
      });
    }

    return {
      reactionsByMessageId,
      reactionUsersByMessageId,
      viewerReactionByMessageId,
      readCountByMessageId,
      readersByMessageId,
    };
  }

  function buildMessagePayload(row, aggregates, user) {
    const messageId = Number(row.message_id);
    const senderName = String(row.sender_name || "");
    const replyToMessageId = Number(row.reply_to_message_id || 0) || null;
    return {
      id: messageId,
      partyId: Number(row.party_id),
      body: String(row.body || ""),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      sender: {
        userId: Number(row.user_id),
        name: senderName,
        charClass: String(row.char_class || "ninja"),
        profileIconId: String(row.profile_icon_id || "") || null,
        selectedCardId: row.selected_card_id || null,
      },
      replyTo: replyToMessageId
        ? {
            id: replyToMessageId,
            body: String(row.reply_body || ""),
            createdAt: row.reply_created_at
              ? new Date(row.reply_created_at).toISOString()
              : null,
            sender: String(row.reply_sender_name || ""),
          }
        : null,
      viewCount: Number(aggregates?.readCountByMessageId?.get(messageId)) || 0,
      viewers: Array.isArray(aggregates?.readersByMessageId?.get(messageId))
        ? aggregates.readersByMessageId.get(messageId)
        : [],
      reactions: Array.isArray(aggregates?.reactionsByMessageId?.get(messageId))
        ? aggregates.reactionsByMessageId.get(messageId)
        : [],
      reactionUsers: aggregates?.reactionUsersByMessageId?.get(messageId) || {},
      myReaction:
        String(aggregates?.viewerReactionByMessageId?.get(messageId) || "") ||
        null,
      isMine: String(senderName || "") === String(user?.name || ""),
    };
  }

  async function getPartyChatHistory({
    partyId,
    user,
    limit = 50,
    beforeMessageId = null,
  }) {
    const membership = await assertPartyMembership(partyId, user);
    const maxLimit = Math.max(1, Math.min(MAX_CHAT_LIMIT, Number(limit) || 50));
    const beforeId = Number(beforeMessageId);
    const beforeClause =
      Number.isFinite(beforeId) && beforeId > 0 ? beforeId : null;

    const rows = await db.runQuery(
      `SELECT
         m.message_id,
         m.party_id,
         m.user_id,
         m.reply_to_message_id,
         m.body,
         m.created_at,
         m.updated_at,
         u.name AS sender_name,
         u.char_class,
         u.selected_profile_icon_id AS profile_icon_id,
         u.selected_card_id,
         rm.body AS reply_body,
         rm.created_at AS reply_created_at,
         ru.name AS reply_sender_name
       FROM party_chat_messages m
       JOIN users u ON u.user_id = m.user_id
       LEFT JOIN party_chat_messages rm
         ON rm.message_id = m.reply_to_message_id
        AND rm.party_id = m.party_id
       LEFT JOIN users ru ON ru.user_id = rm.user_id
      WHERE m.party_id = ?
        AND (? IS NULL OR m.message_id < ?)
      ORDER BY m.message_id DESC
      LIMIT ?`,
      [membership.partyId, beforeClause, beforeClause, maxLimit],
    );

    const orderedRows = Array.isArray(rows) ? rows.slice().reverse() : [];
    const messageIds = orderedRows.map((row) => Number(row.message_id));
    const aggregates = await fetchMessageAggregates({
      partyId: membership.partyId,
      messageIds,
      userId: Number(user?.user_id) || 0,
    });
    const lastReadMessageId = await fetchCurrentUserReadState({
      partyId: membership.partyId,
      userId: Number(user?.user_id) || 0,
    });
    const unreadCountRows = await db.runQuery(
      `SELECT COUNT(*) AS unread_count
         FROM party_chat_messages
        WHERE party_id = ?
          AND message_id > ?
          AND user_id <> ?`,
      [membership.partyId, lastReadMessageId, Number(user?.user_id) || 0],
    );

    return {
      messages: orderedRows.map((row) =>
        buildMessagePayload(row, aggregates, user),
      ),
      lastReadMessageId,
      unreadCount: Number(unreadCountRows[0]?.unread_count) || 0,
    };
  }

  async function getChatMessageById({ partyId, messageId, user }) {
    const rows = await db.runQuery(
      `SELECT
         m.message_id,
         m.party_id,
         m.user_id,
         m.reply_to_message_id,
         m.body,
         m.created_at,
         m.updated_at,
         u.name AS sender_name,
         u.char_class,
         u.selected_profile_icon_id AS profile_icon_id,
         u.selected_card_id,
         rm.body AS reply_body,
         rm.created_at AS reply_created_at,
         ru.name AS reply_sender_name
       FROM party_chat_messages m
       JOIN users u ON u.user_id = m.user_id
       LEFT JOIN party_chat_messages rm
         ON rm.message_id = m.reply_to_message_id
        AND rm.party_id = m.party_id
       LEFT JOIN users ru ON ru.user_id = rm.user_id
      WHERE m.party_id = ? AND m.message_id = ?
      LIMIT 1`,
      [partyId, messageId],
    );
    if (!rows.length) return null;
    const aggregates = await fetchMessageAggregates({
      partyId,
      messageIds: [messageId],
      userId: Number(user?.user_id) || 0,
    });
    return buildMessagePayload(rows[0], aggregates, user);
  }

  async function sendPartyChatMessage({
    partyId,
    user,
    body,
    replyToMessageId = null,
  }) {
    const membership = await assertPartyMembership(partyId, user);
    const cleanBody = sanitizeBody(body);
    if (!cleanBody) {
      const error = new Error("Message cannot be empty");
      error.statusCode = 400;
      throw error;
    }

    const replyId = Number(replyToMessageId);
    let replyRow = null;
    if (Number.isFinite(replyId) && replyId > 0) {
      const rows = await db.runQuery(
        `SELECT message_id, body
           FROM party_chat_messages
          WHERE party_id = ? AND message_id = ?
          LIMIT 1`,
        [membership.partyId, replyId],
      );
      replyRow = rows[0] || null;
      if (!replyRow) {
        const error = new Error("Reply target not found");
        error.statusCode = 404;
        throw error;
      }
    }

    const result = await db.runQuery(
      `INSERT INTO party_chat_messages
        (party_id, user_id, reply_to_message_id, body)
       VALUES (?, ?, ?, ?)`,
      [
        membership.partyId,
        Number(user.user_id),
        replyRow?.message_id || null,
        cleanBody,
      ],
    );
    const messageId = Number(result?.insertId) || 0;
    const message = await getChatMessageById({
      partyId: membership.partyId,
      messageId,
      user,
    });
    if (!message) {
      throw new Error("Failed to load chat message after insert");
    }

    io?.to?.(`party:${membership.partyId}`)?.emit?.("party-chat:message", {
      partyId: membership.partyId,
      message,
    });

    return message;
  }

  async function reactToPartyChatMessage({
    partyId,
    user,
    messageId,
    reaction,
  }) {
    const membership = await assertPartyMembership(partyId, user);
    const cleanReaction = normalizeReaction(reaction);
    const targetId = Number(messageId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      const error = new Error("Message ID required");
      error.statusCode = 400;
      throw error;
    }

    const targetRows = await db.runQuery(
      `SELECT message_id FROM party_chat_messages WHERE party_id = ? AND message_id = ? LIMIT 1`,
      [membership.partyId, targetId],
    );
    if (!targetRows.length) {
      const error = new Error("Message not found");
      error.statusCode = 404;
      throw error;
    }

    const currentRows = await db.runQuery(
      `SELECT reaction FROM party_chat_message_reactions
        WHERE party_id = ? AND message_id = ? AND user_id = ? LIMIT 1`,
      [membership.partyId, targetId, Number(user.user_id)],
    );
    const currentReaction = String(currentRows[0]?.reaction || "");
    if (!cleanReaction) {
      await db.runQuery(
        `DELETE FROM party_chat_message_reactions
          WHERE party_id = ? AND message_id = ? AND user_id = ?`,
        [membership.partyId, targetId, Number(user.user_id)],
      );
    } else if (currentReaction === cleanReaction) {
      await db.runQuery(
        `DELETE FROM party_chat_message_reactions
          WHERE party_id = ? AND message_id = ? AND user_id = ?`,
        [membership.partyId, targetId, Number(user.user_id)],
      );
    } else {
      await db.runQuery(
        `INSERT INTO party_chat_message_reactions
          (party_id, message_id, user_id, reaction, created_at)
         VALUES (?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE reaction = VALUES(reaction), created_at = NOW()`,
        [membership.partyId, targetId, Number(user.user_id), cleanReaction],
      );
    }

    const message = await getChatMessageById({
      partyId: membership.partyId,
      messageId: targetId,
      user,
    });
    io?.to?.(`party:${membership.partyId}`)?.emit?.("party-chat:message", {
      partyId: membership.partyId,
      messageId: targetId,
      message,
    });
    return message;
  }

  async function markPartyChatRead({ partyId, user, lastMessageId }) {
    const membership = await assertPartyMembership(partyId, user);
    const maxMessageId = Number(lastMessageId);
    if (!Number.isFinite(maxMessageId) || maxMessageId <= 0) {
      return {
        unreadCount: 0,
        lastReadMessageId: await fetchCurrentUserReadState({
          partyId: membership.partyId,
          userId: Number(user.user_id) || 0,
        }),
      };
    }

    await db.runQuery(
      `INSERT IGNORE INTO party_chat_message_reads
        (party_id, message_id, user_id, read_at)
       SELECT m.party_id, m.message_id, ?, NOW()
         FROM party_chat_messages m
        WHERE m.party_id = ?
          AND m.message_id <= ?
          AND m.user_id <> ?`,
      [
        Number(user.user_id),
        membership.partyId,
        maxMessageId,
        Number(user.user_id),
      ],
    );

    const lastReadMessageId = await fetchCurrentUserReadState({
      partyId: membership.partyId,
      userId: Number(user.user_id) || 0,
    });
    const unreadRows = await db.runQuery(
      `SELECT COUNT(*) AS unread_count
         FROM party_chat_messages
        WHERE party_id = ?
          AND message_id > ?
          AND user_id <> ?`,
      [membership.partyId, lastReadMessageId, Number(user.user_id) || 0],
    );
    io?.to?.(`party:${membership.partyId}`)?.emit?.("party-chat:read", {
      partyId: membership.partyId,
      messageId: maxMessageId,
      viewerName: user.name,
      viewerUserId: Number(user.user_id) || null,
      viewerCharClass: String(user.char_class || "ninja"),
      viewerProfileIconId: String(user.selected_profile_icon_id || "") || null,
      type: "read",
    });

    return {
      unreadCount: Number(unreadRows[0]?.unread_count) || 0,
      lastReadMessageId,
    };
  }

  return {
    sanitizeBody,
    normalizeReaction,
    getPartyChatHistory,
    getChatMessageById,
    sendPartyChatMessage,
    reactToPartyChatMessage,
    markPartyChatRead,
  };
}

module.exports = { createPartyChatService };
