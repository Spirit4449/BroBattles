const { formatWait } = require("./friendRules");
const { httpError } = require("../httpError");
const { addPartyInvite, getInviteCooldownMs } = require("../party/partyInviteStore");
const { SOCKET_EVENTS } = require("../../../shared/net/socketEvents.js");
const { privacyFromRow } = require("../../../shared/social/privacy.cjs");

function createFriendPresence({
  assertRegistered,
  assertFriends,
  db,
  getUserWithPrivacy,
  getStatusForName,
  emitToUser,
}) {
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
    if (target.privacy.partyInvites === "none")
      throw httpError(403, `${friendName} isn't accepting party invites.`);
    if (getStatusForName(friendName) === "offline")
      throw httpError(409, `${friendName} is offline right now.`);
    if (Number(await db.getPartyIdByName(friendName)) === Number(partyId))
      throw httpError(409, `${friendName} is already in your party.`);
    const waitMs = getInviteCooldownMs(me, other);
    if (waitMs > 0) {
      throw httpError(429, `You can invite ${friendName} again in ${formatWait(waitMs)}.`, {
        details: { cooldownUntilMs: Date.now() + waitMs },
      });
    }
    const cooldownMs = addPartyInvite(other, partyId, me);
    emitToUser(other, SOCKET_EVENTS.FRIENDS_PARTY_INVITE, {
      partyId: Number(partyId),
      from: { userId: me, name: user.name, profileIconId: user.selected_profile_icon_id || null },
    });
    return {
      invited: true,
      partyId: Number(partyId),
      cooldownUntilMs: cooldownMs ? Date.now() + cooldownMs : null,
    };
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
        emitToUser(row.friend_id, SOCKET_EVENTS.FRIENDS_PRESENCE, {
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

  return { sendPartyInvite, handleStatusChange };
}

module.exports = { createFriendPresence };
