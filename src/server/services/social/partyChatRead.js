const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { resolveCharacterKey } = require("../../../shared/characters/characterStats.js");

function createPartyChatRead({ assertPartyMembership, fetchCurrentUserReadState, db, io }) {
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
      [Number(user.user_id), membership.partyId, maxMessageId, Number(user.user_id)],
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
    io?.to?.(`party:${membership.partyId}`)?.emit?.(SOCKET_EVENTS.PARTY_CHAT_READ, {
      partyId: membership.partyId,
      messageId: maxMessageId,
      viewerName: user.name,
      viewerUserId: Number(user.user_id) || null,
      viewerCharClass: resolveCharacterKey(user.char_class),
      viewerProfileIconId: String(user.selected_profile_icon_id || "") || null,
      type: "read",
    });

    return {
      unreadCount: Number(unreadRows[0]?.unread_count) || 0,
      lastReadMessageId,
    };
  }

  return { markPartyChatRead };
}

module.exports = { createPartyChatRead };
