const { sanitizeBody, normalizeReaction, shouldStoreReaction } = require("./messageRules");
const { httpError } = require("../httpError");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");

function createPartyChatMessages({ assertPartyMembership, db, getChatMessageById, io }) {
  async function sendPartyChatMessage({ partyId, user, body, replyToMessageId = null }) {
    const membership = await assertPartyMembership(partyId, user);
    const cleanBody = sanitizeBody(body);
    if (!cleanBody) {
      throw httpError(400, "Message cannot be empty");
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
        throw httpError(404, "Reply target not found");
      }
    }

    const result = await db.runQuery(
      `INSERT INTO party_chat_messages
        (party_id, user_id, reply_to_message_id, body)
       VALUES (?, ?, ?, ?)`,
      [membership.partyId, Number(user.user_id), replyRow?.message_id || null, cleanBody],
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

    io?.to?.(`party:${membership.partyId}`)?.emit?.(SOCKET_EVENTS.PARTY_CHAT_MESSAGE, {
      partyId: membership.partyId,
      message,
    });

    return message;
  }

  async function reactToPartyChatMessage({ partyId, user, messageId, reaction }) {
    const membership = await assertPartyMembership(partyId, user);
    const cleanReaction = normalizeReaction(reaction);
    const targetId = Number(messageId);
    if (!Number.isFinite(targetId) || targetId <= 0) {
      throw httpError(400, "Message ID required");
    }

    const targetRows = await db.runQuery(
      `SELECT message_id, user_id FROM party_chat_messages WHERE party_id = ? AND message_id = ? LIMIT 1`,
      [membership.partyId, targetId],
    );
    if (!targetRows.length) {
      throw httpError(404, "Message not found");
    }
    if (Number(targetRows[0].user_id) === Number(user.user_id)) {
      throw httpError(400, "You can't react to your own message.");
    }

    const currentRows = await db.runQuery(
      `SELECT reaction FROM party_chat_message_reactions
        WHERE party_id = ? AND message_id = ? AND user_id = ? LIMIT 1`,
      [membership.partyId, targetId, Number(user.user_id)],
    );
    if (!shouldStoreReaction(currentRows[0]?.reaction, cleanReaction)) {
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
    io?.to?.(`party:${membership.partyId}`)?.emit?.(SOCKET_EVENTS.PARTY_CHAT_MESSAGE, {
      partyId: membership.partyId,
      messageId: targetId,
      message,
    });
    return message;
  }

  return { sendPartyChatMessage, reactToPartyChatMessage };
}

module.exports = { createPartyChatMessages };
